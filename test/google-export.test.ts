import { describe, expect, it } from 'vitest';

import { buildGoogleExportInfo } from '../src/google-export.js';

describe('buildGoogleExportInfo', () => {
    it('rewrites a Google Doc edit link to the PDF export endpoint', () => {
        const info = buildGoogleExportInfo(
            'https://docs.google.com/document/d/1AbC_dEf-123/edit?usp=sharing'
        );
        expect(info).toEqual({
            exportUrl: 'https://docs.google.com/document/d/1AbC_dEf-123/export?format=pdf',
            extension: 'pdf'
        });
    });

    it('rewrites a Google Sheet link to the XLSX export endpoint', () => {
        const info = buildGoogleExportInfo(
            'https://docs.google.com/spreadsheets/d/sheetID42/edit#gid=0'
        );
        expect(info).toEqual({
            exportUrl: 'https://docs.google.com/spreadsheets/d/sheetID42/export?format=xlsx',
            extension: 'xlsx'
        });
    });

    it('rewrites a Google Slides link to the PPTX export endpoint (path form, not query param)', () => {
        const info = buildGoogleExportInfo(
            'https://docs.google.com/presentation/d/deck-99/edit?slide=id.p1'
        );
        expect(info).toEqual({
            exportUrl: 'https://docs.google.com/presentation/d/deck-99/export/pptx',
            extension: 'pptx'
        });
    });

    it('handles a bare link without a trailing path segment', () => {
        const info = buildGoogleExportInfo('https://docs.google.com/document/d/onlyID');
        expect(info?.exportUrl).toBe('https://docs.google.com/document/d/onlyID/export?format=pdf');
    });

    it('returns null for published-to-web URLs (/d/e/ tokens are not document IDs)', () => {
        expect(buildGoogleExportInfo(
            'https://docs.google.com/document/d/e/2PACX-token/pub'
        )).toBeNull();
    });

    it('returns null for Google Drive file links', () => {
        expect(buildGoogleExportInfo(
            'https://drive.google.com/file/d/1AbC/view?usp=sharing'
        )).toBeNull();
    });

    it('returns null for Google Forms (no export endpoint)', () => {
        expect(buildGoogleExportInfo(
            'https://docs.google.com/forms/d/1AbC/viewform'
        )).toBeNull();
    });

    it('returns null for non-Google external links', () => {
        expect(buildGoogleExportInfo('https://www.dropbox.com/s/abc/file.pdf')).toBeNull();
        expect(buildGoogleExportInfo('https://notion.so/page-123')).toBeNull();
    });

    it('returns null for unparseable URLs', () => {
        expect(buildGoogleExportInfo('not a url')).toBeNull();
    });

    it('returns null for a docs.google.com URL with no /d/ ID', () => {
        expect(buildGoogleExportInfo('https://docs.google.com/document/u/0/')).toBeNull();
    });
});
