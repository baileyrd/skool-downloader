import { chromium, errors as playwrightErrors, type Browser, type BrowserContext } from 'playwright';
import fs from 'fs-extra';
import pLimit from 'p-limit';
import { createConsoleLogger, type Logger } from './logger.js';
import { STORAGE_STATE_PATH } from './auth.js';
import { escapeHtml } from './html-escape.js';
import { assignResourceFileNames } from './shared.js';

// Native Skool (Mux) video extraction clicks play and lets the stream run
// while polling for the signed manifest URL. Each playing video decodes in
// the shared headless Chromium; at the default lesson concurrency of 8 that
// is eight simultaneous HLS players, which has crashed the browser process
// outright. Limit how many lessons interact with the player at once —
// everything else (page loads, metadata, resources) stays fully parallel.
const muxInteractionLimit = pLimit(2);

export interface Resource {
    title: string;
    file_id?: string;
    file_name?: string;
    file_content_type?: string;
    downloadUrl?: string;
    isExternal?: boolean;
}

export interface Lesson {
    id: string;
    title: string;
    url: string;
    index?: number;
    contentHtml?: string;
    videoLink?: string;
    /** The lesson has a native video but its stream URL could not be extracted. */
    videoExtractionFailed?: boolean;
    resources?: Resource[];
}

export interface Module {
    title: string;
    index: number;
    lessons: Lesson[];
    root?: boolean;
}

export interface ClassroomResult {
    groupName: string;
    courseName: string;
    courseImageUrl?: string;
    modules: Module[];
}

export interface CourseListItem {
    id?: string;
    name?: string;
    title: string;
    url: string;
    key: string;
    numModules?: number;
    coverImageUrl?: string;
    hasAccess?: boolean;
    privacy?: number;
    updatedAt?: string;
}

export interface CourseLibraryResult {
    groupName: string;
    classroomUrl: string;
    courses: CourseListItem[];
}

/**
 * Normalizes any classroom-related URL to the classroom root: strips query
 * and hash, and drops path segments after `/classroom` (e.g. a course slug).
 * Non-classroom URLs only get their query/hash stripped.
 *
 * Exported for unit testing.
 */
export function resolveClassroomRootUrl(inputUrl: string): string {
    const urlObj = new URL(inputUrl);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    const classroomIndex = segments.indexOf('classroom');
    if (classroomIndex === -1) {
        urlObj.search = '';
        urlObj.hash = '';
        return urlObj.toString();
    }
    const baseSegments = segments.slice(0, classroomIndex + 1);
    urlObj.pathname = `/${baseSegments.join('/')}`;
    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.toString();
}

export class Scraper {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private logger: Logger;

    constructor(logger: Logger = createConsoleLogger()) {
        this.logger = logger;
    }

    async init() {
        try {
            this.browser = await chromium.launch({ headless: true });
        } catch (error) {
            // Playwright browsers are not installed automatically on
            // `npm install` (no postinstall — it is slow and surprising).
            // Translate the raw launch error into an actionable message.
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("Executable doesn't exist")) {
                throw new Error(
                    'Playwright Chromium browser is not installed. ' +
                    'Run `npx playwright install chromium` once, then retry.',
                    { cause: error }
                );
            }
            throw error;
        }
        if (fs.existsSync(STORAGE_STATE_PATH)) {
            this.context = await this.browser.newContext({ storageState: STORAGE_STATE_PATH });
        } else {
            this.context = await this.browser.newContext();
        }
    }

    async close() {
        if (this.browser) await this.browser.close();
    }

    async parseClassroom(url: string): Promise<ClassroomResult> {
        if (!this.context) await this.init();
        const page = await this.context!.newPage();

        // Ensure we are using a clean classroom URL without query params for structure extraction
        const cleanUrl = url.split('?')[0]!;
        this.logger.info(`Navigating to ${cleanUrl}...`);
        await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        // __NEXT_DATA__ is part of the server-rendered HTML, so waiting for the
        // script element is both faster and more reliable than a fixed sleep.
        await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 15000 });

        const nextData = await page.evaluate(() => {
            const script = document.getElementById('__NEXT_DATA__');
            return script ? JSON.parse(script.innerText) : null;
        });

        await page.close();

        if (!nextData) throw new Error('Could not find __NEXT_DATA__ on classroom page');

        const pageProps = nextData.props?.pageProps || {};
        const courseData = pageProps.course;

        if (!courseData || !courseData.children) {
            this.logger.debug(`DEBUG: course metadata: ${JSON.stringify(courseData?.course?.metadata ?? {})}`);
            throw new Error('Course structure not found in __NEXT_DATA__');
        }

        // Extract Group (Community) Name. Must match parseCourseLibrary's
        // derivation (displayName first) — the two feed the same group folder
        // name, and disagreeing here splits the archive across two folders.
        const groupData = pageProps.currentGroup || {};
        const groupName =
            groupData.metadata?.displayName ||
            groupData.metadata?.name ||
            groupData.name ||
            'Unknown Group';

        // Extract Course Name
        let courseName = 'Unknown Course';
        if (courseData.metadata?.title) {
            courseName = courseData.metadata.title;
        } else if (courseData.course?.metadata?.title) {
            courseName = courseData.course.metadata.title;
        } else {
            // Fallback: match current URL segment with allCourses/renderData.allCourses
            const urlParts = cleanUrl.split('/');
            const urlCourseHandle = urlParts[urlParts.length - 1]; // e.g. "767876d4"
            const allCourses = pageProps.allCourses || pageProps.renderData?.allCourses || [];
            const foundCourse = allCourses.find((c: any) => c.name === urlCourseHandle);
            if (foundCourse?.metadata?.title) {
                courseName = foundCourse.metadata.title;
            }
        }

        // Extract Course Image
        let courseImageUrl: string | undefined =
            courseData.metadata?.coverImage ||
            courseData.metadata?.image ||
            courseData.metadata?.coverSmallUrl ||
            courseData.course?.metadata?.coverImage ||
            courseData.course?.metadata?.image ||
            courseData.course?.metadata?.coverSmallUrl;

        if (!courseImageUrl) {
            const urlParts = cleanUrl.split('/');
            const urlCourseHandle = urlParts[urlParts.length - 1];
            const allCourses = pageProps.allCourses || pageProps.renderData?.allCourses || [];
            const foundCourse = allCourses.find((c: any) => c.name === urlCourseHandle || c.id === courseData?.id);
            courseImageUrl =
                foundCourse?.metadata?.coverImage ||
                foundCourse?.metadata?.image ||
                foundCourse?.metadata?.coverSmallUrl;
        }

        this.logger.info(`🎓 Course detected: ${courseName}`);

        // Skool Hierarchy:
        // Children can be sets (modules) or standalone lessons.
        const modules: Module[] = [];
        let rootModule: Module | null = null;

        const childNodes = Array.isArray(courseData.children) ? courseData.children : [];
        childNodes.forEach((node: any) => {
            if (node?.children && node.children.length > 0) {
                const setInfo = node.course || {};
                const setTitle = setInfo.metadata?.title || setInfo.name || 'Untitled Section';

                const lessons: Lesson[] = (node.children || []).map((mod: any, lIdx: number) => {
                    const modInfo = mod.course || {};
                    return {
                        id: modInfo.id,
                        title: modInfo.metadata?.title || modInfo.name || 'Untitled Lesson',
                        url: `${cleanUrl}?md=${modInfo.id}`,
                        index: lIdx + 1
                    };
                }).filter((l: Lesson) => l.id);

                modules.push({
                    title: setTitle,
                    index: modules.length + 1,
                    lessons
                });
                return;
            }

            const lessonInfo = node?.course || {};
            if (lessonInfo?.id) {
                if (!rootModule) {
                    rootModule = {
                        title: 'Lessons',
                        index: modules.length + 1,
                        lessons: [],
                        root: true
                    };
                    modules.push(rootModule);
                }

                rootModule.lessons.push({
                    id: lessonInfo.id,
                    title: lessonInfo.metadata?.title || lessonInfo.name || 'Untitled Lesson',
                    url: `${cleanUrl}?md=${lessonInfo.id}`,
                    index: rootModule.lessons.length + 1
                });
            }
        });

        return {
            groupName,
            courseName,
            courseImageUrl,
            modules: modules.filter(m => m.lessons.length > 0)
        };
    }

    async parseCourseLibrary(url: string): Promise<CourseLibraryResult> {
        if (!this.context) await this.init();
        const page = await this.context!.newPage();

        const classroomUrl = resolveClassroomRootUrl(url);
        this.logger.info(`Navigating to ${classroomUrl}...`);
        await page.goto(classroomUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        // __NEXT_DATA__ is part of the server-rendered HTML, so waiting for the
        // script element is both faster and more reliable than a fixed sleep.
        await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 15000 });

        const nextData = await page.evaluate(() => {
            const script = document.getElementById('__NEXT_DATA__');
            return script ? JSON.parse(script.innerText) : null;
        });

        await page.close();

        if (!nextData) throw new Error('Could not find __NEXT_DATA__ on classroom page');

        const pageProps = nextData.props?.pageProps || {};
        const allCourses = pageProps.allCourses || pageProps.renderData?.allCourses || [];

        if (!Array.isArray(allCourses) || allCourses.length === 0) {
            throw new Error('No courses found in classroom __NEXT_DATA__.');
        }

        const groupData = pageProps.currentGroup || {};
        const groupName =
            groupData.metadata?.displayName ||
            groupData.metadata?.name ||
            groupData.name ||
            'Unknown Group';

        const baseUrl = classroomUrl.replace(/\/$/, '');

        const courses: CourseListItem[] = allCourses.map((course: any, index: number) => {
            const metadata = course.metadata || {};
            const courseSlug = course.name || course.id;
            const title = metadata.title || course.name || course.id || `Course ${index + 1}`;
            const url = courseSlug ? `${baseUrl}/${courseSlug}` : baseUrl;
            const hasAccess =
                metadata.hasAccess === 1 ? true : metadata.hasAccess === 0 ? false : undefined;

            return {
                id: course.id,
                name: course.name,
                title,
                url,
                key: course.id || course.name || url,
                numModules: metadata.numModules,
                coverImageUrl: metadata.coverImage || metadata.coverSmallUrl || metadata.image,
                hasAccess,
                privacy: metadata.privacy,
                updatedAt: course.updatedAt
            };
        }).filter(course => course.url !== baseUrl);

        if (courses.length === 0) {
            throw new Error('No valid courses found in classroom listing.');
        }

        return {
            groupName,
            classroomUrl,
            courses
        };
    }

    async extractLessonData(
        url: string,
        options: {
            /** Per-lesson logger (e.g. prefixed) overriding the instance logger. */
            logger?: Logger;
            /**
             * Filenames already present in the lesson's `resources/` folder.
             * Native resources whose base filename is in this set skip the
             * signed download-URL API call — the file will not be
             * re-downloaded anyway.
             */
            existingResourceFiles?: Set<string>;
        } = {}
    ): Promise<Lesson> {
        if (!this.context) await this.init();
        const logger = options.logger ?? this.logger;
        const page = await this.context!.newPage();

        // try/finally guarantees the page is closed even when extraction throws;
        // otherwise failed lessons leak pages into the shared browser context.
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            // __NEXT_DATA__ is part of the server-rendered HTML, so waiting for the
            // script element is both faster and more reliable than a fixed sleep.
            await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 15000 });

            const nextData = await page.evaluate(() => {
                const script = document.getElementById('__NEXT_DATA__');
                return script ? JSON.parse(script.innerText) : null;
            });

            if (!nextData) throw new Error(`Could not find __NEXT_DATA__ for lesson at ${url}`);

            const pageProps = nextData.props?.pageProps || {};
            const urlObj = new URL(url);
            const md = urlObj.searchParams.get('md') || urlObj.searchParams.get('lesson');

            let foundLesson: any = null;

            const findInTree = (node: any) => {
                if (node.course?.id === md) {
                    foundLesson = node.course;
                    return;
                }
                if (node.children) {
                    for (const child of node.children) {
                        findInTree(child);
                        if (foundLesson) return;
                    }
                }
            };

            if (pageProps.course) {
                findInTree(pageProps.course);
            }

            if (!foundLesson) {
                foundLesson = pageProps.lesson || pageProps.course?.course;
            }

            const metadata = foundLesson?.metadata || {};

            // Handle native videoId vs videoLink
            let vLink = metadata.videoLink || foundLesson?.video?.url || '';

            // Native Skool Player Handling (Mux)
            if (!vLink && metadata.videoId) {
                logger.info(`    ℹ️ Native videoId found: ${metadata.videoId}.`);

                try {
                    vLink = await muxInteractionLimit(async () => {
                        // Try to find and click the play button/thumbnail to trigger stream signed URL generation
                        const playButtonSelector = 'div[class*="MuxThumbnailWrapper"]';
                        const hasPlayButton = await page.evaluate((sel) => !!document.querySelector(sel), playButtonSelector);
                        if (!hasPlayButton) return '';

                        logger.info('    🖱️ Clicking play button to initialize stream...');
                        await page.click(playButtonSelector);

                        let streamUrl = '';

                        // Poll for the stream manifest to appear in network entries or player src
                        let attempts = 0;
                        while (attempts < 10) {
                            streamUrl = await page.evaluate(() => {
                                // 1. Check performance entries for m3u8
                                const entries = performance.getEntriesByType('resource')
                                    .filter(e => e.name.includes('m3u8') && e.name.includes('token='));
                                if (entries.length > 0) return (entries[entries.length - 1] as PerformanceResourceTiming).name;

                                // 2. Search all shadow roots for a video element (BFS)
                                const stack: any[] = [document];
                                while (stack.length > 0) {
                                    const root = stack.pop();
                                    const video = root.querySelector('video');
                                    if (video && video.src && video.src.includes('m3u8')) return video.src;

                                    const elements = root.querySelectorAll('*');
                                    for (let i = 0; i < elements.length; i++) {
                                        if (elements[i].shadowRoot) {
                                            stack.push(elements[i].shadowRoot);
                                        }
                                    }
                                }
                                return null;
                            });

                            if (streamUrl) break;
                            await page.waitForTimeout(1000);
                            attempts++;
                        }

                        // Stop playback — the signed URL is captured, and a
                        // video left playing keeps decoding (and downloading)
                        // until the page closes, starving the other lessons.
                        await page.evaluate(() => {
                            const stack: any[] = [document];
                            while (stack.length > 0) {
                                const root = stack.pop();
                                root.querySelectorAll('video').forEach((v: HTMLVideoElement) => v.pause());
                                const elements = root.querySelectorAll('*');
                                for (let i = 0; i < elements.length; i++) {
                                    if (elements[i].shadowRoot) {
                                        stack.push(elements[i].shadowRoot);
                                    }
                                }
                            }
                        }).catch(() => undefined);

                        return streamUrl;
                    });

                    // Fallback: Reconstruct from pageProps if interaction failed but we have IDs
                    if (!vLink) {
                        const videoData = pageProps.video || pageProps.course?.video;
                        if (videoData && videoData.id === metadata.videoId && videoData.playbackId && videoData.playbackToken) {
                            logger.info('    ℹ️ Using reconstructed HLS URL from page props fallback.');
                            vLink = `https://stream.video.skool.com/${videoData.playbackId}.m3u8?token=${videoData.playbackToken}`;
                        }
                    }

                    if (!vLink) {
                        logger.warn(`    ⚠️ Lesson has a native video (${metadata.videoId}) but no stream URL could be extracted — video will be missing from the backup.`);
                    }
                } catch (err) {
                    logger.warn(`    ⚠️ Interaction-based extraction failed: ${String(err)}`);
                }
            }

            // Resource extraction
            let resources: Resource[] = [];
            try {
                // 1. Try to extract from metadata (standard native files)
                const rawResources = metadata.resources || foundLesson?.resources || '[]';
                if (typeof rawResources === 'string') {
                    resources = JSON.parse(rawResources);
                } else if (Array.isArray(rawResources)) {
                    resources = rawResources;
                }

                // Normalize metadata resources (some have .link instead of .downloadUrl)
                resources = resources.map((r: any) => {
                    if (r.link && !r.downloadUrl) {
                        return {
                            ...r,
                            downloadUrl: r.link,
                            isExternal: true
                        };
                    }
                    return r;
                });

            } catch (e) {
                logger.warn(`    ⚠️ Failed to parse metadata resources: ${String(e)}`);
            }

            // 2. Scrape from DOM to catch external links and any native missing from metadata
            try {
                // The resource wrappers only exist after client-side hydration, which
                // the __NEXT_DATA__ wait above does not cover. Lessons without
                // resources are normal, so only a timeout is swallowed here.
                await page
                    .waitForSelector('div[class*="ResourceWrapper"]', { timeout: 3000 })
                    .catch((err) => {
                        if (err instanceof playwrightErrors.TimeoutError) return null;
                        throw err;
                    });
                const domResources = await page.evaluate(() => {
                    const wrappers = Array.from(document.querySelectorAll('div[class*="ResourceWrapper"]'));
                    return wrappers.map(w => {
                        const anchor = w.querySelector('a');
                        const labelSpan = w.querySelector('span[class*="ResourceLabel"]');
                        const title = labelSpan ? labelSpan.textContent?.trim() : 'Untitled Resource';
                        
                        const url = anchor ? anchor.href : null;
                        // If it has an anchor and it's not a skool download link, it's external
                        const isExternal = !!(url && !url.includes('api2.skool.com') && !url.includes('/files/'));

                        return { title, url, isExternal };
                    });
                });

                // Merge DOM resources into the metadata resources
                for (const domRes of domResources) {
                    const exists = resources.some(r => r.title === domRes.title);
                    if (!exists && domRes.title) {
                        if (domRes.isExternal && domRes.url) {
                            resources.push({
                                title: domRes.title,
                                downloadUrl: domRes.url,
                                isExternal: true,
                                file_name: domRes.title
                            });
                        } else {
                            // If it's native but wasn't in metadata, it might be a link-style resource 
                            // that still points to a skool file.
                            if (domRes.url) {
                                resources.push({
                                    title: domRes.title,
                                    downloadUrl: domRes.url,
                                    file_name: domRes.title
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                logger.warn(`    ⚠️ DOM-based resource scraping failed: ${String(err)}`);
            }

            // Fetch download URLs for each native resource using direct API calls
            if (resources.length > 0) {
                logger.info(`    📥 Found ${resources.length} resources. Fetching download URLs...`);

                // Same assignment the downloader uses for local filenames, so
                // the on-disk check below matches what was actually written.
                const localNames = assignResourceFileNames(resources);

                for (const res of resources) {
                    // Skip if it's already an external link or already has a download URL
                    if (res.isExternal || (res.downloadUrl && res.downloadUrl.startsWith('http')) || !res.file_id) {
                        continue;
                    }

                    // Skip the API round-trip when the file is already on disk —
                    // the downloader skips the download anyway.
                    const localName = localNames.get(res);
                    if (localName && options.existingResourceFiles?.has(localName)) {
                        logger.info(`      ⏭️  "${res.title}" already on disk, skipping download URL fetch`);
                        continue;
                    }

                    try {
                        logger.info(`      🔗 Requesting download URL for "${res.title}"...`);
                        const response = await page.evaluate(async (fileId: string) => {
                            const apiUrl = `https://api2.skool.com/files/${fileId}/download-url?expire=28800`;
                            try {
                                const resp = await fetch(apiUrl, {
                                    method: 'POST',
                                    credentials: 'include'
                                });
                                if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
                                const text = await resp.text();
                                return { success: true, url: text.trim() };
                            } catch (e) {
                                return { success: false, error: String(e) };
                            }
                        }, res.file_id);

                        if (response.success && response.url) {
                            res.downloadUrl = response.url;
                            logger.info(`      ✅ Got download URL for "${res.title}"`);
                        } else {
                            logger.warn(`      ⚠️ Failed to get download URL for "${res.title}": ${response.error}`);
                        }
                    } catch (err) {
                        logger.warn(`      ⚠️ Error fetching download URL for "${res.title}": ${String(err)}`);
                    }
                }
            }

            // Skool stores rich text as a stringified JSON array or primitive HTML
            let body = metadata.desc || foundLesson?.body || '';

            // If it looks like [v2][{"type"...}], it's TipTap/JSON format
            if (typeof body === 'string' && body.startsWith('[v2]')) {
                try {
                    const jsonPart = body.substring(4);
                    const nodes = JSON.parse(jsonPart);
                    body = parseTipTap(nodes);
                } catch (e) {
                    logger.error(`Failed to parse TipTap content: ${String(e)}`);
                }
            }

            return {
                id: md || foundLesson?.id || '',
                title: metadata.title || foundLesson?.name || '',
                url: url,
                contentHtml: body,
                videoLink: vLink,
                videoExtractionFailed: Boolean(metadata.videoId && !vLink),
                resources: resources
            };
        } finally {
            await page.close();
        }
    }

    // Helper removed as logic is now in extractLessonData for shared state
}

/**
 * Renders Skool TipTap block nodes as HTML.
 *
 * Scraped text, hrefs, image src/alt values are passed through `escapeHtml`;
 * the surrounding tags are generated here and are the only intentional HTML.
 */
export function parseTipTap(nodes: any[]): string {
    return nodes.map(node => {
        if (node.type === 'paragraph') {
            return `<p>${parseTipTapContent(node.content)}</p>`;
        }
        if (node.type === 'hardBreak') {
            return '<br/>';
        }
        if (node.type === 'bulletList') {
            return `<ul>${parseTipTap(node.content)}</ul>`;
        }
        if (node.type === 'orderedList') {
            return `<ol>${parseTipTap(node.content)}</ol>`;
        }
        if (node.type === 'listItem') {
            return `<li>${parseTipTap(node.content)}</li>`;
        }
        if (node.type === 'heading') {
            const level = node.attrs?.level || 2;
            return `<h${level}>${parseTipTapContent(node.content)}</h${level}>`;
        }
        if (node.type === 'image' || node.type === 'image-block' || (node.attrs && node.attrs.src)) {
             const src = node.attrs.src || node.attrs.url || node.attrs.originalSrc;
             const alt = node.attrs.alt || '';
             if (src) {
                return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
             }
        }
        if (node.type === 'blockquote') {
             return `<blockquote>${parseTipTap(node.content)}</blockquote>`;
        }

        // Fallback for nested content in unknown blocks
        if (node.content) {
            return `<div>${parseTipTap(node.content)}</div>`;
        }

        return '';
    }).join('');
}

/**
 * Renders TipTap inline content (text nodes with bold/link marks) as HTML.
 *
 * Text is escaped BEFORE mark tags are wrapped around it so the scraped text
 * can never break out of the generated `<b>`/`<a>` markup.
 */
export function parseTipTapContent(content: any[]): string {
    if (!content) return '';
    return content.map(item => {
        if (item.type === 'text') {
            let text = escapeHtml(item.text);
            if (item.marks) {
                item.marks.forEach((mark: any) => {
                    if (mark.type === 'bold') text = `<b>${text}</b>`;
                    if (mark.type === 'link') text = `<a href="${escapeHtml(mark.attrs.href)}">${text}</a>`;
                });
            }
            return text;
        }
        if (item.type === 'hardBreak') return '<br/>';
        return '';
    }).join('');
}
