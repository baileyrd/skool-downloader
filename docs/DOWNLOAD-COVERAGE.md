# Download Coverage

What the downloader does and does not capture, and why. Code references point
at the decision points so this stays auditable as the code evolves.

## What gets downloaded

For each lesson in a classroom (`src/index.ts`, lesson task):

| Content | Destination | How |
|---------|-------------|-----|
| Video | `<lessonIndex> - <title>.mp4` (stem capped at 60 chars; legacy archives keep `video.mp4` — migrate with `skool migrate-video-names <dir>`) | yt-dlp, capped at 1080p preferring H.264/AAC for player compatibility (override with `--quality <height\|best>`), streams merged via bundled ffmpeg, `+faststart` applied (`src/downloader.ts` `downloadVideo`) |
| Lesson text/body | `index.html` | Scraped rich-text content rendered into a styled offline page; embedded code blocks are preserved as part of the body |
| Images in lesson content | `assets/` | Every `<img src>` is downloaded and the HTML rewritten to the local copy (`src/downloader.ts` `localizeImages`) |
| Native file attachments | `resources/` | Download URL fetched per `file_id` from Skool's file API, then streamed to disk (`src/scraper.ts` resource extraction, `src/downloader.ts` `downloadAsset`) |
| Google Docs/Sheets/Slides links | `resources/` | URL rewritten to Google's unauthenticated export endpoint (Docs → PDF, Sheets → XLSX, Slides → PPTX) and downloaded (`src/google-export.ts`); falls back to an external link with a warning if the export requires sign-in or is disabled |

Per course:

- Course cover image → `assets/course-cover.<ext>` (`src/index.ts`).
- Generated navigation: course `index.html`, group (community) index, and
  `.course.json` / `lesson.json` manifests for resumability. These are written
  locally, not downloaded.

One-time tooling (not course content): the `yt-dlp` binary is downloaded from
GitHub into `bin/` on first run (`src/downloader.ts` `init`). ffmpeg ships
bundled via `ffmpeg-static` and is not downloaded at runtime.

## How resources are classified: host, not file type

The single decision point is in `src/scraper.ts` (DOM resource scraping): a
resource URL is **native** if it points at `api2.skool.com` or a `/files/`
path, and **external** otherwise.

- **Native attachments are downloaded regardless of type.** The pipeline has no
  allowlist, blocklist, or MIME check anywhere — PDF, DOCX, PPTX, XLSX, ZIP,
  `.md`, `.py`, `.json`, `.ipynb`, `.tar.gz`, anything Skool's file API serves
  is streamed byte-for-byte into `resources/`.
- **External resources are kept as links only**, rendered in the lesson page's
  "Resources / Attachments" section marked "(External)" (`src/index.ts`,
  external-resource branch). Nothing is fetched.

Filenames survive sanitization: `sanitizeName` (`src/shared.ts`) only replaces
filesystem-unsafe characters (`/ \ ? % * : | " < >`) and strips trailing
dots/spaces, so extensions like `.zip` and `.tar.gz` are preserved.

## Known gaps and caveats

### Google Docs / Sheets / Slides: exported when link-shared (B8, done)

Google Docs, Sheets, and Slides links are rewritten to Google's
unauthenticated export endpoints (`src/google-export.ts`) and downloaded into
`resources/` — Docs as PDF, Sheets as XLSX, Slides as PPTX. This works for
"anyone with the link" sharing. If the export requires sign-in or the owner
has disabled downloads, Google serves an HTML page instead of the file; the
downloader detects this, keeps the original external link, and logs a warning
that the offline backup is incomplete.

Not exported (stay external links): published-to-web URLs (`/d/e/<token>`),
Google Drive file links (`drive.google.com/file/...`), and Google Forms —
these use different or nonexistent export endpoints.

### Other external hosts stay online-only

Dropbox, Notion, Loom, GitHub (e.g. "download the starter code" release
links), and any other non-Skool host get the same link-only treatment. Out of
scope for B8; noted there for later.

### DOM-scraped resources may lose their file extension

Attachments found in Skool's lesson metadata carry a real `file_name`.
Resources discovered only by scraping the page DOM fall back to using the
display *title* as the filename (`src/scraper.ts`, DOM merge). A native
attachment titled "Starter Code" instead of "starter-code.zip" is saved with
correct bytes but no extension.

### Not classroom content at all

The tool downloads classroom/course material only. Community posts, comments,
calendar events, and member content are not touched.
