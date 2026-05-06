<!-- logo -->

# Spire

A lightweight, open-source audiobook and podcast player for Windows.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue)
![Status: Early Access](https://img.shields.io/badge/status-early%20access-orange)

## Features

- **Local audiobook library** with cover art, chapters, and resume
- **M4B chapter navigation**
- **Variable playback speed** (0.5×–3.5×) remembered per book
- **Podcast RSS feed** support
- **Direct URL and yt-dlp downloads** (archive.org, YouTube, SoundCloud, 1000+ sites)
- **Progress tracking and bookmarks**
- **Lightweight** — no cloud, no account, all local

## Roadmap
Track what's coming and vote on features: [github.com/users/TitaniumKnight1/projects/2](https://github.com/users/TitaniumKnight1/projects/2)

## Download

Windows installer builds are published on [GitHub Releases](https://github.com/USERNAME/spire/releases).

## Torrent downloads

Spire does not include a built-in torrent client. For downloading audiobook torrents, we recommend [qBittorrent](https://www.qbittorrent.org/). Set qBittorrent’s download directory to your Spire library folder (**Settings → Library Location**) and files will be imported automatically when downloads complete.

## Building from source

**Prerequisites:** [Node.js](https://nodejs.org/) 18 or newer, npm

```bash
git clone https://github.com/USERNAME/spire.git
cd spire
npm install
```

Place **mpv.exe** in the `binaries/` folder at the project root (alongside any other bundled tools your build expects), then start the app:

```bash
npm run dev
```

## License

MIT
