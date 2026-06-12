/**
 * One-time migration: rename legacy per-lesson `video.mp4` files to the
 * title-based scheme (`<lessonIndex> - <title>.mp4`), patch the lesson page's
 * <video src> to match, and record the new name in `lesson.json` so fast
 * resume keeps recognizing the lesson as complete.
 *
 * Safe to re-run: lessons without a `video.mp4` are skipped, and a lesson
 * whose target name is already taken is left untouched (with a warning).
 */

import fs from 'fs-extra';
import path from 'path';

import {
    buildVideoFileName,
    writeAtomicJson,
    writeAtomicHtml,
    type LessonManifest
} from './shared.js';

const LEGACY_VIDEO_NAME = 'video.mp4';

type MigrateOptions = {
    silent?: boolean;
};

export type MigrateSummary = {
    renamed: number;
    skipped: number;
    warnings: number;
};

/**
 * Rewrites the lesson page's video source from the legacy name to
 * `videoFile`. Exported for unit testing.
 */
export function patchLessonVideoSrc(html: string, videoFile: string): string {
    return html.replaceAll(
        `src="${LEGACY_VIDEO_NAME}"`,
        `src="${encodeURIComponent(videoFile)}"`
    );
}

/**
 * Derives lesson index and title from a lesson directory name like
 * `12-Some Lesson Title`. Fallback for lessons whose manifest is missing
 * or unreadable.
 */
function parseLessonDirName(dirName: string): { lessonIndex: number; title: string } {
    const match = dirName.match(/^(\d+)-(.*)$/);
    if (match) {
        return { lessonIndex: Number.parseInt(match[1], 10), title: match[2] || 'video' };
    }
    return { lessonIndex: 1, title: dirName };
}

async function migrateLessonDir(
    lessonDir: string,
    summary: MigrateSummary,
    log: (message: string) => void,
    warn: (message: string) => void
): Promise<void> {
    const legacyPath = path.join(lessonDir, LEGACY_VIDEO_NAME);
    if (!fs.existsSync(legacyPath)) return;

    const manifestPath = path.join(lessonDir, 'lesson.json');
    let manifest: LessonManifest | null = null;
    try {
        manifest = await fs.readJson(manifestPath);
    } catch {
        manifest = null;
    }

    const fromManifest = manifest && manifest.title
        ? { lessonIndex: manifest.lessonIndex ?? 1, title: manifest.title }
        : parseLessonDirName(path.basename(lessonDir));

    const videoFile = buildVideoFileName(fromManifest.lessonIndex, fromManifest.title);
    const targetPath = path.join(lessonDir, videoFile);

    if (fs.existsSync(targetPath)) {
        summary.warnings += 1;
        warn(`⚠️ Target already exists, leaving legacy video in place: ${targetPath}`);
        return;
    }

    await fs.move(legacyPath, targetPath);

    const indexPath = path.join(lessonDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        const html = await fs.readFile(indexPath, 'utf-8');
        const patched = patchLessonVideoSrc(html, videoFile);
        if (patched !== html) {
            await writeAtomicHtml(indexPath, patched);
        }
    }

    if (manifest) {
        manifest.videoFile = videoFile;
        await writeAtomicJson(manifestPath, manifest);
    }

    summary.renamed += 1;
    log(`✅ ${path.basename(lessonDir)} → ${videoFile}`);
}

/**
 * Walks `rootDir` recursively and migrates every lesson directory (any
 * directory containing a legacy `video.mp4`).
 */
export async function migrateVideoNames(
    rootDir: string,
    options: MigrateOptions = {}
): Promise<MigrateSummary> {
    const log = options.silent ? () => {} : console.log;
    const warn = options.silent ? () => {} : console.warn;

    if (!fs.existsSync(rootDir)) {
        throw new Error(`Directory not found: ${rootDir}`);
    }

    const summary: MigrateSummary = { renamed: 0, skipped: 0, warnings: 0 };

    const walk = async (dir: string): Promise<void> => {
        await migrateLessonDir(dir, summary, log, warn);

        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name === 'assets' || entry.name === 'resources') continue;
            await walk(path.join(dir, entry.name));
        }
    };

    await walk(rootDir);

    log(`\nMigration complete: ${summary.renamed} videos renamed, ${summary.warnings} warnings.`);
    return summary;
}
