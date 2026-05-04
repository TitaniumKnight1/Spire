# 🔺 Spire

A lightweight, local-first audiobook and podcast player for Windows — built for people who own their files.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue)
![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)
[![Latest Release](https://img.shields.io/github/v/release/TitaniumKnight1/Spire?label=download)](https://github.com/TitaniumKnight1/Spire/releases/latest)

---

## Why Spire?

The Windows audiobook player landscape is thin and outdated. Nothing combines a clean modern UI with real power-user features. Spire does:

- **Drag-and-drop library** — drop a folder of MP3s or a single M4B and it just works
- **Magnet link support** — click any magnet link in your browser and Spire queues the download
- **yt-dlp integration** — paste any URL (YouTube, archive.org, SoundCloud, podcast feeds) and Spire downloads it
- **M4B chapter navigation** — full chapter sidebar, skip by chapter, per-book position memory
- **Local only** — no account, no cloud, no telemetry. Your files stay yours.

---

## Features

### ✅ Available now (v0.1)
- Library grid and list view with cover art and progress bars
- Drag-and-drop files and folders to add books
- Multi-file book support (folder of MP3s treated as one book)
- M4B chapter support with chapter sidebar
- Resume exact position per book
- Variable playback speed (0.5×–3.5×), remembered per book
- Magnet link handler — registers `magnet:` URI scheme system-wide
- Download queue with progress, pause, cancel, retry
- Local SQLite library — everything persists, nothing leaves your machine

### 🔜 Coming in v0.2–0.3
- Sleep timer, bookmarks with notes, skip silence
- Search and filter, tags, series grouping, metadata editor
- yt-dlp URL downloads, podcast RSS feeds, `.torrent` file support
- Mini player, system tray controls, media key support

### 🔵 Planned for v0.4–0.5
- Listening stats, EQ presets
- Linux AppImage build
- OPDS catalog support (Standard Ebooks, Calibre server)
- Podcast subscriptions with auto-download

---

## Download

Head to [Releases](https://github.com/TitaniumKnight1/Spire/releases) and grab the latest `Spire Setup x.x.x.exe`.

> **First run on Windows:** SmartScreen may show a warning. Click "More info" → "Run anyway". This is expected for open-source apps without a code signing certificate.
>
> Linux AppImage coming in v0.4. macOS is not a planned target.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Shell | Electron |
| UI | React + TypeScript |
| State | Zustand |
| Audio | Howler.js |
| Torrents | WebTorrent |
| URL Downloads | yt-dlp (bundled) |
| Metadata | music-metadata |
| Database | better-sqlite3 |
| Packaging | electron-builder |

All React components are pure presentation components with zero Electron imports — the architecture is designed so a future iOS/Android port via Capacitor requires no rewrite.

---

## Building from Source

**Requirements:** Node.js 20+, Windows 10/11 (for NSIS installer)

```bash
git clone https://github.com/TitaniumKnight1/Spire.git
cd Spire
npm install
npm run dev        # Launch in development mode
npm run build      # Build the Windows installer → dist/
```

---

## Contributing

Spire is MIT-licensed and open to contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Found a bug? [Open an issue](https://github.com/TitaniumKnight1/Spire/issues).
Have an idea? Check the [public roadmap](https://github.com/TitaniumKnight1/Spire/projects) — community upvotes shape what gets built next.

---

## Supporting Spire

Spire is free and open source. If it's useful to you:

- ⭐ Star the repo — it helps more than you'd think
- [Buy me a coffee on Ko-fi](https://ko-fi.com) *(link coming soon)*
- Share it on r/audiobooks, r/DataHoarder, or r/selfhosted

---

## License

MIT © Ryan
