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

1. Clone or download this repository:
   ```bash
   git clone https://github.com/adeondev/k-room-yt-music.git
   ```
2. Open your Chromium-based browser and go to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top right corner.
4. Click **"Load unpacked"** and select the extension folder.
5. Open [YouTube Music](https://music.youtube.com/) and click the extension icon.

## License

[MIT](LICENSE)
