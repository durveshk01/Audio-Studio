# Initial project health audit

Audit date: 2026-11-09. Baseline commit: `313b26a` on `main`.

## Product and architecture

Audio Studio is a local-first audio workstation for musicians, podcasters, and people organizing audio collections. The primary product is a React 18 / TypeScript / Vite SPA with compression, MP3/M4A metadata editing, analysis, trimming, playback, an IndexedDB library, and preferences. Capacitor 8 embeds these assets on Android; a Java plugin uses MediaExtractor, MediaCodec, MediaMuxer, MediaStore, and FileProvider. An optional Express service retains FFmpeg batch APIs and proxies a separate FastAPI / Mutagen MetaTune application. The legacy MetaTune UI has its own IndexedDB database and must remain compatible with existing data.

There is no account system or remote relational database. Core local workflows do not need one. Vercel hosts the SPA at <https://audio-studio-eosin.vercel.app>. A Render blueprint exists, but no verified Render deployment or backend URL is configured. GitHub has a `v2.0.0` release with an APK, and its latest CI run failed.

## Findings by priority

### Critical

1. **Arbitrary image-fetch endpoint (SSRF):** Express `/api/proxy-image` accepts arbitrary URLs, follows redirects, has no timeout/size bound, and serves unvalidated upstream content. It can access internal network services and exhaust resources.
2. **Cross-user cloud data disclosure:** `/api/cloud/sync` stores one global unauthenticated in-memory object; `/api/cloud/projects` exposes it to everyone. It loses data on restart and presents that operation as successful synchronization.
3. **Core output correctness:** browser compression always writes PCM WAV, ignores `outputFormat`, reports the requested compressed bitrate instead of the actual PCM bitrate, and clamps larger outputs to zero savings. MetaTune copies M4A bytes unchanged and labels the result `.mp3`. Native ZIP entries can contain text paths instead of audio bytes.

### High priority

1. **Invented analysis results:** frequency bands are calculated from RMS formulas rather than frequency data. LUFS is a raw RMS offset, clipping is counted only in a sparse sample, and advertised true peak/silence intervals are not measured.
2. **Native input and encoding failures:** HTML-selected files do not contain native paths, so native processing usually fails. The transcoder feeds source PCM into an encoder configured for potentially different sample rates/channels without conversion, can discard decoder buffers when the encoder is busy, and mishandles empty end-of-stream buffers. Results are measured before muxer finalization.
3. **Release identity/configuration:** `android:apk` assembles a debug APK, while documentation and release naming call it a release build. Package, Node service, README, and Android versions disagree. Production signing is not configured.
4. **Broken automation:** CI invokes nonexistent `build:server`, uses Node 20 for Capacitor 8 (requires Node 22+), and Java 17 instead of Java 21. There is no release workflow.
5. **Persistence correctness:** new IndexedDB writes resolve on request success instead of transaction commit. Read/save errors are swallowed. Native tracks are stored in cache paths, artwork previews persist temporary blob URLs, and the library cannot play native-only exports.
6. **Missing cancellation/error paths:** the batch UI has no working cancel action, may announce success after failures, allows processing races on retries, and loses queue state on navigation. Analysis failures can strand the user without a file selector.
7. **Production interactions:** the Android download points to an absent `/artifacts/Audio-Studio-Test.apk`; Vercel rewrites unknown API/asset paths to HTML; no backend URL is configured. Browser offline loading is not implemented.

### Medium priority

1. `npm audit --json` reports **6 moderate advisories**, including archiver/glob/minimatch and a development rimraf chain. The upload library remains on deprecated Multer 1.x.
2. Android requests broad storage permissions it never requests at runtime, allows backups of private app data, and grants FileProvider access to whole storage roots. Plugin work, lifecycle cleanup, file names, and concurrent operations need hardening.
3. Express enables wildcard CORS, disables CSP, starts Python unconditionally, exposes verbose file paths in processing logs, and lacks global job admission/concurrency bounds. Upload limits permit very large aggregate uploads.
4. Preferences for default format/bitrate are not consumed by the compressor; reduced motion has no control/behavior; clearing cache only displays a success toast.
5. Playback toggles UI state before `play()` succeeds, carries stale source state, has no loop control despite documentation, and A/B synchronization relies on a fixed timeout.
6. Mobile settings navigation is inaccessible; several controls are mouse-only or unlabeled. Dense toolbars/player layouts, contrast in light mode, focus visibility, safe-area handling, and loading/error states need work.
7. All modules and audio libraries load at startup; full-file decode/analysis lacks decoded-memory bounds and runs expensive calculations on the UI thread.
8. Legacy MetaTune preserves blank tags intentionally, but ZIP duplicate-name handling, batch re-editing, artwork canvas initialization, and asynchronous export state need targeted review.

### Low priority

1. README makes unsupported hardware acceleration, 4K artwork, true peak, exact-size, and release claims; setup/deployment examples and version references need correction.
2. Dead project-completion data labels unverified tasks complete. Tests called `routes.test.ts` only check utilities, and the old CDP QA script targets a removed UI.
3. Keystores/environment variants, browser test output, and generated release files need explicit ignore rules; architecture/API/operational documentation is incomplete.

## Executed baseline verification

| Check | Actual result |
| --- | --- |
| Git working tree | Clean at start |
| `npm test` | 4 files, **11 tests passed** |
| `npm run build` | TypeScript, Vite client, and bundled Node server passed |
| Python unittest discovery | **12 tests passed** |
| `npm audit --json` | **6 moderate**, 0 high, 0 critical advisories |
| Production HTML | HTTPS page responds with the existing SPA and assets |
| Vercel inspection | Existing production deployment is Ready; no project environment variables |
| GitHub CI | Run `42363468903` failed on missing `build:server` |
| GitHub release | `v2.0.0` exists; APK asset is 4,452,240 bytes |
| Android devices | `adb devices -l`: **no connected device** |
| Emulator | Not installed at baseline |
| Render | No verified deployed backend; blueprint service URL `/health` returned 404 |

Passing compilation and these small tests do not establish functional production health. Browser workflows, APK installation, native encoding, physical microphone quality, and production API/database operations have not yet been tested.

## Initial category assessment

| Category | Status | Basis |
| --- | --- | --- |
| Code/build | Needs improvement | Local compilation passes; broken features and automation |
| Frontend/UI | Needs improvement | Usable design foundation, broken/mobile interactions |
| Backend | Critical | Unauthenticated shared data and unsafe upstream fetching |
| Local persistence | Needs improvement | Transaction handling and native paths/artwork bugs |
| Web deployment | Needs improvement | SPA available; missing backend and broken download/API routing |
| Android | Critical | Debug release delivery and native correctness gaps |
| Security | Critical | Demonstrable API vulnerabilities; dependency advisories |
| Performance | Needs improvement | Eager bundles and unbounded client decode/server job resources |
| Testing/release | Needs improvement | Narrow passing tests; failed CI; no device verification |
| Account authentication / relational database | Not applicable | Local-first product; optional endpoints still require authorization |

## Execution priorities

Repair audio/container correctness and API vulnerabilities first, then transactional persistence and native lifecycle/input/output integration, accessible local-first workflows, browser offline/loading performance, representative regression/E2E coverage, genuine release builds, repeatable CI, production deployment, and release evidence. Preserve both IndexedDB databases and the existing optional FFmpeg/Mutagen workflows. Physical device testing and established release-signing credentials depend on external availability and must be reported honestly.
