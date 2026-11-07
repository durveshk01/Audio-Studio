# Audio Studio

Audio Studio brings two music workflows together in one website:

- **Audio Compressor** at `/` compresses MP3 and M4A files with FFmpeg, including batch jobs and downloadable ZIPs.
- **MetaTune** at `/metatune` edits metadata, manages a local music library, analyzes audio, and creates cover artwork.

Both workflows use the same site origin and run from the Node web server. The server starts the MetaTune FastAPI service privately and forwards its page, static files, API requests, and downloads. Compressor jobs continue to use the Express API.

The complete MetaTune project files are kept under `metatune/`, including its tests, sample MP3, and original deployment references. The root `render.yaml` is the deployment configuration for the combined website.

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer
- FFmpeg and FFprobe available on `PATH`

## Local development

Install the MetaTune Python dependencies into a virtual environment:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r metatune/requirements.txt
npm ci
npm run dev
```

On macOS or Linux, use `.venv/bin/python -m pip` in place of `.venv\Scripts\python`.

Open `http://localhost:5173` for compression or `http://localhost:5173/metatune` for metadata and artwork. The Vite development server proxies both workflows to the local Express server.

## Android test APK

The Android app opens the combined website in a native shell. The backend still runs on the computer, so keep `npm start` running and connect the phone to the same Wi-Fi network. Set `CAPACITOR_SERVER_URL` in `.env` to the computer's LAN address, for example `http://192.168.1.20:10000`, before building.

On Windows, build a debug APK with:

```powershell
npm run android:apk
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the phone and install it. If the computer's LAN address changes, update `.env` and rebuild.

## Production build

```bash
npm ci --include=dev
python3 -m venv .venv
.venv/bin/pip install -r metatune/requirements.txt
npm run build
npm start
```

The production server serves the built website and both APIs on `$PORT`. Set `FFMPEG_PATH`, `FFPROBE_PATH`, or `METATUNE_PYTHON` if the default executable locations do not apply. `METATUNE_PORT` controls the private local port used by FastAPI.

## Deploy on Render

The included `render.yaml` builds the React site, installs FFmpeg and the Python dependencies, and starts both backends behind one web service. Create a Render Blueprint from this repository and open the service URL when deployment completes.

## File handling

Compression uploads are limited by `MAX_FILE_MB` and `MAX_UPLOAD_FILES`. Compressor temporary files are removed after the configured job lifetime. MetaTune accepts MP3 and M4A files up to 50 MB and keeps generated downloads temporarily on the server. Its library is stored in the browser. AI artwork generation uses the Pollinations image service.
