/**
 * Shared helpers and manifest types used by the CLI, the course downloader,
 * and the index regenerators. Single source of truth for filename
 * sanitization, atomic file writes, and the on-disk manifest shapes.
 */

import fs from 'fs-extra';

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
