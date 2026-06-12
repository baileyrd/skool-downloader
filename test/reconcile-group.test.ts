import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

import { extractGroupSlug, reconcileGroupDir } from '../src/reconcile-group.js';

const silentLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
};

describe('extractGroupSlug', () => {
    it('returns the first path segment of a classroom URL', () => {
        expect(extractGroupSlug('https://www.skool.com/spookluke-vault-2637/classroom')).toBe('spookluke-vault-2637');
        expect(extractGroupSlug('https://www.skool.com/chase-ai/classroom/abc?md=x')).toBe('chase-ai');
    });

    it('returns null for unparseable or path-less URLs', () => {
        expect(extractGroupSlug('not a url')).toBeNull();
        expect(extractGroupSlug('https://www.skool.com/')).toBeNull();
    });
});

describe('reconcileGroupDir', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skool-group-test-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    it('creates the group folder with a .group.json when nothing exists', async () => {
        const dir = await reconcileGroupDir(tmpDir, 'My Group', 'my-group-123', silentLogger);

        expect(dir).toBe(path.join(tmpDir, 'My Group'));
        const manifest = await fs.readJson(path.join(dir, '.group.json'));
        expect(manifest.slug).toBe('my-group-123');
        expect(manifest.groupName).toBe('My Group');
    });

    it('renames a legacy slug-named folder to the display name', async () => {
        const legacy = path.join(tmpDir, 'spookluke-vault-2637');
        await fs.ensureDir(path.join(legacy, 'Some Course'));
        await fs.writeFile(path.join(legacy, 'Some Course', 'index.html'), 'content');

        const dir = await reconcileGroupDir(tmpDir, 'Grand Champ Bootcamp [FREE]', 'spookluke-vault-2637', silentLogger);

        expect(dir).toBe(path.join(tmpDir, 'Grand Champ Bootcamp [FREE]'));
        expect(fs.existsSync(legacy)).toBe(false);
        expect(await fs.readFile(path.join(dir, 'Some Course', 'index.html'), 'utf-8')).toBe('content');
        expect((await fs.readJson(path.join(dir, '.group.json'))).slug).toBe('spookluke-vault-2637');
    });

    it('renames a folder identified by .group.json after a display-name change', async () => {
        // First run archives under the old display name...
        await reconcileGroupDir(tmpDir, 'Old Name', 'stable-slug-1', silentLogger);
        await fs.writeFile(path.join(tmpDir, 'Old Name', 'marker.txt'), 'x');

        // ...the group is renamed on Skool, next run uses the new name.
        const dir = await reconcileGroupDir(tmpDir, 'New Name', 'stable-slug-1', silentLogger);

        expect(dir).toBe(path.join(tmpDir, 'New Name'));
        expect(fs.existsSync(path.join(tmpDir, 'Old Name'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'marker.txt'))).toBe(true);
        expect((await fs.readJson(path.join(dir, '.group.json'))).groupName).toBe('New Name');
    });

    it('leaves both folders alone and warns when target and legacy both exist', async () => {
        await fs.ensureDir(path.join(tmpDir, 'Display Name'));
        await fs.ensureDir(path.join(tmpDir, 'the-slug'));
        const warnings: string[] = [];
        const logger = { ...silentLogger, warn: (m: string) => warnings.push(m) };

        const dir = await reconcileGroupDir(tmpDir, 'Display Name', 'the-slug', logger);

        expect(dir).toBe(path.join(tmpDir, 'Display Name'));
        expect(fs.existsSync(path.join(tmpDir, 'the-slug'))).toBe(true);
        expect(warnings.some(w => w.includes('split'))).toBe(true);
    });

    it('is a no-op rename-wise when the folder already has the right name', async () => {
        await fs.ensureDir(path.join(tmpDir, 'Stable Group'));
        await fs.writeFile(path.join(tmpDir, 'Stable Group', 'marker.txt'), 'x');

        const dir = await reconcileGroupDir(tmpDir, 'Stable Group', 'stable-group', silentLogger);

        expect(dir).toBe(path.join(tmpDir, 'Stable Group'));
        expect(fs.existsSync(path.join(dir, 'marker.txt'))).toBe(true);
    });

    it('handles a group whose display name equals its slug', async () => {
        await fs.ensureDir(path.join(tmpDir, 'ai-automation-vault'));
        const warnings: string[] = [];
        const logger = { ...silentLogger, warn: (m: string) => warnings.push(m) };

        const dir = await reconcileGroupDir(tmpDir, 'ai-automation-vault', 'ai-automation-vault', logger);

        expect(dir).toBe(path.join(tmpDir, 'ai-automation-vault'));
        // Same folder is target and "legacy" — must not warn about a split.
        expect(warnings).toEqual([]);
    });

    it('skips manifest writing when no slug is known', async () => {
        const dir = await reconcileGroupDir(tmpDir, 'No Slug Group', null, silentLogger);

        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.existsSync(path.join(dir, '.group.json'))).toBe(false);
    });
});
