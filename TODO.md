# Skool Downloader TODO

## 🛠️ Critical Fixes & Improvements
- [x] **Fix Native Skool Video Downloads (HLS/m3u8)**
    - [x] Investigate if native videos require a "play" click to trigger signed token generation.
    - [x] Update Scraper to detect and extract native m3u8 playlist URLs by interacting with the player.
    - [x] Ensure signed tokens are passed correctly to `yt-dlp`.
- [x] **Preserve Module Order**
    - [x] Number the module folders (e.g., `1-Module Name`, `2-Module Name`) for lexicographical sorting.
- [x] **Download Course Attachments**
    - [x] Parse `course.metadata.resources` from `__NEXT_DATA__`.
    - [x] Download PDFs, DOCX, and other files into a `resources/` folder within each lesson.
    - [x] Add links to these resources in the generated `index.html`.
    - [x] Use direct API calls to `https://api2.skool.com/files/{file_id}/download-url` instead of DOM interaction for skool uploaded (native) content.
    - [x] Scrape DOM for **external** links and additional resources missing from metadata.**
- [x] **Single Lesson Extraction**
    - [x] Accept lesson URLs (with `?md=`) to download only that specific lesson.
- [x] **Skip Already Downloaded Content**
    - [x] Check if videos, resources, and images already exist before downloading.
    - [x] Display file size and skip message for existing content.

## 🎨 Performance
- [x] **Parallel Content Downloading (Configurable)**
    - [x] Ensure that images from the lesson content are also downloaded
    - [x] Parallelize lessons with concurrency control
    - [x] Parallelize assets (images/resources) within lessons

## 🎨 Polishing & User Experience
- [x] **Better downloading of content**
    - [x] Ensure that images from the lesson content are also downloaded
- [x] **Interactive CLI**
    - [x] Well-designed commands to help user choose which content they want to download
- [x] **Download entire courses library from the community**
    - [x] Allow optional selection of specific courses
    - [x] Integrate into interactive CLI
    - [x] Save course with image, and navigable HTML for each course (with image), as well as all courses for the community. (make sure update hooks are solid)

## 🔁 Resume & Run Efficiency (2026-06-12)
- [x] **lessonId-based reconcile pass** (`src/reconcile-lessons.ts`)
    - [x] Rename lesson folders (and index-prefixed videos + page `<video src>`) when course-order shifts change their index, instead of re-downloading.
    - [x] Remove duplicate folders for the same lessonId once a complete copy is in place.
    - [x] Report orphan folders whose lesson no longer exists in the course (never auto-deleted).
- [x] **Aggregate run summary** after multi-course downloads (courses/lessons/videos/resources, reconcile stats).
- [x] **Count failed videos in the summary** (`failedVideos`) instead of burying them in scrollback.
- [x] **yt-dlp progress** surfaced via events (Listr status line + 25/50/75% log lines) instead of silent `execPromise`.
- [x] **Cap concurrent YouTube downloads** (3 processes) to stay clear of throttling; Skool-native streams unaffected.
- [x] **One shared Chromium** across the library fetch and all course downloads in multi-course runs.
- [x] **Group index regenerated once per run** in multi-course flows instead of after every course.
- [x] **Fail fast without a TTY** when login is needed (no hanging `confirm()` in cron/CI).
- [x] **Group-folder reconcile** (`src/reconcile-group.ts`): rename a group folder identified by its URL slug (legacy slug-named folders or `.group.json` match) when the display name differs, instead of re-downloading the whole community; warn on split archives. Unified `parseClassroom`/`parseCourseLibrary` group-name derivation (displayName first).
- [x] **Global yt-dlp process cap** (3 concurrent, any host — Loom rate-limits too, not just YouTube) plus `--retry-sleep` exponential backoff for fragment/http retries.
- [x] **Honest download accounting**: summaries report `processed` vs `New media: N videos (size), M resources` instead of calling metadata refreshes "downloaded".
