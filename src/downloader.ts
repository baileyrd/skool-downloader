import YTDlpWrapPkg from 'yt-dlp-wrap';
import ffmpegStaticPkg from 'ffmpeg-static';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import { createHash } from 'node:crypto';
import { Readable } from 'stream';
import { pipeline } from 'node:stream/promises';
import { createConsoleLogger, type Logger } from './logger.js';
import { COOKIES_TXT_PATH } from './auth.js';

const YTDlpWrap = (YTDlpWrapPkg as any).default || YTDlpWrapPkg;

// ffmpeg-static is CJS whose typings confuse NodeNext interop; at runtime the
// default import is the binary path string, or null on unsupported platforms.
const ffmpegPath = ((ffmpegStaticPkg as any).default ?? ffmpegStaticPkg) as string | null;

const BIN_DIR = path.join(process.cwd(), 'bin');
const YTDLP_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

const IMG_SRC_REGEX = /(<img[^>]+src=")([^">]+)(")/g;

/**
 * Build a collision-resistant local filename for a remote image URL.
 *
 * The name is `img_<first 10 hex chars of sha1(url)>_<sanitized basename>`,
 * so two different URLs sharing a basename never map to the same file.
 *
 * @param url - The remote image URL (must be http/https).
 * @returns The local filename, or `null` if the URL cannot be parsed.
 */
export function buildImageFilename(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    const hash = createHash('sha1').update(url).digest('hex').substring(0, 10);

    let basename = path.basename(parsed.pathname);
    // Strip anything unsafe for filesystems; keep alphanumerics, dot, dash, underscore.
    basename = basename.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Guard against empty or dot-only basenames (e.g. URL path "/" or "/..").
    if (!basename || /^\.+$/.test(basename)) {
        basename = 'image';
    }

    return `img_${hash}_${basename}`;
}

/**
 * Rewrite every `<img src="...">` occurrence whose URL appears in the map.
 *
 * Replacement happens only within matched `src` attributes, so a URL that is
 * a prefix of another URL (or appears in surrounding text) is never corrupted.
 *
 * @param html - The HTML to rewrite.
 * @param urlToLocalPath - Map from remote URL to local relative path.
 * @returns The rewritten HTML.
 */
export function rewriteImageSrcs(html: string, urlToLocalPath: Map<string, string>): string {
    return html.replace(IMG_SRC_REGEX, (match, prefix: string, src: string, suffix: string) => {
        const localPath = urlToLocalPath.get(src);
        if (localPath === undefined) return match;
        return `${prefix}${localPath}${suffix}`;
    });
}
/**
 * Build the yt-dlp argument list for a single video download.
 *
 * Exported as a pure function so the argument wiring (notably
 * `--ffmpeg-location`) can be unit tested without spawning yt-dlp.
 *
 * @param url - The video URL to download.
 * @param outputPath - Absolute path of the target .mp4 file.
 * @param options - Optional paths discovered at runtime.
 * @param options.ffmpegLocation - Path to a managed ffmpeg binary
 *   (from `ffmpeg-static`), or `null` if none is available for this
 *   platform. When `null`, yt-dlp falls back to a system ffmpeg.
 * @param options.cookiesPath - Path to a Netscape cookies.txt file,
 *   or `null` to omit cookies.
 * @returns The argument array to pass to yt-dlp.
 */
export function buildVideoArgs(
    url: string,
    outputPath: string,
    options: { ffmpegLocation?: string | null; cookiesPath?: string | null } = {}
): string[] {
    const args = [
        url,
        '-o', outputPath,
        '--prefer-free-formats',
        '--add-header', 'Referer:https://www.skool.com/',
        '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        '--merge-output-format', 'mp4',
        '-N', '16',
        '--postprocessor-args', 'ffmpeg:-movflags +faststart'
    ];

    if (options.ffmpegLocation) {
        args.push('--ffmpeg-location', options.ffmpegLocation);
    }

    if (options.cookiesPath) {
        args.push('--cookies', options.cookiesPath);
    }

    return args;
}

export class Downloader {
    private ytDlp: any = null;
    private initPromise: Promise<void> | null = null;
    private logger: Logger;

    constructor(logger: Logger = createConsoleLogger()) {
        this.logger = logger;
    }

    async init() {
        if (this.initPromise) return this.initPromise;
        
        this.initPromise = (async () => {
            if (!fs.existsSync(BIN_DIR)) {
                await fs.ensureDir(BIN_DIR);
            }

            if (!fs.existsSync(YTDLP_PATH)) {
                this.logger.info('Downloading yt-dlp binary locally...');
                await YTDlpWrap.downloadFromGithub(YTDLP_PATH);
                if (process.platform !== 'win32') {
                    await fs.chmod(YTDLP_PATH, 0o755);
                }
            }
            this.ytDlp = new YTDlpWrap(YTDLP_PATH);
        })();

        return this.initPromise;
    }

    async downloadVideo(url: string, outputDir: string, filename: string) {
        if (!this.ytDlp) await this.init();

        await fs.ensureDir(outputDir);
        const outputPath = path.join(outputDir, `${filename}.mp4`);

        // Skip if video already exists
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            if (stats.size > 0) {
                this.logger.info(`    ⏭️  Video already exists, skipping download (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
                return;
            }
        }

        const displayUrl = url.length > 100 ? url.substring(0, 97) + '...' : url;
        this.logger.info(`    ⬇️  Downloading video from ${displayUrl}`);

        // ffmpeg-static resolves to a bundled static ffmpeg binary, or null
        // on platforms it does not ship binaries for. Without ffmpeg, yt-dlp
        // cannot merge separate audio/video streams or apply +faststart.
        if (!ffmpegPath) {
            this.logger.warn(
                '    ⚠️ No bundled ffmpeg available for this platform. ' +
                'Stream merging requires ffmpeg — install it system-wide ' +
                'and ensure it is on your PATH.'
            );
        }

        const args = buildVideoArgs(url, outputPath, {
            ffmpegLocation: ffmpegPath,
            cookiesPath: fs.existsSync(COOKIES_TXT_PATH) ? COOKIES_TXT_PATH : null
        });

        try {
            await this.ytDlp!.execPromise(args);
            this.logger.info(`Video downloaded successfully to ${outputDir}`);
        } catch (error) {
            this.logger.error(`Error downloading video: ${String(error)}`);
            throw error;
        }
    }

    /**
     * Download a single asset to `outputPath`.
     *
     * The body is streamed to `<outputPath>.tmp` and renamed onto the final
     * path only after the download completes, so an interrupted download never
     * leaves a partial file at the final path. Errors from either the response
     * stream or the file writer reject the returned promise.
     *
     * Resolves immediately (without contacting the server) if a non-empty file
     * already exists at the final path.
     *
     * @param url - The asset URL to download.
     * @param outputPath - Absolute path the asset should land at.
     */
    async downloadAsset(url: string, outputPath: string): Promise<void> {
        await fs.ensureDir(path.dirname(outputPath));

        // Skip if asset already exists. Sound because partial downloads only
        // ever live at the .tmp path, never at the final path.
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            if (stats.size > 0) {
                return; // Silently skip, caller will handle messaging
            }
        }

        // axios rejects on non-2xx status by default, so HTTP errors throw here.
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'Referer': 'https://www.skool.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });

        const tmpPath = `${outputPath}.tmp`;
        try {
            // pipeline propagates errors from both the response stream and the
            // writer, and destroys both streams on failure.
            await pipeline(response.data as Readable, fs.createWriteStream(tmpPath));
            await fs.move(tmpPath, outputPath, { overwrite: true });
        } catch (error) {
            // Best-effort cleanup of the partial temp file; the original
            // download error is what the caller needs to see.
            await fs.remove(tmpPath).catch(() => undefined);
            throw error;
        }
    }

    async localizeImages(html: string, outputDir: string): Promise<string> {
        const assetsDir = path.join(outputDir, 'assets');
        const urlToLocalPath = new Map<string, string>();
        const tasks: { url: string; outputPath: string }[] = [];

        let match;
        const imgRegex = new RegExp(IMG_SRC_REGEX.source, 'g');
        while ((match = imgRegex.exec(html)) !== null) {
            const url = match[2];
            if (!url) continue;
            if (!url.startsWith('http')) continue;
            if (urlToLocalPath.has(url)) continue;

            const filename = buildImageFilename(url);
            if (filename === null) {
                this.logger.warn(`      ⚠️ Skipping unparseable image URL: ${url}`);
                continue;
            }

            urlToLocalPath.set(url, `assets/${filename}`);
            tasks.push({ url, outputPath: path.join(assetsDir, filename) });
        }

        const processedHtml = rewriteImageSrcs(html, urlToLocalPath);

        if (tasks.length > 0) {
            this.logger.info(`      🖼️  Localizing ${tasks.length} images...`);
            await Promise.all(tasks.map(task =>
                this.downloadAsset(task.url, task.outputPath).catch(() =>
                    this.logger.warn(`      ⚠️ Failed to localize image: ${task.url}`)
                )
            ));
        }

        return processedHtml;
    }
}
