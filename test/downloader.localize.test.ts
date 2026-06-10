import { describe, expect, it } from 'vitest';

import { Downloader, buildImageFilename, rewriteImageSrcs } from '../src/downloader.js';
import { createConsoleLogger } from '../src/logger.js';

const silentLogger = createConsoleLogger({ silent: true });

/**
 * Downloader subclass that records scheduled downloads instead of hitting the network.
 */
class StubDownloader extends Downloader {
    downloads: { url: string; outputPath: string }[] = [];

    override async downloadAsset(url: string, outputPath: string): Promise<void> {
        this.downloads.push({ url, outputPath });
    }
}

describe('buildImageFilename', () => {
    it('gives different filenames to different URLs with the same basename', () => {
        const a = buildImageFilename('https://cdn.example.com/courses/1/image.png');
        const b = buildImageFilename('https://cdn.example.com/courses/2/image.png');
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a).not.toBe(b);
        expect(a).toMatch(/^img_[0-9a-f]{10}_image\.png$/);
        expect(b).toMatch(/^img_[0-9a-f]{10}_image\.png$/);
    });

    it('is deterministic for the same URL', () => {
        const url = 'https://cdn.example.com/a/photo.jpg';
        expect(buildImageFilename(url)).toBe(buildImageFilename(url));
    });

    it('returns null for an unparseable URL', () => {
        expect(buildImageFilename('http://')).toBeNull();
    });

    it('falls back to a safe name when the basename is empty', () => {
        const filename = buildImageFilename('https://cdn.example.com/');
        expect(filename).toMatch(/^img_[0-9a-f]{10}_image$/);
    });

    it('sanitizes unsafe characters in the basename', () => {
        const filename = buildImageFilename('https://cdn.example.com/a%20b%3Cc.png');
        expect(filename).not.toBeNull();
        expect(filename!).toMatch(/^img_[0-9a-f]{10}_[a-zA-Z0-9._-]+$/);
    });
});

describe('rewriteImageSrcs', () => {
    it('rewrites every occurrence of the same URL', () => {
        const url = 'https://cdn.example.com/pic.png';
        const html = `<p><img src="${url}"></p><div><img src="${url}"></div>`;
        const result = rewriteImageSrcs(html, new Map([[url, 'assets/local.png']]));
        expect(result).toBe('<p><img src="assets/local.png"></p><div><img src="assets/local.png"></div>');
    });

    it('handles a URL that is a prefix of another URL without corruption', () => {
        const short = 'https://cdn.example.com/pic';
        const long = 'https://cdn.example.com/pic.png';
        const html = `<img src="${short}"><img src="${long}">`;
        const map = new Map([
            [short, 'assets/short.bin'],
            [long, 'assets/long.png'],
        ]);
        const result = rewriteImageSrcs(html, map);
        expect(result).toBe('<img src="assets/short.bin"><img src="assets/long.png">');
    });

    it('leaves URLs outside img src attributes untouched', () => {
        const url = 'https://cdn.example.com/pic.png';
        const html = `<a href="${url}">link</a><img src="${url}">`;
        const result = rewriteImageSrcs(html, new Map([[url, 'assets/local.png']]));
        expect(result).toBe(`<a href="${url}">link</a><img src="assets/local.png">`);
    });

    it('leaves srcs not in the map untouched', () => {
        const html = '<img src="data:image/png;base64,AAAA"><img src="./relative.png">';
        expect(rewriteImageSrcs(html, new Map())).toBe(html);
    });
});

describe('Downloader.localizeImages', () => {
    it('rewrites colliding basenames to distinct local files', async () => {
        const downloader = new StubDownloader(silentLogger);
        const html =
            '<img src="https://cdn.example.com/a/image.png">' +
            '<img src="https://cdn.example.com/b/image.png">';

        const result = await downloader.localizeImages(html, '/tmp/out');

        expect(downloader.downloads).toHaveLength(2);
        const paths = downloader.downloads.map(d => d.outputPath);
        expect(new Set(paths).size).toBe(2);
        expect(result).not.toContain('https://cdn.example.com');
        const localSrcs = [...result.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
        expect(new Set(localSrcs).size).toBe(2);
    });

    it('rewrites both occurrences of a duplicate URL but downloads it once', async () => {
        const downloader = new StubDownloader(silentLogger);
        const url = 'https://cdn.example.com/dup.png';
        const html = `<img src="${url}"><p>text</p><img src="${url}">`;

        const result = await downloader.localizeImages(html, '/tmp/out');

        expect(downloader.downloads).toHaveLength(1);
        expect(result).not.toContain(url);
        expect(result.match(/src="assets\/img_[0-9a-f]{10}_dup\.png"/g)).toHaveLength(2);
    });

    it('rewrites prefix-overlapping URLs correctly', async () => {
        const downloader = new StubDownloader(silentLogger);
        const short = 'https://cdn.example.com/pic';
        const long = 'https://cdn.example.com/pic.png';
        const html = `<img src="${short}"><img src="${long}">`;

        const result = await downloader.localizeImages(html, '/tmp/out');

        expect(downloader.downloads).toHaveLength(2);
        const localSrcs = [...result.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
        expect(localSrcs).toHaveLength(2);
        expect(localSrcs[0]).toMatch(/^assets\/img_[0-9a-f]{10}_pic$/);
        expect(localSrcs[1]).toMatch(/^assets\/img_[0-9a-f]{10}_pic\.png$/);
    });

    it('leaves non-http srcs untouched and downloads nothing for them', async () => {
        const downloader = new StubDownloader(silentLogger);
        const html = '<img src="data:image/png;base64,AAAA"><img src="./relative.png">';

        const result = await downloader.localizeImages(html, '/tmp/out');

        expect(downloader.downloads).toHaveLength(0);
        expect(result).toBe(html);
    });

    it('skips an unparseable URL without throwing', async () => {
        const downloader = new StubDownloader(silentLogger);
        const html = '<img src="http://"><img src="https://cdn.example.com/ok.png">';

        const result = await downloader.localizeImages(html, '/tmp/out');

        expect(downloader.downloads).toHaveLength(1);
        expect(result).toContain('src="http://"');
        expect(result).toMatch(/src="assets\/img_[0-9a-f]{10}_ok\.png"/);
    });
});
