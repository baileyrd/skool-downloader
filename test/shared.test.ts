import { describe, expect, it } from 'vitest';

import { sanitizeName } from '../src/shared.js';

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
