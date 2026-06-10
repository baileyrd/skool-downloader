import { describe, expect, it } from 'vitest';

import { getUrlExtension, resolveTargetLessonId } from '../src/index.js';

describe('resolveTargetLessonId', () => {
    it('reads the lesson id from the md query parameter', () => {
        const id = resolveTargetLessonId(
            'https://www.skool.com/g/classroom/course?md=lesson123',
            'auto'
        );
        expect(id).toBe('lesson123');
    });

    it('reads the lesson id from the lesson query parameter', () => {
        const id = resolveTargetLessonId(
            'https://www.skool.com/g/classroom/course?lesson=abc456',
            'auto'
        );
        expect(id).toBe('abc456');
    });

    it('prefers an explicit lesson id over the URL', () => {
        const id = resolveTargetLessonId(
            'https://www.skool.com/g/classroom/course?md=fromUrl',
            'auto',
            'explicit789'
        );
        expect(id).toBe('explicit789');
    });

    it('returns null in course mode even when the URL has a lesson id', () => {
        const id = resolveTargetLessonId(
            'https://www.skool.com/g/classroom/course?md=lesson123',
            'course'
        );
        expect(id).toBeNull();
    });

    it('returns null in auto mode with no lesson id anywhere', () => {
        const id = resolveTargetLessonId(
            'https://www.skool.com/g/classroom/course',
            'auto'
        );
        expect(id).toBeNull();
    });

    it('throws in lesson mode when no lesson id can be resolved', () => {
        expect(() =>
            resolveTargetLessonId('https://www.skool.com/g/classroom/course', 'lesson')
        ).toThrow(/lesson id/i);
    });
});

describe('getUrlExtension', () => {
    it('returns the extension of a normal URL', () => {
        expect(getUrlExtension('https://cdn.skool.com/images/cover.png')).toBe('.png');
        expect(getUrlExtension('https://cdn.skool.com/images/cover.webp?w=300')).toBe('.webp');
    });

    it('falls back to .jpg for implausibly long extensions', () => {
        expect(getUrlExtension('https://cdn.skool.com/file.verylongext')).toBe('.jpg');
    });

    it('falls back to .jpg when there is no extension', () => {
        expect(getUrlExtension('https://cdn.skool.com/images/cover')).toBe('.jpg');
    });

    it('falls back to .jpg for invalid URLs', () => {
        expect(getUrlExtension('not a url at all')).toBe('.jpg');
    });
});
