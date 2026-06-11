# Skool Downloader — Backlog

Derived from `docs/ASSESSMENT.md` (2026-06-10). Items are ordered for sequential
execution; each item includes design, implementation, and testing. Update status as
work proceeds.

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| B1 | Tooling foundation: fix tsc errors, add typecheck/test scripts, vitest setup, dep cleanup | P0 | done |
| B2 | Fix image filename collision + harden `localizeImages` rewriting | P0 | done |
| B3 | Harden `downloadAsset`: stream error handling + atomic temp-file writes | P0 | done |
| B4 | Fix packaging/publish: tsx runtime dep or dist build, `main`, ffmpeg story, browser install | P1 | done |
| B5 | HTML escaping at all template interpolation points | P1 | done |
| B6 | Scraper robustness: page try/finally, replace fixed sleeps, drop `--no-check-certificates` | P1 | done |
| B7 | DRY cleanup: shared helpers/types/templates, arg parser fixes, pure-function tests | P2 | done |
| B8 | Download Google Docs/Sheets/Slides resources via export URLs instead of leaving external links | P2 | todo |

---

## B1 — Tooling foundation (P0)

**Why first:** every later item needs a green type check and a test runner to verify
against.

- Fix `src/auth.ts:34` implicit-any (TS7006).
- Fix `src/cli.ts:178-179` access to private `Listr.renderer` (TS2341) — find a public
  API or drop the workaround.
- Add `"typecheck": "tsc --noEmit"` script.
- Add vitest: devDependency, `"test": "vitest run"` script, a first smoke test.
- Remove `@types/axios` (axios ships its own types) and unused `ts-node`.

**Done when:** `npm run typecheck` and `npm test` both pass.

## B2 — Image filename collision (P0)

`src/downloader.ts:118-147` (`localizeImages`).

- Replace `Buffer.from(url).toString('base64').substring(0, 10)` with a real hash of
  the full URL (e.g. sha1 hex, first 10 chars).
- Dedupe image URLs into a Map before scheduling downloads (prevents two concurrent
  writes to the same path).
- Replace `String.replace(url, ...)` with a global, prefix-safe rewrite (e.g. replace
  within the matched `src="..."` attributes only).
- Backward compatibility note: previously downloaded assets keep old names; new runs
  re-download under new names — acceptable.

**Done when:** unit tests cover collision (two URLs, same basename), duplicate URLs,
URL-is-prefix-of-another, multiple occurrences of same URL; typecheck + tests green.

## B3 — `downloadAsset` hardening (P0)

`src/downloader.ts:86-116`.

- Use `stream.pipeline` (or equivalent) so response-stream errors reject the promise
  instead of hanging.
- Write to `<path>.tmp` and rename on success, so interrupted downloads never leave a
  partial file that passes the size>0 "already exists" skip check.
- Clean up stray `.tmp` on failure.

**Done when:** unit tests (mock/local HTTP) cover success, response-stream error,
and interrupted-write leaves no poisoned file; typecheck + tests green.

## B4 — Packaging & publish path (P1)

`package.json`, `bin/skool.js`, README.

- Make `npx skool-downloader` actually work: move `tsx` to `dependencies` (simplest)
  OR add a `build` script emitting `dist/` and point `bin` at compiled JS. Pick one,
  document the choice.
- Fix `main` (point at a real file or remove).
- Resolve the ffmpeg claim: either add a managed ffmpeg binary (e.g.
  `@ffmpeg-installer/ffmpeg` wired into yt-dlp args) or correct README and add a
  startup detection/warning when ffmpeg is missing.
- Document/handle Playwright browser install (postinstall note or runtime check with
  a helpful message).
- Fix README duplicated paragraph and duplicate "### 3." section numbering.

**Done when:** a clean `npm pack` + install of the tarball in a temp dir runs
`skool --help` successfully; README accurate.

## B5 — HTML escaping (P1)

`src/index.ts` lesson template, `src/regenerate-index.ts`,
`src/regenerate-group-index.ts`, `src/scraper.ts` (`parseTipTap` text/href/alt).

- Add a single `escapeHtml()` (and `escapeAttr()` if needed) in a shared module.
- Apply at every interpolation of scraped data (titles, names, resource titles,
  hrefs, alt text). Do NOT escape `contentHtml`/`localizedHtml` (it is intentional
  HTML) — document that boundary.

**Done when:** unit tests cover `<`, `&`, quotes in titles/resource names rendering
escaped; generated pages remain valid; typecheck + tests green.

## B6 — Scraper robustness & politeness (P1)

`src/scraper.ts`, `src/downloader.ts:64`.

- Wrap `extractLessonData` page usage in `try/finally` so pages always close.
- Replace `waitForTimeout(5000)`/`waitForTimeout(2000)` with
  `page.waitForSelector('#__NEXT_DATA__', ...)` (keep a small bounded fallback wait
  only where genuinely needed, e.g. Mux play-button polling).
- Remove `--no-check-certificates` from yt-dlp args.

**Done when:** typecheck + tests green; lesson extraction logic unchanged otherwise
(no behavioral regression in parsing).

## B7 — DRY cleanup & test seed (P2)

- New `src/shared.ts` (or similar): `sanitizeName` (single copy; also strip Windows
  trailing dots/spaces and reserved device names), `escapeHtml` (from B5),
  `writeAtomicJson`/`writeAtomicHtml`, `CourseManifest`/`LessonManifest` types.
- Update `cli.ts`, `index.ts`, `regenerate-index.ts`, `regenerate-group-index.ts` to
  import from it.
- Fix arg parser: advance `i` after `regenerate-index <dir>`; warn on unknown flags.
- Remove `runConcurrent` in favor of the existing `p-limit` dependency (or vice
  versa — one mechanism).
- Add unit tests for `sanitizeName`, `parseArgs`, `resolveTargetLessonId`,
  `parseTipTap`, `resolveClassroomRootUrl`, `getUrlExtension`.

**Done when:** no duplicated helper/type definitions remain; typecheck + tests green.

## B8 — Localize Google Docs/Sheets/Slides resources (P2)

`src/index.ts` (external-resource branch, ~line 405), `src/downloader.ts`
(`downloadAsset`), `src/scraper.ts` (resource extraction).

**Gap:** resources are classified by host, not file type (`src/scraper.ts`
`isExternal` check). Native Skool attachments of any type (PPTX, XLSX, …) are
downloaded, but Google Docs/Sheets/Slides are inherently links to
`docs.google.com`, so they stay external-link-only. The README's offline-backup
promise silently excludes them, and the links are fragile (sharing revoked, doc
deleted, community shut down).

- Detect Google Docs/Sheets/Slides URLs among `isExternal` resources and rewrite
  to the unauthenticated export endpoints (work for "anyone with the link"
  sharing, no API key/OAuth):
  - `docs.google.com/document/d/<ID>/export?format=pdf` (or `docx`)
  - `docs.google.com/spreadsheets/d/<ID>/export?format=xlsx`
  - `docs.google.com/presentation/d/<ID>/export/pptx`
- Download the export into the lesson's `resources/` folder via the existing
  `downloadAsset` plumbing; link the local copy from the lesson page.
- On export failure (sign-in required, download disabled), fall back to the
  current external-link behavior and log a visible warning that the backup is
  incomplete.
- Out of scope (note for later): other external hosts (Dropbox, Notion, Loom)
  remain link-only.

**Done when:** unit tests cover URL detection/rewriting for all three Google
types and the fallback path; a lesson with a link-shared Google Doc resource
ends up with a local file in `resources/`; typecheck + tests green.
