/**
 * HTML escaping for scraped Skool data interpolated into generated pages.
 *
 * Escaping boundary:
 * - Lesson `contentHtml` / `localizedHtml` is intentional, already-rendered
 *   HTML (produced by parseTipTap or returned by Skool) and must NOT be
 *   passed through `escapeHtml`.
 * - Everything else scraped from Skool — lesson/module/course/group titles
 *   and names, resource titles, link hrefs, image src/alt values — must pass
 *   through `escapeHtml` before being interpolated into a template.
 *
 * `escapeHtml` is safe for both element text content and attribute values,
 * because every attribute in these templates is double-quoted and `"` is
 * escaped. `'` is escaped as well for defence in depth.
 */

/**
 * Escapes the five HTML-significant characters (& < > " ') in `value` so it
 * can be safely interpolated into element text content or a double-quoted
 * attribute value.
 *
 * Not idempotent by design: already-escaped input is escaped again
 * (e.g. `&amp;` becomes `&amp;amp;`), which is correct when the input is
 * raw scraped text.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
