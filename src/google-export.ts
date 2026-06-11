/**
 * Detection and rewriting of Google Docs/Sheets/Slides URLs to their
 * unauthenticated export endpoints, so link-shared Google files can be
 * downloaded into the offline backup instead of staying external links.
 *
 * Only the three editor types are handled. Published-to-web URLs
 * (`/d/e/<token>/pub`) and Drive file links use different endpoints and are
 * intentionally left external.
 */

export interface GoogleExportInfo {
    /** Unauthenticated export URL (works for "anyone with the link" sharing). */
    exportUrl: string;
    /** File extension of the exported format, without the leading dot. */
    extension: 'pdf' | 'xlsx' | 'pptx';
}

const GOOGLE_DOC_TYPES: Record<string, GoogleExportInfo['extension']> = {
    document: 'pdf',
    spreadsheets: 'xlsx',
    presentation: 'pptx',
};

/**
 * If `url` is a Google Docs/Sheets/Slides link, return its export endpoint
 * and target extension; otherwise return `null`.
 *
 * - Docs → `/export?format=pdf` (PDF preserves layout regardless of fonts).
 * - Sheets → `/export?format=xlsx`.
 * - Slides → `/export/pptx` (Slides uses a path segment, not a query param).
 */
export function buildGoogleExportInfo(url: string): GoogleExportInfo | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    if (parsed.hostname !== 'docs.google.com') {
        return null;
    }

    const match = parsed.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) {
        return null;
    }

    const [, docType, id] = match;
    // `/d/e/<token>` is a published-to-web URL; its token is not a document ID
    // and the /export endpoints do not accept it.
    if (id === 'e') {
        return null;
    }

    const extension = GOOGLE_DOC_TYPES[docType];
    const base = `https://docs.google.com/${docType}/d/${id}`;
    const exportUrl = docType === 'presentation'
        ? `${base}/export/pptx`
        : `${base}/export?format=${extension}`;

    return { exportUrl, extension };
}
