/**
 * Reconciles on-disk lesson directories with the course structure fetched
 * from Skool, using the stable `lessonId` stored in each `lesson.json`.
 *
 * Lesson folders are named `<index>-<title>`, but Skool courses can insert
 * lessons at the top (daily-update courses do this constantly), shifting
 * every other lesson's index. Without reconciliation each shift makes every
 * lesson look "new", re-downloading the whole course and stranding the old
 * folders as duplicates. This pass runs before any download and instead:
 *
 * - moves/renames existing folders to their new `<index>-<title>` location,
 * - renames the index-prefixed video file (and patches the lesson page's
 *   <video src>) to match,
 * - deletes leftover duplicate folders for the same lessonId once a complete
 *   copy is in place,
 * - reports orphan folders whose lesson no longer exists in the course.
 */

import fs from 'fs-extra';
import path from 'path';

import { createConsoleLogger, type Logger } from './logger.js';
import {
    buildVideoFileName,
    fileHasContent,
    isLessonDirComplete,
    sanitizeName,
    writeAtomicHtml,
    writeAtomicJson,
    type LessonManifest
} from './shared.js';

export type ExpectedLesson = {
    lessonId: string;
    lessonIndex: number;
    title: string;
    moduleIndex: number;
    moduleTitle: string;
    /** '' for lessons that live directly in the course root. */
    moduleDirName: string;
};

export type ReconcileSummary = {
    /** Folders moved/renamed to their new index-title location. */
    movedDirs: number;
    /** Index-prefixed video files renamed to match a shifted lesson index. */
    renamedVideos: number;
    /** Duplicate folders (same lessonId) removed. */
    removedDuplicates: number;
    /** Course-relative paths of folders whose lessonId is no longer in the course. */
    orphanDirs: string[];
};

type Candidate = {
    absPath: string;
    /** Path relative to the course root, for reporting. */
    relPath: string;
    manifest: LessonManifest;
};

function isCandidateComplete(candidate: Candidate): boolean {
    return isLessonDirComplete(candidate.absPath, candidate.manifest);
}

async function readCandidate(absPath: string, relPath: string): Promise<Candidate | null> {
    try {
        const manifest: LessonManifest = await fs.readJson(path.join(absPath, 'lesson.json'));
        if (!manifest?.lessonId) return null;
        return { absPath, relPath, manifest };
    } catch {
        return null;
    }
}

/**
 * Collects every directory under the course root that carries a lesson
 * manifest: root-level lesson dirs plus lesson dirs nested one level deep
 * inside module dirs (the only two layouts the downloader produces).
 */
async function collectCandidates(baseOutputDir: string): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    let entries: fs.Dirent[];
    try {
        entries = await fs.readdir(baseOutputDir, { withFileTypes: true });
    } catch {
        return candidates;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'assets' || entry.name.startsWith('.')) continue;
        const entryPath = path.join(baseOutputDir, entry.name);

        const rootCandidate = await readCandidate(entryPath, entry.name);
        if (rootCandidate) {
            candidates.push(rootCandidate);
            continue;
        }

        // Not a lesson dir — treat as a module dir and scan one level down.
        let childEntries: fs.Dirent[];
        try {
            childEntries = await fs.readdir(entryPath, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const child of childEntries) {
            if (!child.isDirectory() || child.name === 'assets' || child.name.startsWith('.')) continue;
            const childPath = path.join(entryPath, child.name);
            const candidate = await readCandidate(childPath, `${entry.name}/${child.name}`);
            if (candidate) candidates.push(candidate);
        }
    }

    return candidates;
}

/** Picks the candidate to keep: complete beats incomplete, then newest. */
function pickWinner(candidates: Candidate[], expectedAbs: string): Candidate {
    const score = (c: Candidate) => {
        let s = 0;
        if (isCandidateComplete(c)) s += 2;
        if (path.resolve(c.absPath) === path.resolve(expectedAbs)) s += 1;
        return s;
    };
    return [...candidates].sort((a, b) => {
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return (b.manifest.updatedAt ?? '').localeCompare(a.manifest.updatedAt ?? '');
    })[0];
}

/**
 * Renames the winner's video file to match its new lesson index and patches
 * the lesson page's <video src>. Legacy `video.mp4` archives are left alone
 * (the `migrate-video-names` command handles those explicitly).
 */
async function renameVideoIfNeeded(
    candidate: Candidate,
    expectedVideoFile: string,
    logger: Logger
): Promise<boolean> {
    const current = candidate.manifest.videoFile;
    if (!current || current === 'video.mp4' || current === expectedVideoFile) return false;

    const currentPath = path.join(candidate.absPath, current);
    if (!fileHasContent(currentPath)) return false;

    const targetPath = path.join(candidate.absPath, expectedVideoFile);
    if (fs.existsSync(targetPath)) {
        logger.warn(`  ⚠️ Video rename target already exists, keeping ${current}`);
        return false;
    }

    await fs.move(currentPath, targetPath);

    const indexPath = path.join(candidate.absPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        const html = await fs.readFile(indexPath, 'utf-8');
        const patched = html.replaceAll(
            `src="${encodeURIComponent(current)}"`,
            `src="${encodeURIComponent(expectedVideoFile)}"`
        );
        if (patched !== html) {
            await writeAtomicHtml(indexPath, patched);
        }
    }

    candidate.manifest.videoFile = expectedVideoFile;
    return true;
}

export async function reconcileLessonDirs(
    baseOutputDir: string,
    expectedLessons: ExpectedLesson[],
    options: { logger?: Logger; reportOrphans?: boolean } = {}
): Promise<ReconcileSummary> {
    const logger = options.logger ?? createConsoleLogger();
    const summary: ReconcileSummary = {
        movedDirs: 0,
        renamedVideos: 0,
        removedDuplicates: 0,
        orphanDirs: []
    };

    const candidates = await collectCandidates(baseOutputDir);
    if (candidates.length === 0) return summary;

    const byId = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
        const list = byId.get(candidate.manifest.lessonId) ?? [];
        list.push(candidate);
        byId.set(candidate.manifest.lessonId, list);
    }

    type PlannedMove = { winner: Candidate; expected: ExpectedLesson; expectedAbs: string; tempPath: string };
    const pendingMoves: PlannedMove[] = [];
    const settled: Array<{ winner: Candidate; expected: ExpectedLesson }> = [];

    for (const expected of expectedLessons) {
        const group = byId.get(expected.lessonId);
        if (!group || group.length === 0) continue;
        byId.delete(expected.lessonId);

        const expectedDirName = `${expected.lessonIndex}-${sanitizeName(expected.title)}`;
        const expectedAbs = path.join(baseOutputDir, expected.moduleDirName, expectedDirName);

        const winner = pickWinner(group, expectedAbs);
        const winnerComplete = isCandidateComplete(winner);

        for (const loser of group) {
            if (loser === winner) continue;
            if (winnerComplete) {
                await fs.remove(loser.absPath);
                summary.removedDuplicates += 1;
                logger.info(`  🧹 Removed duplicate lesson folder: ${loser.relPath}`);
            } else {
                logger.warn(`  ⚠️ Duplicate folder kept (no complete copy yet): ${loser.relPath}`);
            }
        }

        if (path.resolve(winner.absPath) === path.resolve(expectedAbs)) {
            settled.push({ winner, expected });
            continue;
        }

        // Two-phase move: park the folder under a temp name first so chains
        // of shifted indexes (2→3 while 3→4) never collide mid-rename.
        const tempPath = path.join(baseOutputDir, expected.moduleDirName, `.reconcile-${expected.lessonId}`);
        await fs.ensureDir(path.dirname(tempPath));
        await fs.move(winner.absPath, tempPath, { overwrite: true });
        pendingMoves.push({ winner, expected, expectedAbs, tempPath });
    }

    for (const move of pendingMoves) {
        // Anything still occupying the destination is not a tracked lesson
        // (those were moved to temp names or deduped above) — push it aside
        // rather than destroy it.
        if (fs.existsSync(move.expectedAbs)) {
            const stalePath = `${move.expectedAbs}-stale-${move.expected.lessonId.slice(0, 6)}`;
            await fs.move(move.expectedAbs, stalePath, { overwrite: true });
            logger.warn(`  ⚠️ Moved unrecognized folder aside: ${path.basename(stalePath)}`);
        }
        await fs.move(move.tempPath, move.expectedAbs);
        const fromName = move.winner.relPath;
        move.winner.absPath = move.expectedAbs;
        move.winner.relPath = path.relative(baseOutputDir, move.expectedAbs).replaceAll(path.sep, '/');
        summary.movedDirs += 1;
        logger.info(`  📦 Moved ${fromName} → ${move.winner.relPath} (index shift)`);
        settled.push({ winner: move.winner, expected: move.expected });
    }

    for (const { winner, expected } of settled) {
        const expectedDirName = `${expected.lessonIndex}-${sanitizeName(expected.title)}`;
        const expectedVideoFile = buildVideoFileName(expected.lessonIndex, expected.title);

        if (await renameVideoIfNeeded(winner, expectedVideoFile, logger)) {
            summary.renamedVideos += 1;
        }

        const manifest = winner.manifest;
        const relativePath = expected.moduleDirName
            ? `${expected.moduleDirName}/${expectedDirName}/index.html`
            : `${expectedDirName}/index.html`;
        const changed =
            manifest.title !== expected.title ||
            manifest.lessonIndex !== expected.lessonIndex ||
            manifest.moduleIndex !== expected.moduleIndex ||
            manifest.moduleTitle !== expected.moduleTitle ||
            manifest.moduleDirName !== expected.moduleDirName ||
            manifest.lessonDirName !== expectedDirName ||
            manifest.relativePath !== relativePath;

        if (changed) {
            manifest.title = expected.title;
            manifest.lessonIndex = expected.lessonIndex;
            manifest.moduleIndex = expected.moduleIndex;
            manifest.moduleTitle = expected.moduleTitle;
            manifest.moduleDirName = expected.moduleDirName;
            manifest.lessonDirName = expectedDirName;
            manifest.relativePath = relativePath;
            await writeAtomicJson(path.join(winner.absPath, 'lesson.json'), manifest);
        }
    }

    // Whatever is left in byId has a lessonId that is not in the course
    // anymore (deleted or moved on Skool). Never delete those automatically —
    // they may be the only remaining copy of removed content.
    if (options.reportOrphans) {
        for (const group of byId.values()) {
            for (const orphan of group) {
                summary.orphanDirs.push(orphan.relPath);
                logger.warn(`  👻 On disk but no longer in the course: ${orphan.relPath}`);
            }
        }
    }

    return summary;
}
