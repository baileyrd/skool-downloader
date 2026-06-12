/**
 * Shared helpers and manifest types used by the CLI, the course downloader,
 * and the index regenerators. Single source of truth for filename
 * sanitization, atomic file writes, and the on-disk manifest shapes.
 */

import fs from 'fs-extra';
import path from 'path';

export { escapeHtml } from './html-escape.js';

/**
 * Windows reserved device names that cannot be used as file or directory
 * base names (case-insensitive, with or without an extension).
 */
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Sanitizes a scraped name (course/module/lesson/resource title) into a
 * filename that is safe on all platforms, including Windows:
 *
 * - Replaces the characters `/ \ ? % * : | " < >` with `-`.
 * - Strips trailing dots and spaces (invalid at the end of Windows names).
 * - Prefixes reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9 —
 *   matched case-insensitively against the base name before any extension)
 *   with `_`.
 * - Returns `_` if the result would otherwise be empty.
 */
export function sanitizeName(value: string): string {
    let sanitized = value.replace(/[/\\?%*:|"<>]/g, '-');
    sanitized = sanitized.replace(/[. ]+$/, '');
    const baseName = sanitized.split('.')[0];
    if (WINDOWS_RESERVED_NAMES.test(baseName)) {
        sanitized = `_${sanitized}`;
    }
    if (sanitized.length === 0) {
        return '_';
    }
    return sanitized;
}

/**
 * Longest allowed stem (name without extension) for a lesson video file.
 * The lesson title already appears in the folder name, so an uncapped stem
 * roughly doubles the title's contribution to the path — risky against
 * Windows' 260-char path limit on deep trees.
 */
const VIDEO_STEM_MAX_LENGTH = 60;

/**
 * Builds the lesson video filename: `<lessonIndex> - <sanitized title>.mp4`,
 * with the stem truncated to a safe length. The index prefix keeps videos
 * sorted when collected into a flat playlist. (Legacy archives used a bare
 * `video.mp4`; readers must fall back to that name when the manifest has no
 * `videoFile` entry.)
 */
export function buildVideoFileName(lessonIndex: number, title: string): string {
    let stem = `${lessonIndex} - ${sanitizeName(title)}`;
    if (stem.length > VIDEO_STEM_MAX_LENGTH) {
        stem = stem.slice(0, VIDEO_STEM_MAX_LENGTH).replace(/[. ]+$/, '');
    }
    if (stem.length === 0) {
        stem = `${lessonIndex} - video`;
    }
    return `${stem}.mp4`;
}

/**
 * Minimal structural shape of a lesson resource for filename assignment.
 * (Matches `Resource` from the scraper without importing it — avoids a
 * module cycle.)
 */
export type NamedResource = { title: string; file_name?: string };

/**
 * Assigns each resource a unique local filename within a lesson's
 * `resources/` folder.
 *
 * The base name is `sanitizeName(file_name || title)`. When two resources in
 * the same lesson share a base name (e.g. three different skills all
 * attached as `SKILL.md`), every colliding resource gets its sanitized title
 * prefixed; a numeric prefix is the last resort when titles collide too.
 * Non-colliding resources keep their plain base name, so filenames from
 * earlier downloads stay valid.
 */
export function assignResourceFileNames<T extends NamedResource>(resources: T[]): Map<T, string> {
    const baseCounts = new Map<string, number>();
    for (const res of resources) {
        const base = sanitizeName(res.file_name || res.title);
        baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }

    const used = new Set<string>();
    const assigned = new Map<T, string>();
    for (const res of resources) {
        const base = sanitizeName(res.file_name || res.title);
        let name = base;
        if ((baseCounts.get(base) ?? 0) > 1) {
            const titled = sanitizeName(res.title);
            if (titled !== base) {
                name = `${titled}-${base}`;
            }
        }
        let candidate = name;
        let counter = 2;
        while (used.has(candidate)) {
            candidate = `${counter}-${name}`;
            counter += 1;
        }
        used.add(candidate);
        assigned.set(res, candidate);
    }
    return assigned;
}

/**
 * Writes JSON to `filePath` atomically: data is written to a `.tmp` sibling
 * first and then moved into place, so readers never observe a partial file.
 */
export async function writeAtomicJson(filePath: string, data: unknown): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fs.writeJson(tempPath, data, { spaces: 2 });
    await fs.move(tempPath, filePath, { overwrite: true });
}

/**
 * Writes HTML to `filePath` atomically: content is written to a `.tmp`
 * sibling first and then moved into place, so readers never observe a
 * partial file.
 */
export async function writeAtomicHtml(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, content);
    await fs.move(tempPath, filePath, { overwrite: true });
}

/**
 * Shape of the `.course.json` manifest written to each course directory.
 */
export type CourseManifest = {
    courseName: string;
    groupName: string;
    courseImageUrl?: string;
    courseImagePath?: string;
    modules: Array<{
        index: number;
        title: string;
        moduleDirName: string;
        root?: boolean;
    }>;
    updatedAt: string;
};

/**
 * Returns true when `filePath` exists with at least one byte of content.
 */
export function fileHasContent(filePath: string): boolean {
    try {
        return fs.statSync(filePath).size > 0;
    } catch {
        return false;
    }
}

/**
 * Returns whether a lesson directory is verifiably complete on disk per its
 * manifest: no recorded video/resource failures, and every file the manifest
 * references (index.html, the video when hasVideo, each resourceFiles entry)
 * exists with content. Manifests written before the `resourceFiles` field
 * cannot prove their resources are on disk, so they count as incomplete.
 *
 * Single source of truth for the fast-resume skip and the lessonId-based
 * reconcile pass — the two must agree on what "complete" means.
 */
export function isLessonDirComplete(lessonDir: string, manifest: LessonManifest): boolean {
    if (!Array.isArray(manifest.resourceFiles)) return false;
    if (manifest.videoFailed) return false;
    if ((manifest.resourceFailures ?? 0) > 0) return false;
    if (!fs.existsSync(path.join(lessonDir, 'index.html'))) return false;
    // Manifests written before title-based video names have no videoFile
    // entry; their videos live at the legacy `video.mp4`.
    if (manifest.hasVideo && !fileHasContent(path.join(lessonDir, manifest.videoFile ?? 'video.mp4'))) return false;
    return manifest.resourceFiles.every(name =>
        fileHasContent(path.join(lessonDir, 'resources', name))
    );
}

/**
 * Shape of the `lesson.json` manifest written to each lesson directory.
 */
export type LessonManifest = {
    lessonId: string;
    title: string;
    moduleIndex: number;
    moduleTitle: string;
    lessonIndex: number;
    moduleDirName: string;
    lessonDirName: string;
    relativePath: string;
    hasVideo: boolean;
    /**
     * Local filename of the lesson video. Absent on manifests written before
     * title-based video names; those lessons store the video as `video.mp4`.
     */
    videoFile?: string;
    resourcesCount: number;
    /**
     * Local filenames (within `resources/`) of successfully downloaded
     * resources. Present on manifests written since the fast-resume feature;
     * its absence marks an older manifest that must be re-scraped once.
     */
    resourceFiles?: string[];
    /** True when the lesson has a video but its download failed. */
    videoFailed?: boolean;
    /** Number of resources that failed to download in the last run. */
    resourceFailures?: number;
    updatedAt: string;
};
