import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

import { migrateVideoNames, patchLessonVideoSrc } from '../src/migrate-video-names.js';

describe('patchLessonVideoSrc', () => {
    it('rewrites the legacy video source to the encoded new name', () => {
        const html = '<video controls src="video.mp4"></video>';
        expect(patchLessonVideoSrc(html, '2 - Next Steps.mp4'))
            .toBe('<video controls src="2%20-%20Next%20Steps.mp4"></video>');
    });

    it('leaves pages without a legacy video reference untouched', () => {
        const html = '<p>No video here, just text mentioning video.mp4 outside a src.</p>';
        // Only the exact src="video.mp4" attribute form is rewritten.
        expect(patchLessonVideoSrc(html, 'x.mp4')).toBe(html);
    });
});

describe('migrateVideoNames', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skool-migrate-test-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    async function makeLesson(relDir: string, manifest: object | null) {
        const lessonDir = path.join(tmpDir, relDir);
        await fs.ensureDir(lessonDir);
        await fs.writeFile(path.join(lessonDir, 'video.mp4'), 'video bytes');
        await fs.writeFile(
            path.join(lessonDir, 'index.html'),
            '<html><body><video controls src="video.mp4"></video></body></html>'
        );
        if (manifest) {
            await fs.writeJson(path.join(lessonDir, 'lesson.json'), manifest);
        }
        return lessonDir;
    }

    it('renames the video, patches the page, and records videoFile in the manifest', async () => {
        const lessonDir = await makeLesson('Group/Course/1-Module/2-Next Steps', {
            title: 'Next Steps',
            lessonIndex: 2,
            hasVideo: true
        });

        const summary = await migrateVideoNames(tmpDir, { silent: true });

        expect(summary.renamed).toBe(1);
        expect(fs.existsSync(path.join(lessonDir, 'video.mp4'))).toBe(false);
        expect(await fs.readFile(path.join(lessonDir, '2 - Next Steps.mp4'), 'utf-8')).toBe('video bytes');
        expect(await fs.readFile(path.join(lessonDir, 'index.html'), 'utf-8'))
            .toContain('src="2%20-%20Next%20Steps.mp4"');
        const manifest = await fs.readJson(path.join(lessonDir, 'lesson.json'));
        expect(manifest.videoFile).toBe('2 - Next Steps.mp4');
    });

    it('falls back to the directory name when the manifest is missing', async () => {
        const lessonDir = await makeLesson('Group/Course/3-Some Lesson', null);

        const summary = await migrateVideoNames(tmpDir, { silent: true });

        expect(summary.renamed).toBe(1);
        expect(fs.existsSync(path.join(lessonDir, '3 - Some Lesson.mp4'))).toBe(true);
    });

    it('is idempotent — a second run renames nothing', async () => {
        await makeLesson('Group/Course/2-Lesson', { title: 'Lesson', lessonIndex: 2 });

        await migrateVideoNames(tmpDir, { silent: true });
        const second = await migrateVideoNames(tmpDir, { silent: true });

        expect(second.renamed).toBe(0);
        expect(second.warnings).toBe(0);
    });

    it('warns and leaves both files when the target name already exists', async () => {
        const lessonDir = await makeLesson('Group/Course/2-Lesson', { title: 'Lesson', lessonIndex: 2 });
        await fs.writeFile(path.join(lessonDir, '2 - Lesson.mp4'), 'already here');

        const summary = await migrateVideoNames(tmpDir, { silent: true });

        expect(summary.renamed).toBe(0);
        expect(summary.warnings).toBe(1);
        expect(await fs.readFile(path.join(lessonDir, 'video.mp4'), 'utf-8')).toBe('video bytes');
        expect(await fs.readFile(path.join(lessonDir, '2 - Lesson.mp4'), 'utf-8')).toBe('already here');
    });
});
