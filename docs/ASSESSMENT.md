# Skool Downloader — Code Assessment

**Date:** 2026-06-10
**Scope:** Full review of all source files (`src/`), packaging (`package.json`, `bin/skool.js`, `tsconfig.json`), and docs (`README.md`, `AGENTS.md`, `TODO.md`), plus a `tsc --noEmit` type check.

---

## 1. Overview

A TypeScript/Node ESM CLI that archives Skool.com courses for offline viewing. The
architecture is sensible: instead of fragile DOM scraping, it pulls the `__NEXT_DATA__`
JSON blob from Skool's Next.js pages for course structure, uses Playwright only where
interaction is unavoidable (login, Mux play-button click to mint signed HLS URLs),
delegates video downloads to a locally-managed `yt-dlp`, and generates a self-contained
styled HTML tree with manifests (`.course.json`, `lesson.json`) that make index
regeneration and resume possible.

**Layering** is clean:

```
cli.ts (UX / prompts / Listr2)
  └─ index.ts (orchestration: downloadCourse)
       ├─ scraper.ts  (Playwright: structure + lesson extraction)
       ├─ downloader.ts (yt-dlp wrapper, axios asset downloads, image localization)
       ├─ regenerate-index.ts / regenerate-group-index.ts (HTML index generation)
       └─ logger.ts (Logger interface)
```

The `Logger` interface and callback/task-runner hooks keep the core decoupled from the
Listr2 UI — genuinely good design for a project this size.

**However:** there are several real bugs, a broken npm-publish story, no tests, no CI,
and the type check currently fails.

---

## 2. High-impact bugs

### 2.1 Image filename "hash" is useless — colliding assets silently swapped
`src/downloader.ts:130`

```ts
const filename = `img_${Buffer.from(url).toString('base64').substring(0, 10)}_${path.basename(...)}`;
```

The first 10 base64 characters encode only the first ~7.5 bytes of the URL — which is
`https://` for every image. The "unique" prefix is the constant `aHR0cHM6Ly`, so the
effective filename is just the URL's basename. Two different images named `image.png`
from different paths collide: the second is skipped by the size>0 "already exists"
check and the lesson displays the wrong image. Fix: real hash of the full URL.

### 2.2 `npx skool-downloader` (the documented install path) is broken
`bin/skool.js:10`, `package.json`

The bin script spawns `node_modules/.bin/tsx` to run `src/cli.ts`, but `tsx` is in
`devDependencies`. An `npx` install only gets production deps, so the binary fails
immediately. Also: `main` points to a nonexistent `index.js`, there is no `build`
script despite `tsconfig.json` declaring `outDir: ./dist`, and Playwright's Chromium
is not installed on `npm install` (no postinstall), so a first run fails for fresh
users either way.

### 2.3 Type check fails — 3 errors
- `src/cli.ts:178-179` — accesses Listr's private `renderer` property (TS2341)
- `src/auth.ts:34` — implicit `any` parameter (TS7006)

Runtime works because `tsx`/esbuild strips types without checking, but the project's
only type-safety net is red.

### 2.4 `downloadAsset` can hang forever or persist corrupt files
`src/downloader.ts:86-116`

1. The returned promise listens only to the *writer's* `finish`/`error`. If the axios
   response stream errors mid-download, nothing rejects — the lesson task hangs
   indefinitely. Needs `stream.pipeline` or a response-stream error handler.
2. The skip logic treats any file with size > 0 as complete. An interrupted download
   leaves a partial file that is permanently skipped on every rerun — the opposite of
   the "rerun to fill gaps" promise. Fix: write to `.tmp`, rename on success (the
   atomic pattern already used for JSON/HTML). The video path is mostly safe because
   yt-dlp uses `.part` files; the axios path is not.

### 2.5 README promises ffmpeg management that doesn't exist

README's first feature bullet says the tool "automatically downloads the correct
yt-dlp **and ffmpeg** binaries," and `.gitignore` anticipates `bin/ffmpeg*` — but
`Downloader.init()` only downloads yt-dlp. The `--merge-output-format mp4` and
`+faststart` postprocessor args silently require a system ffmpeg. Either add a managed
ffmpeg (e.g. `@ffmpeg-installer/ffmpeg`) or correct the README and detect/warn.

---

## 3. Medium issues

### 3.1 No HTML escaping anywhere
Lesson titles, course/group names, resource titles, and TipTap link `href`s are
interpolated raw into generated HTML (`src/index.ts:477-590`, `src/scraper.ts:560,584`,
both regenerators). A title containing `<`, `&`, or quotes breaks the page; a malicious
community admin could inject script into the local archive. One `escapeHtml()` helper
used at every interpolation point closes this.

### 3.2 Page leak on lesson failure
`src/scraper.ts:291-506` — `extractLessonData` closes its page only on the success
path. Any throw between navigation and the end leaks the page; with concurrency 8 and
a flaky course, pages accumulate in one browser. Needs `try/finally`.

### 3.3 Module-level mutable state makes the library API non-reentrant
`src/index.ts:13-17` — `activeOutputDir`, `activeGroupDir`, and the pLimit instances
live at module scope. Two concurrent `downloadCourse()` calls would stomp each other's
shutdown state, and the Ctrl+C handler only regenerates the *last* course started.
Also `src/index.ts:623` fires `indexLimit(() => regenerateIndex(...))` without awaiting
or catching — a floating promise / potential unhandled rejection.

### 3.4 `localizeImages` string replacement is fragile
`src/downloader.ts:118-147` — `processedHtml.replace(url, ...)` replaces only the
first occurrence; a URL that is a prefix of another URL can be corrupted by partial
replacement; duplicate URLs enqueue two concurrent writes to the same output path (a
race the existence check doesn't prevent). Fix: dedupe into a Map, rewrite with global
escaped replacement.

### 3.5 Fixed sleeps slow everything down
Every lesson page pays a hard `waitForTimeout(5000)` (`src/scraper.ts:296`); classroom
pages pay 2000ms. `__NEXT_DATA__` is present in the initial HTML at `domcontentloaded`;
waiting on the script element would cut per-lesson latency dramatically.

### 3.6 `--no-check-certificates` passed to yt-dlp unconditionally
`src/downloader.ts:64` — disables TLS verification for no reason against known-good
hosts. Remove.

### 3.7 Arg parser nits
`src/cli.ts:27-78` — `regenerate-index` reads `args[i+1]` without advancing `i` (the
directory argument is re-processed next iteration); unknown flags silently ignored;
`--lesson-id` without a URL does nothing.

---

## 4. Code quality & architecture

- **Duplication:** `sanitizeName` copy-pasted in `cli.ts:107` and `index.ts:159`;
  `CourseManifest`/`LessonManifest` types declared three times; `writeAtomicHtml`/
  `writeAtomicJson` near-identical in three files; the big HTML/CSS templates
  duplicated across three generators. A `shared.ts`/`templates.ts` module collapses
  all of this.
- **`index.ts` does too much:** `downloadCourse` is ~450 lines owning URL parsing,
  scraping, file layout, a 110-line embedded HTML template, manifest writing, and
  concurrency. Extract `renderLessonHtml()` and a task-planning step to make it
  testable.
- **`any` creep:** `courseInfo` lessons typed `any[]`, `private ytDlp: any`, despite
  good interfaces existing in `scraper.ts`.
- **`runConcurrent` reimplements `p-limit`**, which is already a dependency used three
  lines away.
- **Windows edge cases in `sanitizeName`:** doesn't strip trailing dots/spaces or
  reserved device names (`CON`, `PRN`, …) — relevant for a tool advertising platform
  independence. (Path traversal is essentially covered since `/` and `\` are replaced.)
- **`@types/axios` devDependency is wrong** — axios ships its own types; the 0.9.x
  stub is from 2016 and can shadow them. `ts-node` also appears unused (everything
  runs via `tsx`).

## 5. Docs & packaging

- README has a duplicated paragraph (lines 51–52) and two sections both numbered "### 3."
- `package.json`: dead `main`, no `build`/`typecheck`/`test` scripts.
- `.gitignore` still lists root-level `cookies.txt`/`storage_state.json` from before
  the `.auth/` move — harmless leftovers.
- AGENTS.md is accurate and useful; its "considerations" section already names ffmpeg,
  rate limiting, and internal-link rewriting as known gaps.

## 6. Security & privacy

Reasonable for a personal tool: credentials live in `.auth/` (gitignored), session
capture is manual, the files API uses short-lived signed URLs. Tighten: HTML escaping
(3.1), drop `--no-check-certificates` (3.6), and add a README warning that
`cookies.txt` is a plaintext full session.

## 7. Testing

No tests, no lint, no CI. Ideal low-effort test targets: `sanitizeName`, `parseArgs`,
`resolveTargetLessonId`, `parseTipTap`, `resolveClassroomRootUrl`, `getUrlExtension`,
and the manifest-driven sorting in `regenerateIndex`. Fixture `__NEXT_DATA__`
snapshots would de-risk the day Skool changes its page shape — currently every
regression is discovered live, mid-download.

---

## 8. Priority recommendations

1. Fix the base64 image-filename collision (silent wrong-content corruption).
2. Fix packaging: `tsx` placement or built `dist/`; `main`; ffmpeg claim; browser install.
3. Harden `downloadAsset`: reject on response-stream error; temp-file + rename.
4. Fix the 3 `tsc` errors; add `typecheck` script.
5. Add `escapeHtml` at all template interpolation points.
6. `try/finally` around lesson pages; replace fixed sleeps with selector waits.
7. Cleanups: dedupe shared helpers/types/templates; remove `--no-check-certificates`
   and `@types/axios`; seed a test suite around the pure functions.

See `docs/BACKLOG.md` for the actionable backlog derived from this assessment.
