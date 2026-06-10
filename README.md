# 🎓 Skool Downloader

A robust, platform-independent CLI tool to create local, offline backups of your [Skool.com](https://skool.com) courses. 

This tool downloads video content, localizes images, preserves course attachments, and generates a navigable, styled HTML structure that mirrors the online classroom.

## ✨ Features

- **🚀 Smart Binary Management:** Automatically downloads the correct `yt-dlp` binary for your OS, and bundles a static `ffmpeg` (via [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)) for Windows, macOS, and Linux on x64 and ARM64. On platforms `ffmpeg-static` does not cover, the tool warns and falls back to a system-wide `ffmpeg` for stream merging.
- **📹 High-Quality Video:** Downloads the highest available quality and applies `+faststart` for instant browser playback.
- **📄 Asset Localization:** Downloads all lesson images locally and rewrites HTML paths for true offline 100% viewing.
- **📎 Resource Preservation:** Automatically fetches course attachments (PDFs, DOCX, etc.) via Skool's API.
- **🎯 Single Lesson Mode:** Download a whole course or just a single lesson using a specific URL.
- **🛠 Interrupted Download Recovery:** Skips already downloaded files and includes a tool to regenerate the index page.

## 🛠 Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)
- Playwright's Chromium browser — install it once with:

  ```bash
  npx playwright install chromium
  ```

  Browsers are **not** downloaded automatically on `npm install` (it is slow and surprising). If you skip this step, the tool stops at startup with a message pointing you to the command above.

**Note:** No system-wide installation of `yt-dlp` or `ffmpeg` is required on common platforms. `yt-dlp` is downloaded into the local `bin/` folder on first run, and `ffmpeg` ships with the package via `ffmpeg-static`.

## 🚀 Getting Started

### 1. Installation

```bash
git clone https://github.com/balmasi/skool-downloader.git
cd skool-downloader
npm install
```

### 2. Authentication

Skool uses secure authentication. This tool uses a manual login flow to capture your session safely.

```bash
npm run login
```
*A browser window will open. Log in to your Skool account. Once you see your dashboard, the script will save your session and close the browser.*

### 3. Using NPX

This package is published on npm, so you can run the CLI without installing anything locally:

```bash
npx skool-downloader
```

If you prefer to stay completely local (and allow offline development), run `npm install` once and use `npm run skool` as shown below.

> **Implementation note:** the published package ships its TypeScript sources and runs them through `tsx` at runtime (a regular dependency) instead of a compiled `dist/` build. This keeps installs simple at the cost of a slightly larger download.

### 4. Downloading a Course

To download an entire classroom:

```bash
npm run skool https://www.skool.com/your-community/classroom/course-id
```

To download **all courses** in a community classroom:

```bash
npm run skool https://www.skool.com/your-community/classroom
```

To download **multiple courses** interactively:

```bash
npm run skool
```
Then choose **Download multiple courses** and select the courses you want.

You can also run `npx skool-downloader` to enter the same interactive menu.

To download only a **single lesson**:

```bash
npm run skool "https://www.skool.com/your-community/classroom/course-id?md=lesson-id"
```

## 📁 Output Structure

The tool creates a `downloads/` folder with the following structure:
```text
downloads/
└── Community Name/
    └── Course Name/
        ├── index.html (Master navigation page)
        └── 1-Module Name/
            ├── 1-Lesson Title/
            │   ├── index.html (The lesson page)
            │   ├── video.mp4
            │   ├── assets/ (Localized images)
            │   └── resources/ (Attachments)
            └── ...
```

## 🔧 Advanced

### Regenerating the Index
If you manually move files or skip lessons, you can regenerate the master `index.html` file based on the current contents of your `downloads/` folder:

```bash
npm run regenerate-index
```

## 🛡 Disclaimer

This tool is for **personal backup and offline viewing purposes only**. Please respect the content creators' terms of service and intellectual property rights. Do not distribute downloaded content without permission.

## 📄 License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** license. See `LICENSE` for the full legal code.
