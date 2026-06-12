import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

import { reconcileLessonDirs, type ExpectedLesson } from '../src/reconcile-lessons.js';
import { buildVideoFileName, type LessonManifest } from '../src/shared.js';

const silentLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
};

function manifestFor(overrides: Partial<LessonManifest> & { lessonId: string; title: string; lessonIndex: number }): LessonManifest {
    const lessonDirName = `${overrides.lessonIndex}-${overrides.title}`;
    return {
        moduleIndex: 1,
        moduleTitle: 'Lessons',
        moduleDirName: '',
        lessonDirName,
        relativePath: `${lessonDirName}/index.html`,
        hasVideo: false,
        resourcesCount: 0,
        resourceFiles: [],
        updatedAt: '2026-06-11T00:00:00.000Z',
        ...overrides
    };
}

function expectedFor(overrides: Partial<ExpectedLesson> & { lessonId: string; title: string; lessonIndex: number }): ExpectedLesson {
    return {
        moduleIndex: 1,
        moduleTitle: 'Lessons',
        moduleDirName: '',
        ...overrides
    };
}

describe('reconcileLessonDirs', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skool-reconcile-test-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    async function makeLessonDir(relDir: string, manifest: LessonManifest, extras: Record<string, string> = {}) {
        const lessonDir = path.join(tmpDir, relDir);
        await fs.ensureDir(lessonDir);
        await fs.writeFile(path.join(lessonDir, 'index.html'), '<html><body>lesson</body></html>');
        await fs.writeJson(path.join(lessonDir, 'lesson.json'), manifest);
        for (const [name, content] of Object.entries(extras)) {
            await fs.ensureDir(path.dirname(path.join(lessonDir, name)));
            await fs.writeFile(path.join(lessonDir, name), content);
        }
        return lessonDir;
    }

    it('moves a complete lesson folder when its index shifts', async () => {
        await makeLessonDir('2-Old Lesson', manifestFor({ lessonId: 'abc', title: 'Old Lesson', lessonIndex: 2 }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 'abc', title: 'Old Lesson', lessonIndex: 3 })],
            { logger: silentLogger }
        );

        expect(summary.movedDirs).toBe(1);
        expect(fs.existsSync(path.join(tmpDir, '2-Old Lesson'))).toBe(false);
        const manifest = await fs.readJson(path.join(tmpDir, '3-Old Lesson', 'lesson.json'));
        expect(manifest.lessonIndex).toBe(3);
        expect(manifest.lessonDirName).toBe('3-Old Lesson');
        expect(manifest.relativePath).toBe('3-Old Lesson/index.html');
    });

    it('handles a chain of shifted indexes without collisions', async () => {
        // Lesson at 2 moves to 3 while the lesson at 3 moves to 4 — the
        // naive rename order would collide if titles matched.
        await makeLessonDir('2-Same Title', manifestFor({ lessonId: 'a', title: 'Same Title', lessonIndex: 2 }));
        await makeLessonDir('3-Same Title', manifestFor({ lessonId: 'b', title: 'Same Title', lessonIndex: 3 }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [
                expectedFor({ lessonId: 'a', title: 'Same Title', lessonIndex: 3 }),
                expectedFor({ lessonId: 'b', title: 'Same Title', lessonIndex: 4 })
            ],
            { logger: silentLogger }
        );

        expect(summary.movedDirs).toBe(2);
        expect((await fs.readJson(path.join(tmpDir, '3-Same Title', 'lesson.json'))).lessonId).toBe('a');
        expect((await fs.readJson(path.join(tmpDir, '4-Same Title', 'lesson.json'))).lessonId).toBe('b');
    });

    it('renames the index-prefixed video and patches the lesson page', async () => {
        const oldVideo = buildVideoFileName(2, 'My Lesson');
        await makeLessonDir(
            '2-My Lesson',
            manifestFor({ lessonId: 'vid', title: 'My Lesson', lessonIndex: 2, hasVideo: true, videoFile: oldVideo }),
            { [oldVideo]: 'video bytes' }
        );
        const pageHtml = `<video controls src="${encodeURIComponent(oldVideo)}"></video>`;
        await fs.writeFile(path.join(tmpDir, '2-My Lesson', 'index.html'), pageHtml);

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 'vid', title: 'My Lesson', lessonIndex: 3 })],
            { logger: silentLogger }
        );

        const newVideo = buildVideoFileName(3, 'My Lesson');
        const newDir = path.join(tmpDir, '3-My Lesson');
        expect(summary.renamedVideos).toBe(1);
        expect(await fs.readFile(path.join(newDir, newVideo), 'utf-8')).toBe('video bytes');
        expect(fs.existsSync(path.join(newDir, oldVideo))).toBe(false);
        expect(await fs.readFile(path.join(newDir, 'index.html'), 'utf-8'))
            .toContain(`src="${encodeURIComponent(newVideo)}"`);
        expect((await fs.readJson(path.join(newDir, 'lesson.json'))).videoFile).toBe(newVideo);
    });

    it('removes stale duplicates once a complete copy is at the expected path', async () => {
        await makeLessonDir('2-Daily Update', manifestFor({
            lessonId: 'dup', title: 'Daily Update', lessonIndex: 2,
            updatedAt: '2026-06-10T00:00:00.000Z'
        }));
        await makeLessonDir('3-Daily Update', manifestFor({
            lessonId: 'dup', title: 'Daily Update', lessonIndex: 3,
            updatedAt: '2026-06-12T00:00:00.000Z'
        }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 'dup', title: 'Daily Update', lessonIndex: 3 })],
            { logger: silentLogger }
        );

        expect(summary.removedDuplicates).toBe(1);
        expect(fs.existsSync(path.join(tmpDir, '2-Daily Update'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, '3-Daily Update'))).toBe(true);
    });

    it('prefers a complete copy over an incomplete one at the expected path', async () => {
        // Complete copy at the old location (has its video)...
        await makeLessonDir(
            '2-Lesson', manifestFor({
                lessonId: 'pick', title: 'Lesson', lessonIndex: 2,
                hasVideo: true, videoFile: '2 - Lesson.mp4'
            }),
            { '2 - Lesson.mp4': 'video bytes' }
        );
        // ...incomplete copy already at the new location (video missing).
        await makeLessonDir('3-Lesson', manifestFor({
            lessonId: 'pick', title: 'Lesson', lessonIndex: 3,
            hasVideo: true, videoFile: '3 - Lesson.mp4'
        }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 'pick', title: 'Lesson', lessonIndex: 3 })],
            { logger: silentLogger }
        );

        expect(summary.removedDuplicates).toBe(1);
        expect(summary.movedDirs).toBe(1);
        const winner = path.join(tmpDir, '3-Lesson');
        expect(await fs.readFile(path.join(winner, '3 - Lesson.mp4'), 'utf-8')).toBe('video bytes');
        expect((await fs.readJson(path.join(winner, 'lesson.json'))).videoFile).toBe('3 - Lesson.mp4');
    });

    it('keeps duplicates when no candidate is complete', async () => {
        await makeLessonDir('2-Broken', manifestFor({
            lessonId: 'x', title: 'Broken', lessonIndex: 2, videoFailed: true
        }));
        await makeLessonDir('3-Broken', manifestFor({
            lessonId: 'x', title: 'Broken', lessonIndex: 3, videoFailed: true
        }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 'x', title: 'Broken', lessonIndex: 3 })],
            { logger: silentLogger }
        );

        expect(summary.removedDuplicates).toBe(0);
        // Both folders still exist (the loser was kept).
        expect(fs.existsSync(path.join(tmpDir, '2-Broken'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '3-Broken'))).toBe(true);
    });

    it('reconciles lessons nested inside module directories', async () => {
        await makeLessonDir('1-Module One/2-Nested', manifestFor({
            lessonId: 'nested', title: 'Nested', lessonIndex: 2,
            moduleDirName: '1-Module One',
            relativePath: '1-Module One/2-Nested/index.html'
        }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({
                lessonId: 'nested', title: 'Nested', lessonIndex: 3,
                moduleDirName: '1-Module One', moduleTitle: 'Module One'
            })],
            { logger: silentLogger }
        );

        expect(summary.movedDirs).toBe(1);
        const manifest = await fs.readJson(path.join(tmpDir, '1-Module One', '3-Nested', 'lesson.json'));
        expect(manifest.relativePath).toBe('1-Module One/3-Nested/index.html');
    });

    it('reports orphan folders without deleting them', async () => {
        await makeLessonDir('5-Deleted On Skool', manifestFor({
            lessonId: 'gone', title: 'Deleted On Skool', lessonIndex: 5
        }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 'other', title: 'Other', lessonIndex: 1 })],
            { logger: silentLogger, reportOrphans: true }
        );

        expect(summary.orphanDirs).toEqual(['5-Deleted On Skool']);
        expect(fs.existsSync(path.join(tmpDir, '5-Deleted On Skool'))).toBe(true);
    });

    it('does not report orphans when reporting is disabled (single-lesson mode)', async () => {
        await makeLessonDir('5-Unrelated', manifestFor({
            lessonId: 'unrelated', title: 'Unrelated', lessonIndex: 5
        }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 'target', title: 'Target', lessonIndex: 1 })],
            { logger: silentLogger, reportOrphans: false }
        );

        expect(summary.orphanDirs).toEqual([]);
        expect(fs.existsSync(path.join(tmpDir, '5-Unrelated'))).toBe(true);
    });

    it('is a no-op when everything already matches', async () => {
        await makeLessonDir('1-Stable', manifestFor({ lessonId: 's', title: 'Stable', lessonIndex: 1 }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 's', title: 'Stable', lessonIndex: 1 })],
            { logger: silentLogger }
        );

        expect(summary).toEqual({ movedDirs: 0, renamedVideos: 0, removedDuplicates: 0, orphanDirs: [] });
    });

    it('updates the manifest when only the title changed on Skool', async () => {
        await makeLessonDir('1-Old Title', manifestFor({ lessonId: 't', title: 'Old Title', lessonIndex: 1 }));

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 't', title: 'New Title', lessonIndex: 1 })],
            { logger: silentLogger }
        );

        expect(summary.movedDirs).toBe(1);
        const manifest = await fs.readJson(path.join(tmpDir, '1-New Title', 'lesson.json'));
        expect(manifest.title).toBe('New Title');
        expect(manifest.lessonDirName).toBe('1-New Title');
    });

    it('moves an untracked folder aside when it blocks the expected path', async () => {
        await makeLessonDir('2-Lesson', manifestFor({ lessonId: 'real', title: 'Lesson', lessonIndex: 2 }));
        // A folder with no manifest occupying the destination.
        const blocker = path.join(tmpDir, '3-Lesson');
        await fs.ensureDir(blocker);
        await fs.writeFile(path.join(blocker, 'index.html'), 'untracked');

        const summary = await reconcileLessonDirs(
            tmpDir,
            [expectedFor({ lessonId: 'real', title: 'Lesson', lessonIndex: 3 })],
            { logger: silentLogger }
        );

        expect(summary.movedDirs).toBe(1);
        expect((await fs.readJson(path.join(tmpDir, '3-Lesson', 'lesson.json'))).lessonId).toBe('real');
        // The blocker was pushed aside, not destroyed.
        expect(fs.existsSync(path.join(tmpDir, '3-Lesson-stale-real'))).toBe(true);
    });
});
