import { describe, expect, it } from 'vitest';

import { parseTipTap, resolveClassroomRootUrl } from '../src/scraper.js';

describe('resolveClassroomRootUrl', () => {
    it('strips a course slug after /classroom', () => {
        expect(
            resolveClassroomRootUrl('https://www.skool.com/my-group/classroom/abc123')
        ).toBe('https://www.skool.com/my-group/classroom');
    });

    it('returns an already-root classroom URL unchanged', () => {
        expect(
            resolveClassroomRootUrl('https://www.skool.com/my-group/classroom')
        ).toBe('https://www.skool.com/my-group/classroom');
    });

    it('strips query and hash from classroom URLs', () => {
        expect(
            resolveClassroomRootUrl('https://www.skool.com/g/classroom/abc?md=lesson1#top')
        ).toBe('https://www.skool.com/g/classroom');
    });

    it('only strips query and hash from non-classroom URLs', () => {
        expect(
            resolveClassroomRootUrl('https://www.skool.com/my-group/about?ref=x#section')
        ).toBe('https://www.skool.com/my-group/about');
    });
});

describe('parseTipTap structure', () => {
    it('renders paragraphs', () => {
        const html = parseTipTap([
            { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
        ]);
        expect(html).toBe('<p>hello</p>');
    });

    it('renders bullet lists with list items', () => {
        const html = parseTipTap([
            {
                type: 'bulletList',
                content: [
                    {
                        type: 'listItem',
                        content: [
                            { type: 'paragraph', content: [{ type: 'text', text: 'one' }] }
                        ]
                    },
                    {
                        type: 'listItem',
                        content: [
                            { type: 'paragraph', content: [{ type: 'text', text: 'two' }] }
                        ]
                    }
                ]
            }
        ]);
        expect(html).toBe('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    });

    it('renders ordered lists', () => {
        const html = parseTipTap([
            {
                type: 'orderedList',
                content: [
                    {
                        type: 'listItem',
                        content: [
                            { type: 'paragraph', content: [{ type: 'text', text: 'first' }] }
                        ]
                    }
                ]
            }
        ]);
        expect(html).toBe('<ol><li><p>first</p></li></ol>');
    });

    it('renders headings with their level, defaulting to h2', () => {
        const withLevel = parseTipTap([
            { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Title' }] }
        ]);
        expect(withLevel).toBe('<h3>Title</h3>');

        const withoutLevel = parseTipTap([
            { type: 'heading', content: [{ type: 'text', text: 'Title' }] }
        ]);
        expect(withoutLevel).toBe('<h2>Title</h2>');
    });

    it('wraps unknown nodes with nested content in a div', () => {
        const html = parseTipTap([
            {
                type: 'mysteryBlock',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'inside' }] }
                ]
            }
        ]);
        expect(html).toBe('<div><p>inside</p></div>');
    });

    it('renders unknown leaf nodes as an empty string', () => {
        expect(parseTipTap([{ type: 'mysteryLeaf' }])).toBe('');
    });
});
