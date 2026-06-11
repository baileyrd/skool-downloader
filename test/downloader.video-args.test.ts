import { describe, expect, it } from 'vitest';

import { buildVideoArgs, redactUrlForLog } from '../src/downloader.js';

const URL = 'https://stream.mux.com/abc123.m3u8';
const OUTPUT = '/tmp/out/video.mp4';

describe('buildVideoArgs', () => {
    it('includes --ffmpeg-location when an ffmpeg path is provided', () => {
        const args = buildVideoArgs(URL, OUTPUT, {
            ffmpegLocation: '/opt/ffmpeg-static/ffmpeg'
        });

        const flagIndex = args.indexOf('--ffmpeg-location');
        expect(flagIndex).toBeGreaterThan(-1);
        expect(args[flagIndex + 1]).toBe('/opt/ffmpeg-static/ffmpeg');
    });

    it('omits --ffmpeg-location when ffmpeg-static has no binary (null)', () => {
        const args = buildVideoArgs(URL, OUTPUT, { ffmpegLocation: null });

        expect(args).not.toContain('--ffmpeg-location');
    });

    it('omits --ffmpeg-location by default', () => {
        const args = buildVideoArgs(URL, OUTPUT);

        expect(args).not.toContain('--ffmpeg-location');
    });

    it('includes --cookies only when a cookies path is provided', () => {
        const withCookies = buildVideoArgs(URL, OUTPUT, {
            cookiesPath: '/tmp/.auth/cookies.txt'
        });
        const cookiesIndex = withCookies.indexOf('--cookies');
        expect(cookiesIndex).toBeGreaterThan(-1);
        expect(withCookies[cookiesIndex + 1]).toBe('/tmp/.auth/cookies.txt');

        const withoutCookies = buildVideoArgs(URL, OUTPUT, { cookiesPath: null });
        expect(withoutCookies).not.toContain('--cookies');
    });

    it('always starts with the url and output path and merges to mp4', () => {
        const args = buildVideoArgs(URL, OUTPUT);

        expect(args[0]).toBe(URL);
        expect(args[args.indexOf('-o') + 1]).toBe(OUTPUT);
        expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mp4');
    });

    it('never disables TLS certificate verification', () => {
        const variants = [
            buildVideoArgs(URL, OUTPUT),
            buildVideoArgs(URL, OUTPUT, {
                ffmpegLocation: '/opt/ffmpeg-static/ffmpeg',
                cookiesPath: '/tmp/.auth/cookies.txt'
            })
        ];

        for (const args of variants) {
            expect(args).not.toContain('--no-check-certificates');
            expect(args).not.toContain('--no-check-certificate');
        }
    });

    it('caps quality at 1080p with mp4-friendly codecs by default', () => {
        const args = buildVideoArgs(URL, OUTPUT);

        const sortIndex = args.indexOf('-S');
        expect(sortIndex).toBeGreaterThan(-1);
        expect(args[sortIndex + 1]).toBe('res:1080,vcodec:h264,acodec:m4a');
        // --prefer-free-formats selected 4K VP9/Opus into .mp4 containers:
        // huge files with patchy player support. It must stay gone.
        expect(args).not.toContain('--prefer-free-formats');
    });

    it('uses the given numeric quality as the resolution cap', () => {
        const args = buildVideoArgs(URL, OUTPUT, { quality: 720 });

        expect(args[args.indexOf('-S') + 1]).toBe('res:720,vcodec:h264,acodec:m4a');
    });

    it("applies no format sorting for quality 'best'", () => {
        const args = buildVideoArgs(URL, OUTPUT, { quality: 'best' });

        expect(args).not.toContain('-S');
    });
});

describe('redactUrlForLog', () => {
    it('strips signed tokens from stream URLs', () => {
        const redacted = redactUrlForLog('https://stream.video.skool.com/abc123.m3u8?token=eyJsecret.payload');

        expect(redacted).not.toContain('eyJsecret');
        expect(redacted).toBe('https://stream.video.skool.com/abc123.m3u8?…');
    });

    it('leaves query-less URLs intact', () => {
        expect(redactUrlForLog('https://youtu.be/abc123')).toBe('https://youtu.be/abc123');
    });

    it('truncates unparseable strings instead of echoing them', () => {
        const junk = 'not a url '.repeat(20);
        const redacted = redactUrlForLog(junk);
        expect(redacted.length).toBeLessThanOrEqual(100);
    });
});
