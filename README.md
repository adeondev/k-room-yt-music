<p align="center">
  <img src="icons/icon.png" alt="K-ROOM Logo" width="128">
</p>

# K-ROOM YT Music Control

A minimal and direct browser extension to stabilize volume on YouTube Music using the Web Audio API.

It acts as a real-time audio compressor and limiter to balance volume between quiet and loud songs without distortion.

## Features
- **Compressor & Limiter**: Controls track dynamics to prevent clipping and balance volume.
- **Auto-Gain**: Equalizes perceived loudness across different tracks.
- **Smart Mode**: Automatically detects if a song is too compressed or too dynamic and adjusts settings on the fly.
- **Highpass Filter**: Removes unwanted sub-bass rumble (< 30 Hz).
- **Pitch Black UI**: Dark interface matching YouTube's layout.
- **i18n**: Available in English and Portuguese (pt-BR).

## How to Install (Developer Mode)

Clone or download this repository first:
```bash
git clone https://github.com/adeondev/k-room-yt-music.git
```

### Chrome / Chromium / Edge / Brave
1. Go to `chrome://extensions/`.
2. Enable **"Developer mode"** in the top right corner.
3. Click **"Load unpacked"** and select the [`chrome/`](chrome/) folder.
4. Open [YouTube Music](https://music.youtube.com/) and click the extension icon.

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select the [`firefox/manifest.json`](firefox/manifest.json) file.
4. Open [YouTube Music](https://music.youtube.com/) and click the extension icon.

> Temporary add-ons are removed when Firefox restarts. For a persistent install, the extension needs to be signed via [AMO](https://addons.mozilla.org/).

## License

[MIT](LICENSE)
