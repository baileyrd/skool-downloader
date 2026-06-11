import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import fs from 'fs-extra';

import { Downloader } from '../src/downloader.js';
import { createConsoleLogger } from '../src/logger.js';

const silentLogger = createConsoleLogger({ silent: true });

/**
 * Start a local HTTP server on an ephemeral port and resolve its base URL.
 */
function startServer(handler: http.RequestListener): Promise<{ server: http.Server; baseUrl: string }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

/** Any leftover temp files (with any unique suffix) in `dir`. */
async function listTmpFiles(dir: string): Promise<string[]> {
    try {
        return (await fs.readdir(dir)).filter(name => name.endsWith('.tmp'));
    } catch {
        return [];
    }
}

describe('Downloader.downloadAsset', () => {
    let tmpDir: string;
    const servers: http.Server[] = [];

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skool-asset-test-'));
    });

    afterEach(async () => {
        await Promise.all(servers.map(server =>
            new Promise<void>(resolve => server.close(() => resolve()))
        ));
        servers.length = 0;
        await fs.remove(tmpDir);
    });

    it('writes the exact bytes to the final path and leaves no .tmp behind', async () => {
        const body = 'hello asset bytes';
        const { server, baseUrl } = await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(body);
        });
        servers.push(server);

        const outputPath = path.join(tmpDir, 'assets', 'pic.png');
        const downloader = new Downloader(silentLogger);

        await downloader.downloadAsset(`${baseUrl}/pic.png`, outputPath);

        expect(await fs.readFile(outputPath, 'utf-8')).toBe(body);
        expect(await listTmpFiles(path.dirname(outputPath))).toEqual([]);
    });

    it('survives concurrent downloads to the same final path (no shared tmp race)', async () => {
        const body = 'same destination bytes';
        const { server, baseUrl } = await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/markdown' });
            // Small delay keeps the downloads overlapping.
            setTimeout(() => res.end(body), 30);
        });
        servers.push(server);

        const outputPath = path.join(tmpDir, 'resources', 'SKILL.md');
        const downloader = new Downloader(silentLogger);

        // Pre-B9 this raced on a shared SKILL.md.tmp: ENOENT crashes and a
        // missing final file. With per-call tmp names, every call succeeds.
        await Promise.all([
            downloader.downloadAsset(`${baseUrl}/a`, outputPath),
            downloader.downloadAsset(`${baseUrl}/b`, outputPath),
            downloader.downloadAsset(`${baseUrl}/c`, outputPath)
        ]);

        expect(await fs.readFile(outputPath, 'utf-8')).toBe(body);
        expect(await listTmpFiles(path.dirname(outputPath))).toEqual([]);
    });

    it('rejects (does not hang) when the response stream errors mid-body, leaving no files', async () => {
        const { server, baseUrl } = await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '1000000' });
            res.write('partial body before the connection drops');
            // Destroy the socket mid-body to simulate a network drop.
            setTimeout(() => res.destroy(), 50);
        });
        servers.push(server);

        const outputPath = path.join(tmpDir, 'assets', 'dropped.png');
        const downloader = new Downloader(silentLogger);

        await expect(
            downloader.downloadAsset(`${baseUrl}/dropped.png`, outputPath)
        ).rejects.toThrow();

        expect(fs.existsSync(outputPath)).toBe(false);
        expect(await listTmpFiles(path.dirname(outputPath))).toEqual([]);
    }, 4000);

    it('skips without contacting the server when a non-empty file already exists', async () => {
        let requestCount = 0;
        const { server, baseUrl } = await startServer((_req, res) => {
            requestCount++;
            res.writeHead(200);
            res.end('should never be fetched');
        });
        servers.push(server);

        const outputPath = path.join(tmpDir, 'assets', 'existing.png');
        await fs.ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, 'pre-existing content');

        const downloader = new Downloader(silentLogger);
        await downloader.downloadAsset(`${baseUrl}/existing.png`, outputPath);

        expect(requestCount).toBe(0);
        expect(await fs.readFile(outputPath, 'utf-8')).toBe('pre-existing content');
    });

    it('rejects an HTML response when rejectHtmlResponse is set, creating no files', async () => {
        const { server, baseUrl } = await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html>Sign in to continue</html>');
        });
        servers.push(server);

        const outputPath = path.join(tmpDir, 'resources', 'doc.pdf');
        const downloader = new Downloader(silentLogger);

        await expect(
            downloader.downloadAsset(`${baseUrl}/export`, outputPath, { rejectHtmlResponse: true })
        ).rejects.toThrow(/HTML page instead of a file/);

        expect(fs.existsSync(outputPath)).toBe(false);
        expect(await listTmpFiles(path.dirname(outputPath))).toEqual([]);
    });

    it('accepts a non-HTML response when rejectHtmlResponse is set', async () => {
        const body = '%PDF-1.4 fake pdf bytes';
        const { server, baseUrl } = await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/pdf' });
            res.end(body);
        });
        servers.push(server);

        const outputPath = path.join(tmpDir, 'resources', 'real.pdf');
        const downloader = new Downloader(silentLogger);

        await downloader.downloadAsset(`${baseUrl}/export`, outputPath, { rejectHtmlResponse: true });

        expect(await fs.readFile(outputPath, 'utf-8')).toBe(body);
    });

    it('still accepts HTML responses by default (option off)', async () => {
        const body = '<html>legit html asset</html>';
        const { server, baseUrl } = await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(body);
        });
        servers.push(server);

        const outputPath = path.join(tmpDir, 'assets', 'page.html');
        const downloader = new Downloader(silentLogger);

        await downloader.downloadAsset(`${baseUrl}/page.html`, outputPath);

        expect(await fs.readFile(outputPath, 'utf-8')).toBe(body);
    });

    it('rejects on HTTP 404 and creates no files', async () => {
        const { server, baseUrl } = await startServer((_req, res) => {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not found');
        });
        servers.push(server);

        const outputPath = path.join(tmpDir, 'assets', 'missing.png');
        const downloader = new Downloader(silentLogger);

        await expect(
            downloader.downloadAsset(`${baseUrl}/missing.png`, outputPath)
        ).rejects.toThrow();

        expect(fs.existsSync(outputPath)).toBe(false);
        expect(await listTmpFiles(path.dirname(outputPath))).toEqual([]);
    });
});
