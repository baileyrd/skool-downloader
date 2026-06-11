# Download Coverage

What the downloader does and does not capture, and why. Code references point
at the decision points so this stays auditable as the code evolves.

## What gets downloaded

For each lesson in a classroom (`src/index.ts`, lesson task):

| Content | Destination | How |
|---------|-------------|-----|
| Video | `video.mp4` | yt-dlp, highest quality, streams merged via bundled ffmpeg, `+faststart` applied (`src/downloader.ts` `downloadVideo`) |
| Lesson text/body | `index.html` | Scraped rich-text content rendered into a styled offline page; embedded code blocks are preserved as part of the body |
| Images in lesson content | `assets/` | Every `<img src>` is downloaded and the HTML rewritten to the local copy (`src/downloader.ts` `localizeImages`) |
| Native file attachments | `resources/` | Download URL fetched per `file_id` from Skool's file API, then streamed to disk (`src/scraper.ts` resource extraction, `src/downloader.ts` `downloadAsset`) |

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

### Google Docs / Sheets / Slides stay online-only (tracked: B8)

Google-hosted files are inherently links to `docs.google.com`, so they are
classified external and never downloaded — even though they are often core
course material. The links are also fragile (sharing revoked, doc deleted,
community shut down). `docs/BACKLOG.md` item **B8** covers localizing them via
Google's unauthenticated export endpoints.

Edge case: if a creator exported a Google Doc to `.docx` and uploaded that file
to Skool, it is a native attachment and *is* backed up. Only live Google links
stay remote.

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
