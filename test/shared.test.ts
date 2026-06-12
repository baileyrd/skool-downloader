import { describe, expect, it } from 'vitest';

import { assignResourceFileNames, buildVideoFileName, formatBytes, sanitizeName } from '../src/shared.js';

describe('formatBytes', () => {
    it('formats sub-GiB sizes in MB', () => {
        expect(formatBytes(310 * 1024 * 1024)).toBe('310.0 MB');
        expect(formatBytes(0)).toBe('0.0 MB');
    });

    it('formats GiB-scale sizes in GB', () => {
        expect(formatBytes(4.5 * 1024 * 1024 * 1024)).toBe('4.50 GB');
    });
});

describe('sanitizeName', () => {
    it('replaces illegal filename characters with dashes', () => {
        expect(sanitizeName('a/b\\c?d%e*f:g|h"i<j>k')).toBe('a-b-c-d-e-f-g-h-i-j-k');
    });

    it('leaves safe names untouched', () => {
        expect(sanitizeName('Lesson 1 - Intro (2024)')).toBe('Lesson 1 - Intro (2024)');
    });

    it('trims trailing dots and spaces (invalid on Windows)', () => {
        expect(sanitizeName('Module One.')).toBe('Module One');
        expect(sanitizeName('Module Two ')).toBe('Module Two');
        expect(sanitizeName('Module Three. . .')).toBe('Module Three');
    });

    it('keeps interior dots and spaces', () => {
        expect(sanitizeName('v1.2 notes.txt')).toBe('v1.2 notes.txt');
    });

    it('prefixes Windows reserved device names with an underscore', () => {
        expect(sanitizeName('CON')).toBe('_CON');
        expect(sanitizeName('con')).toBe('_con');
        expect(sanitizeName('PRN')).toBe('_PRN');
        expect(sanitizeName('AUX')).toBe('_AUX');
        expect(sanitizeName('NUL')).toBe('_NUL');
        expect(sanitizeName('COM1')).toBe('_COM1');
        expect(sanitizeName('com9')).toBe('_com9');
        expect(sanitizeName('LPT1')).toBe('_LPT1');
        expect(sanitizeName('lpt9')).toBe('_lpt9');
    });

    it('detects reserved names before an extension', () => {
        expect(sanitizeName('CON.txt')).toBe('_CON.txt');
        expect(sanitizeName('nul.tar.gz')).toBe('_nul.tar.gz');
    });

    it('does not prefix names that merely contain a reserved name', () => {
        expect(sanitizeName('CONSOLE')).toBe('CONSOLE');
        expect(sanitizeName('COM10')).toBe('COM10');
        expect(sanitizeName('falcon')).toBe('falcon');
    });

    it('returns an underscore for empty or all-trimmed input', () => {
        expect(sanitizeName('')).toBe('_');
        expect(sanitizeName('   ')).toBe('_');
        expect(sanitizeName('...')).toBe('_');
    });
});

describe('buildVideoFileName', () => {
    it('builds "<index> - <title>.mp4"', () => {
        expect(buildVideoFileName(2, 'Next Steps')).toBe('2 - Next Steps.mp4');
    });

    it('sanitizes filesystem-unsafe characters in the title', () => {
        expect(buildVideoFileName(1, 'Free VS Paid Group: What You Get!'))
            .toBe('1 - Free VS Paid Group- What You Get!.mp4');
    });

    it('truncates long stems and strips trailing dots/spaces left by the cut', () => {
        const name = buildVideoFileName(28, `${'A'.repeat(50)}. ${'B'.repeat(50)}`);
        expect(name.endsWith('.mp4')).toBe(true);
        // stem (without extension) capped at 60 chars
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).not.toMatch(/[. ]\.mp4$/);
    });

    it('never returns a bare extension for degenerate titles', () => {
        const name = buildVideoFileName(3, '...');
        expect(name).toMatch(/\.mp4$/);
        expect(name.replace(/\.mp4$/, '').trim().length).toBeGreaterThan(0);
    });
});

describe('assignResourceFileNames', () => {
    it('keeps plain base names when there are no collisions', () => {
        const resources = [
            { title: 'Notes', file_name: 'notes.pdf' },
            { title: 'Slides', file_name: 'slides.pptx' },
            { title: 'No file name' }
        ];
        const names = assignResourceFileNames(resources);
        expect(names.get(resources[0])).toBe('notes.pdf');
        expect(names.get(resources[1])).toBe('slides.pptx');
        expect(names.get(resources[2])).toBe('No file name');
    });

    it('prefixes colliding base names with the resource title', () => {
        // Real case: three different Claude Code skills, all attached as
        // SKILL.md. Without disambiguation they raced on the same path and
        // every copy was lost.
        const resources = [
            { title: 'lightrag-query', file_name: 'SKILL.md' },
            { title: 'lightrag-status', file_name: 'SKILL.md' },
            { title: 'lightrag-upload', file_name: 'SKILL.md' }
        ];
        const names = assignResourceFileNames(resources);
        expect(names.get(resources[0])).toBe('lightrag-query-SKILL.md');
        expect(names.get(resources[1])).toBe('lightrag-status-SKILL.md');
        expect(names.get(resources[2])).toBe('lightrag-upload-SKILL.md');
    });

    it('falls back to numeric prefixes when titles collide too', () => {
        const resources = [
            { title: 'Skill', file_name: 'SKILL.md' },
            { title: 'Skill', file_name: 'SKILL.md' }
        ];
        const names = assignResourceFileNames(resources);
        const assigned = [names.get(resources[0]), names.get(resources[1])];
        expect(new Set(assigned).size).toBe(2);
        expect(assigned[0]).toBe('Skill-SKILL.md');
        expect(assigned[1]).toBe('2-Skill-SKILL.md');
    });

    it('handles title-derived base names that collide', () => {
        const resources = [
            { title: 'Starter Code' },
            { title: 'Starter Code' }
        ];
        const names = assignResourceFileNames(resources);
        const assigned = [names.get(resources[0]), names.get(resources[1])];
        expect(new Set(assigned).size).toBe(2);
    });

    it('sanitizes unsafe characters in assigned names', () => {
        const resources = [{ title: 'a/b', file_name: 'c:d.txt' }];
        expect(assignResourceFileNames(resources).get(resources[0])).toBe('c-d.txt');
    });

    it('never assigns the same name twice across a large mixed list', () => {
        const resources = [
            { title: 'One', file_name: 'file.md' },
            { title: 'Two', file_name: 'file.md' },
            { title: 'One', file_name: 'file.md' },
            { title: 'file.md' },
            { title: 'Other', file_name: 'other.md' }
        ];
        const names = assignResourceFileNames(resources);
        expect(new Set(names.values()).size).toBe(resources.length);
    });
});
