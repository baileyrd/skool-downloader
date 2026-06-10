import os from 'os';
import path from 'path';

import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { escapeHtml } from '../src/html-escape.js';
import { parseTipTap, parseTipTapContent } from '../src/scraper.js';
import { regenerateIndex } from '../src/regenerate-index.js';

describe('escapeHtml', () => {
    it('escapes each special character', () => {
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('<')).toBe('&lt;');
        expect(escapeHtml('>')).toBe('&gt;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#39;');
    });

    it('escapes combined strings', () => {
        expect(escapeHtml('<script>alert("xss") && \'pwn\'</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;) &amp;&amp; &#39;pwn&#39;&lt;/script&gt;'
        );
    });

    it('leaves safe strings untouched', () => {
        expect(escapeHtml('Plain Lesson Title 42')).toBe('Plain Lesson Title 42');
        expect(escapeHtml('')).toBe('');
    });

    it('double-escapes already-escaped input (escaping is not idempotent by design)', () => {
        expect(escapeHtml('&amp;')).toBe('&amp;amp;');
        expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
    });
});

describe('parseTipTap / parseTipTapContent', () => {
    it('escapes script tags in text nodes', () => {
        const html = parseTipTap([
            {
                type: 'paragraph',
                content: [{ type: 'text', text: '<script>alert(1)</script>' }]
            }
        ]);
        expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
        expect(html).not.toContain('<script>');
    });

    it('escapes text before wrapping with bold marks', () => {
        const html = parseTipTapContent([
            {
                type: 'text',
                text: '<i>hi</i>',
                marks: [{ type: 'bold' }]
            }
        ]);
        expect(html).toBe('<b>&lt;i&gt;hi&lt;/i&gt;</b>');
    });

    it('prevents attribute breakout via double quotes in link hrefs', () => {
        const html = parseTipTapContent([
            {
                type: 'text',
                text: 'click',
                marks: [
                    {
                        type: 'link',
                        attrs: { href: 'https://x.test/" onmouseover="alert(1)' }
                    }
                ]
            }
        ]);
        expect(html).toBe(
            '<a href="https://x.test/&quot; onmouseover=&quot;alert(1)">click</a>'
        );
        expect(html).not.toContain('" onmouseover="');
    });

    it('escapes image src and alt attributes', () => {
        const html = parseTipTap([
            {
                type: 'image',
                attrs: {
                    src: 'https://x.test/a.png?w=1&h=2',
                    alt: '"><script>alert(1)</script>'
                }
            }
        ]);
        expect(html).toBe(
            '<img src="https://x.test/a.png?w=1&amp;h=2" alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" />'
        );
        expect(html).not.toContain('<script>');
    });
});

describe('regenerateIndex escaping integration', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skool-escape-test-'));
    });

    afterEach(async () => {
        await fs.remove(tempDir);
    });

    it('escapes lesson titles from manifests in the generated index', async () => {
        const injectedTitle = `Evil <b>&"' lesson`;
        const lessonDir = path.join(tempDir, '1-Evil lesson');
        await fs.ensureDir(lessonDir);
        await fs.writeFile(path.join(lessonDir, 'index.html'), '<html></html>');
        await fs.writeJson(path.join(lessonDir, 'lesson.json'), {
            lessonId: 'abc123',
            title: injectedTitle,
            moduleIndex: 0,
            moduleTitle: 'Module <script>alert(1)</script>',
            lessonIndex: 1,
            moduleDirName: '',
            lessonDirName: '1-Evil lesson',
            relativePath: '1-Evil lesson/index.html',
            hasVideo: false,
            resourcesCount: 0,
            updatedAt: new Date().toISOString()
        });
        await fs.writeJson(path.join(tempDir, '.course.json'), {
            courseName: 'Course & "Co" <Inc>',
            groupName: `Group <img src=x onerror=alert(1)>`,
            modules: [],
            updatedAt: new Date().toISOString()
        });

        await regenerateIndex(tempDir, { silent: true });

        const output = await fs.readFile(path.join(tempDir, 'index.html'), 'utf-8');

        expect(output).toContain('Evil &lt;b&gt;&amp;&quot;&#39; lesson');
        expect(output).not.toContain(injectedTitle);

        expect(output).toContain('Course &amp; &quot;Co&quot; &lt;Inc&gt;');
        expect(output).not.toContain('Course & "Co" <Inc>');

        expect(output).toContain('Group &lt;img src=x onerror=alert(1)&gt;');
        expect(output).not.toContain('<img src=x onerror=alert(1)>');

        expect(output).not.toContain('<script>alert(1)</script>');
    });
});
