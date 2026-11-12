# OpenPlayer

**A liquid-glass music player for Windows.** Local files, YouTube Music, synced lyrics, a real equalizer, crossfade, a desktop widget and optional Discord presence — without ads, feeds or busywork.

<p align="center">
  <img src="https://www.axy.is-cool.dev/openplayer/assets/openplayer-nowplaying.webp" alt="OpenPlayer Now Playing screen with album art, playback controls and synced lyrics" width="900">
</p>

<p align="center">
  <a href="https://www.axy.is-cool.dev/openplayer/"><img src="https://img.shields.io/badge/website-openplayer-f9a3c0?style=flat-square" alt="OpenPlayer website"></a>
  <img src="https://img.shields.io/badge/version-0.3.0-1a2039?style=flat-square" alt="Version 0.3.0">
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-1a2039?style=flat-square" alt="Windows 10 and 11">
  <img src="https://img.shields.io/badge/made%20with-AI-f9a3c0?style=flat-square" alt="Made with AI">
</p>

<p align="center">
  <a href="https://www.axy.is-cool.dev/openplayer/">Website</a> ·
  <a href="https://github.com/ExbotsSites/OpenPlayer/releases/latest">Download</a> ·
  <a href="https://github.com/ExbotsSites/OpenPlayer/issues">Issues</a> ·
  <a href="#quick-start">Build from source</a>
</p>

---

## Contents

- [What you get](#what-you-get)
- [Install](#install)
- [Quick start](#quick-start)
- [Build a Windows release](#build-a-windows-release)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Make it yours](#make-it-yours)
- [Data and storage](#data-and-storage)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [AI disclosure](#ai-disclosure)
- [License](#license)
- [Credits](#credits)

---

## What you get

- **Local music** — add MP3, FLAC, WAV, OGG, Opus, M4A, AAC and WMA files, or drag them onto the window.
- **YouTube Music search** — search, queue and play without opening a browser.
- **Synced lyrics** — line-timed lyrics in the Now Playing view, with LRCLIB lookup and a local cache.
- **A real equalizer** — ten frequency bands plus a preamp, six presets, reset, limiter and stereo/mono output.
- **Crossfade** — adjustable from 0 to 12 seconds, with a second audio deck for equal-power transitions.
- **A library that stays yours** — liked songs, playlists, recents and queue, saved locally and per Discord profile.
- **Desktop widget** — a square, always-on-top mini player with cover art, controls and progress.
- **Discord presence** — optional “Listening to” activity with the current track and progress.
- **Optional account** — use it as a guest, or sign in with Discord to keep a separate library per profile.
- **Import tools** — bring over a public Spotify playlist, an Exportify CSV, or a library from before accounts existed.
- **No ads or feeds** — the player is the product.

The public project page, screenshots and download links live at **[www.axy.is-cool.dev/openplayer](https://www.axy.is-cool.dev/openplayer/)**.

---

## Install

### Windows installer

Download the latest **OpenPlayer-Setup** or **OpenPlayer-Portable** build from [Releases](https://github.com/ExbotsSites/OpenPlayer/releases/latest).

- **Setup** installs the app for the current user.
- **Portable** keeps the app in one executable. To keep its data beside the executable, create an `OpenPlayer-data` folder next to it; otherwise it uses the normal app data folder.
- Builds are **unsigned**, so Windows SmartScreen may warn you. If the release page publishes a SHA-256, compare it before running the installer.

No account is required. Discord sign-in is optional and only needed for a Discord-linked profile.

### First run

1. Choose **Continue with Discord** or **Use without an account**.
2. Search YouTube Music, or open **Settings → Library → Add files**.
3. Play something and open **Now playing** for the lyrics view.
4. Tune the EQ, crossfade and widget from **Settings**.

---

## Quick start

### Requirements

- **Windows 10 or 11** for the packaged app
- **Node.js 20+** (Node 22 is a good choice)
- npm
- Internet access for YouTube Music, LRCLIB lyrics and the first `yt-dlp` download

The app is built with **Electron 33**, vanilla HTML/CSS/JavaScript, `youtubei.js`, `music-metadata` and `@xhayper/discord-rpc`.

### Run the development build

```bash
git clone https://github.com/ExbotsSites/OpenPlayer.git
cd OpenPlayer
npm install
npm run fetch-ytdlp
npm start
```

`npm start` launches Electron from `main.js`.

`npm run fetch-ytdlp` downloads the latest `yt-dlp.exe` into `bin/`. If you already have a working `bin/yt-dlp.exe` or a root `yt-dlp.exe`, you can skip it. The app also falls back to `yt-dlp` on your `PATH`.

### Optional: enable Discord login and presence

1. Create an application at [discord.com/developers/applications](https://discord.com/developers/applications).
2. Open **OAuth2 → Redirects** and add exactly:
   ```text
   http://127.0.0.1:53682/callback
   ```
3. Put the Application ID in `config.js`:
   ```js
   module.exports = { DISCORD_CLIENT_ID: 'your-application-id' };
   ```
4. Restart OpenPlayer.

For Rich Presence, you can either use the same Application ID or enter a separate Client ID in **Settings → Discord → Client ID**.

You do not need a Discord client secret. OpenPlayer uses Discord’s OAuth2 implicit flow, reads the profile once and does not store the access token.

---

## Build a Windows release

```bash
npm install
npm run dist
```

`npm run dist` runs `pre-dist` automatically, which downloads the latest `yt-dlp.exe` into `bin/`, then invokes `electron-builder --win`.

Expected output in `dist/`:

| Artifact | Description |
| --- | --- |
| `OpenPlayer-Setup-0.3.0.exe` | NSIS installer; per-user, changeable install directory |
| `OpenPlayer-Portable-0.3.0.exe` | Portable Windows executable |

The build config in `package.json` currently targets **Windows only** (`nsis` and `portable`). The Electron window has macOS and Linux branches, but those targets are not configured here.

### Build notes

- `bin/yt-dlp.exe` is bundled through `build.extraResources`; it is not loaded from `node_modules`.
- `yt-dlp` updates itself on startup and is also copied into the user data folder so it remains writable.
- The app is **not code-signed** in this repository. Add signing credentials before distributing broadly.
- To ship a custom app icon, add `build/icon.ico` and set `build.win.icon` in `package.json`. The current config does not set one.
- Do not commit `dist/` or user data. Keep the generated `bin/yt-dlp.exe` out of normal source commits when possible; fetch it fresh for a release.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Run the Electron app against the source files |
| `npm run fetch-ytdlp` | Download the latest `yt-dlp.exe` into `bin/` |
| `npm run dist` | Fetch `yt-dlp` and build the Windows installer + portable app |

There is no test script or CI workflow in this repository yet. The ESLint config lives in `eslint.config.js`; it is not wired to an npm script.

---

## Project structure

```text
OpenPlayer/
├── main.js                 Electron main process
├── preload.js              contextBridge API exposed as window.op
├── renderer.js             UI, playback, EQ, lyrics, playlists, settings
├── index.html              App shell, views, player card and settings mount
├── styles.css              Liquid-glass visual system and layout
├── widget.html             Frameless desktop mini-player
├── widget.js               Widget UI and IPC bridge
├── config.js               Discord OAuth Application ID
├── scripts/
│   └── fetch-ytdlp.js      Downloads yt-dlp for development and builds
├── bin/
│   └── yt-dlp.exe          Generated by the fetch script; bundled into releases
├── package.json            Scripts, dependencies and electron-builder config
├── package-lock.json
└── yt-dlp.exe              Optional development fallback
```

## How it works

### Main process — `main.js`

`main.js` owns everything that needs Node or the operating system:

- Frameless `BrowserWindow` and the always-on-top desktop widget
- IPC handlers exposed through `preload.js`
- Local file picker and metadata extraction with `music-metadata`
- The local HTTP audio server with range requests
- `yt-dlp` resolution and `youtubei.js` fallback
- LRCLIB lyric lookup and cache
- Spotify/CSV import helpers
- Discord OAuth and Rich Presence
- Library/session files

### Preload — `preload.js`

The renderer runs with `contextIsolation: true` and `sandbox: true`. `preload.js` exposes a deliberately small API as `window.op`:

```js
await op.ytSearch('song name');
await op.ytUrl(videoId);
await op.lyrics({ title, artist, album, duration });
await op.save(library);
```

Renderer code never gets direct Node or `ipcRenderer` access.

### Renderer — `renderer.js`

The renderer is vanilla JavaScript. It handles:

- View routing: Home, Now playing, Search, Liked songs, Queue, Settings and playlists
- The queue and playback state
- Two audio decks and equal-power crossfade
- Web Audio EQ, preamp, stereo/mono and limiter
- LRC parsing and lyric scrolling
- Playlist editing, likes, recents and covers
- Discord presence updates
- The desktop widget sync

The audio graph is:

```text
Audio deck A ─┐
              ├─ preamp → 10-band EQ → stereo/mono → limiter → master volume → speakers
Audio deck B ─┘
```

### Lyrics

Lyrics come from the public **LRCLIB** API. `main.js` tries an exact match first, then progressively broader searches. The result is cached in `lyrics-cache.json` so repeat plays do not hit the network.

### YouTube playback

1. **`yt-dlp`** is tried first. The app downloads the best audio to the local cache and serves it through a local HTTP server with range support.
2. **`youtubei.js`** is the fallback when `yt-dlp` cannot resolve a track.
3. Finished downloads stay in `%TEMP%\openplayer-cache`; the cache is capped at roughly **500 MB**.

There is no YouTube API key in the project. These public endpoints can change; keeping `yt-dlp` current matters.

---

## Make it yours

### Change the name, version or bundle identity

Edit `package.json`:

```json
{
  "name": "openplayer",
  "version": "0.3.0",
  "description": "OpenPlayer - liquid glass music player",
  "build": {
    "appId": "com.openplayer.app",
    "productName": "OpenPlayer"
  }
}
```

Also update the `<title>` and visible brand text in `index.html` and the wordmark in `styles.css` if you rename the app.

### Change the look

The visual tokens are defined in `styles.css`:

```css
:root {
  --a1: #5b6577;
  --a2: hsl(from var(--a1) calc(h + 50) s l);
  --ink: #f6f4ff;
  --dim: rgba(246, 244, 255, .6);
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
}
```

- `--a1` is the accent that tints the ambient background.
- `--a2` is derived from it.
- `--serif` controls the display face used by the brand, headings and large labels.
- The layout lives further down in the same file; the main areas are `header`, `main`, `.card`, `#nav`, `#stage`, `#lyrics`, `#sound` and the responsive rules.

There is no theme picker in 0.3.0; changing these variables changes the theme.

### Add or change a view

Views are driven by the nav buttons in `index.html`:

```html
<button data-v="home">Home</button>
<button data-v="lyrics">Now playing</button>
<button data-v="search">Search</button>
```

To add a new list-style view:

1. Add a nav button with a new `data-v` value.
2. Add a branch in `renderPanel()` for its title and track list.
3. Update `setView()` if the view needs its own container instead of the shared `#panel`.
4. Add any new IPC calls to `preload.js` and `main.js` if the view needs Node-side data.

The existing nav click handler already forwards `data-v` values to `setView()`.

### Change the EQ or presets

In `renderer.js`:

```js
const FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const DEF = { eq: new Array(10).fill(0), pre: 0, /* ... */ };
```

`PRESETS` (near `buildSound()`) uses ten-number arrays matching `FREQS`. The preamp is the extra control before the first band, so the Settings screen has ten sliders plus the preamp control.

To change the range, update:

- `FREQS` for the frequency labels and filter nodes
- The slider min/max in `buildSound()`
- `DEF.eq` and every entry in `PRESETS`
- `applyFX()` if the audio graph changes

### Change the crossfade

`DEF.xf` defaults to `0`. The Settings slider is limited to `0–12` seconds. The crossfade uses the two decks in `renderer.js`: the next track is warmed up with `op.ytUrl()` and an equal-power curve fades the old deck out and the new one in.

### Change lyrics matching

`main.js` contains:

- `cleanTitle()` for removing “official video”, “lyrics”, “feat.” and similar noise
- `pickLyrics()` for scoring LRCLIB results
- `ipcMain.handle('lyrics', ...)` for lookup order and caching

If a track keeps missing, start with `cleanTitle()` and the duration/artist scoring in `pickLyrics()`.

### Change Discord login or presence

Login:

- Application ID: `config.js`
- Redirect URI: `http://127.0.0.1:53682/callback`
- Callback server: `main.js`, `ipcMain.handle('auth:login', ...)`
- Session file: `session.json` in the user data directory

Presence:

- Toggle and Client ID: **Settings → Discord**
- IPC: `rpc:cfg` and `rpc:act` in `main.js`
- Update timing: `rpcSend()` in `renderer.js`

The Rich Presence client ID is separate from the login Application ID; either can use the same Discord application.

### Update or replace `yt-dlp`

```bash
npm run fetch-ytdlp
```

The script downloads the latest official Windows binary into `bin/yt-dlp.exe`. The app copies the bundled version into the user data folder on first run and runs `yt-dlp -U` in the background on startup.

If you want to pin a version, replace the download URL in `scripts/fetch-ytdlp.js`.

### Add a setting

1. Add the default to `DEF` in `renderer.js`.
2. Add the control in `buildSound()`.
3. Update `db.settings` and call `save()`.
4. If the main process needs the value, expose an IPC method in `preload.js` and handle it in `main.js`.

Settings and library data are merged in `boot()`; unknown keys are preserved, so new settings generally do not need a migration.

### Change the build/package

`package.json` is the source of truth for:

- `main` entry point
- `scripts`
- Electron and builder versions
- `build.appId`, `build.productName`
- Included/excluded files
- `extraResources` for `yt-dlp.exe`
- NSIS and portable artifact names

After changing `version`, rebuild to produce new artifact names.

---

## Data and storage

The app uses Electron’s `userData` directory, which is normally under `%APPDATA%` on Windows. A portable build can keep its data next to the executable if an `OpenPlayer-data` folder exists there.

| File / folder | Purpose |
| --- | --- |
| `session.json` | Optional Discord profile session |
| `library.json` | Guest library: liked songs, playlists, recents, settings |
| `library-<discord-id>.json` | Per-profile library after Discord login |
| `lyrics-cache.json` | Cached LRCLIB lyrics |
| `config.json` | Optional runtime Discord Client ID |
| `bin/yt-dlp.exe` | Writable copy of the bundled downloader |
| `%TEMP%\openplayer-cache` | Temporary downloaded YouTube audio, capped near 500 MB |

The app itself does not add analytics or tracking. It does contact YouTube Music, LRCLIB and Discord when those features are used.

To reset a guest library, close the app and remove `library.json` from the user data folder. To clear downloaded audio, use **Settings → Song cache → Clear**.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `yt-dlp is not installed` | Run `npm run fetch-ytdlp`, or put a working `yt-dlp.exe` in `bin/` or the project root. |
| `Fallback also failed` when playing a YouTube track | Update `yt-dlp` (`npm run fetch-ytdlp`), check your connection, and retry. YouTube changes can temporarily break extraction. |
| No lyrics found | LRCLIB may not have a timed match. Only successful matches are cached; if a saved match is wrong, remove `lyrics-cache.json` or try a cleaner title. Instrumentals intentionally return no lyrics. |
| Discord login is disabled | Set `DISCORD_CLIENT_ID` in `config.js`, add the exact redirect URL, and restart. The ID must be 15–22 digits. |
| Discord presence is not showing | Enable **Show activity**, enter a valid Client ID in Settings, and make sure the desktop Discord app is running. |
| SmartScreen warns about the installer | Builds are unsigned. Verify the SHA-256 from the release page, or build locally. |
| Build stops while fetching `yt-dlp` | The build needs network access to GitHub. Run `npm run fetch-ytdlp` manually, then retry `npm run dist`. |
| App says another instance is running | OpenPlayer uses a single-instance lock so two copies do not fight over the same library and cache. Close the existing window. |
| The window opens but playback fails | Try a local file first; if local playback works, the issue is likely the YouTube extractor or `yt-dlp`. |
| Cache keeps growing | Use **Settings → Song cache → Clear**. The automatic cap is approximately 500 MB. |

---

## Contributing

Small, focused pull requests are welcome.

Before opening a PR:

- Run `npm start` and exercise the affected flow manually: search, local playback, queue, lyrics, EQ, widget or Discord as relevant.
- Keep the renderer/main split clean. Node work belongs in `main.js`; expose only the minimum API through `preload.js`.
- Do not commit `session.json`, library data, Discord tokens, `dist/`, or downloaded audio.
- Keep user-facing copy in the existing voice: direct, short and free of marketing filler.
- If you add a new dependency, explain why the existing stack cannot do the job.

There is no automated test suite or CI in this repository yet. If you add one, a sensible first target is the pure helpers in `renderer.js` (LRC parsing, keying, presets) and the lyric matching in `main.js`.

---

## AI disclosure

**This project was made with AI.**

---

## License

No license file is currently included in this repository. Add a license before redistributing the project or accepting outside contributions.

---

## Credits

- [Electron](https://www.electronjs.org/) and [electron-builder](https://www.electron.build/)
- [youtubei.js](https://github.com/LuanRT/YouTube.js) for YouTube Music search and fallback streams
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) for reliable audio extraction
- [music-metadata](https://github.com/Borewit/music-metadata) for local file tags and artwork
- [@xhayper/discord-rpc](https://github.com/xhayper/discord-rpc) for Discord presence
- [LRCLIB](https://lrclib.net/) for synced lyrics

Built by [Axyy](https://github.com/ExbotsSites).
