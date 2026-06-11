import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('treats a bare URL as a download command', () => {
        const parsed = parseArgs(['https://www.skool.com/group/classroom/abc']);
        expect(parsed.command).toBe('download');
        expect(parsed.url).toBe('https://www.skool.com/group/classroom/abc');
    });

    it('parses output and concurrency flags', () => {
        const parsed = parseArgs([
            'https://www.skool.com/group/classroom/abc',
            '-o', '/tmp/out',
            '-c', '4'
        ]);
        expect(parsed.outputDir).toBe('/tmp/out');
        expect(parsed.concurrency).toBe(4);
    });

    it('parses long flag aliases', () => {
        const parsed = parseArgs([
            '--output', '/tmp/out2',
            '--concurrency', '12',
            'https://www.skool.com/g/classroom/x'
        ]);
        expect(parsed.outputDir).toBe('/tmp/out2');
        expect(parsed.concurrency).toBe(12);
    });

    it('parses mode flags', () => {
        expect(parseArgs(['--course']).mode).toBe('course');
        expect(parseArgs(['--lesson']).mode).toBe('lesson');
    });

    it('parses --lesson-id and consumes its value', () => {
        const parsed = parseArgs(['--lesson-id', 'https-looking-id']);
        expect(parsed.lessonId).toBe('https-looking-id');
        expect(parsed.url).toBeUndefined();
    });

    it('parses login command', () => {
        expect(parseArgs(['login']).command).toBe('login');
    });

    it('parses regenerate-index without a directory', () => {
        const parsed = parseArgs(['regenerate-index']);
        expect(parsed.command).toBe('regenerate-index');
        expect(parsed.regenerateDir).toBeUndefined();
    });

    it('captures the regenerate-index directory and does not re-process it', () => {
        const parsed = parseArgs(['regenerate-index', 'http-mirror-downloads']);
        expect(parsed.command).toBe('regenerate-index');
        expect(parsed.regenerateDir).toBe('http-mirror-downloads');
        // The directory must be consumed, not re-parsed as a download URL.
        expect(parsed.url).toBeUndefined();
    });

    it('parses help flags', () => {
        expect(parseArgs(['-h']).command).toBe('help');
        expect(parseArgs(['--help']).command).toBe('help');
    });

    it('warns on stderr about unrecognized flags and ignores them', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const parsed = parseArgs(['--bogus', 'https://www.skool.com/g/classroom']);
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('--bogus')
        );
        expect(parsed.url).toBe('https://www.skool.com/g/classroom');
    });

    it('parses --force', () => {
        const parsed = parseArgs(['https://www.skool.com/g/classroom', '--force']);
        expect(parsed.force).toBe(true);
        expect(parseArgs(['https://www.skool.com/g/classroom']).force).toBeUndefined();
    });

    it('parses numeric --quality and -q values', () => {
        expect(parseArgs(['-q', '720']).quality).toBe(720);
        expect(parseArgs(['--quality', '1440']).quality).toBe(1440);
    });

    it("parses --quality best", () => {
        expect(parseArgs(['--quality', 'best']).quality).toBe('best');
    });

    it('warns and ignores invalid --quality values', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const parsed = parseArgs(['--quality', 'potato', 'https://www.skool.com/g/classroom']);
        expect(parsed.quality).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('potato'));
        // The invalid value must still be consumed, not parsed as a URL/arg.
        expect(parsed.url).toBe('https://www.skool.com/g/classroom');
    });
});
