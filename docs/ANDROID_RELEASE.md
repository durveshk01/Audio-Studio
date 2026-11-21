# Android release build and verification

## Identity and offline processing

- Package: `com.audiostudio.mobile`.
- Version: `2.1.0`; Android version code: `20100`.
- Minimum Android API: `24`; compile/target API: `36`.
- JDK 21 and Node.js 22.12+ are required.
- Capacitor serves bundled assets at HTTPS `localhost`. Android mode disables optional backend interactions.
- The release is non-debuggable, has no Internet permission, and disables app-data backups.
- Android System WebView 99+ is required. The bundled startup-help page explains updating WebView.

AAC uses Android's selected media codec, with streaming conversion to the requested sample rate and channel layout. Hardware acceleration is reported only when Android confirms it. MP3, WAV, tagging, artwork, and analysis use bundled local code.

## Signing

Initialize a key only when setting up a new signing identity:

```bash
npm run android:signing
```

The ignored `.signing/config.json` references the maintained private keystore and credentials. Keep a secure backup of the complete `.signing/` directory so future versions can update existing installations.

For a build environment with externally supplied signing credentials, set:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

When retaining the existing v2.0.0 update lineage, also supply `ANDROID_LEGACY_KEYSTORE_PATH` and `ANDROID_SIGNING_LINEAGE_PATH`. Existing local signing configuration already carries this lineage. Rotation uses the production certificate on Android 9+ and the legacy signer on Android 7–8.

`npm run android:signing -- --migrate-v2` checks that the available legacy key matches the published v2.0.0 certificate before creating a lineage. It must not be used with an unrelated key.

Private configuration, keystores, passwords, and lineage files are excluded from Git and release uploads. CI creates a disposable key to test the non-debuggable variant.

## Build

```bash
npm ci
npm test
npm run lint
npm run verify:audio
npm run android:apk
```

The Android command builds Android-mode web assets, synchronizes Capacitor, runs `:app:testDebugUnitTest` and `:app:lintRelease`, assembles release code, performs 16 KB-compatible ZIP alignment, signs, and verifies the result.

The publishable APK is **`artifacts/apk/Audio-Studio-Release.apk`**. Its `.sha256` sidecar records the exact file hash; `.build.json` records size, identity, build checks, and public certificate details. The unsigned/aligned intermediates are not release assets.

## Test the signed release

FFmpeg must be on PATH to generate real WAV, MP3, M4A, AAC, FLAC, and OGG fixtures. Start a dedicated emulator or authorize a USB-connected phone:

```bash
adb devices -l
npm run android:test -- --serial DEVICE_SERIAL
```

The runner installs the signed release and a matching signed instrumentation APK. Tests cover:

- Release package/version, non-debuggable status, and offline permission policy.
- AAC conversion of real input containers and supported sample-rate/channel combinations.
- Decodable, non-silent outputs, continuous AAC packet timestamps, decoded-tone trim duration, cancellation, and invalid-region cleanup.
- Packaged React startup and offline workspace navigation.
- AAC persistent exports, playback, restart, cache maintenance, and system Downloads export.
- MP3/WAV encoding inside the release WebView.
- M4A tag and local-cover embedding, checked with Android MediaMetadataRetriever.
- Local FFT analysis and a real trimmed WAV export.

Successful full runs write `artifacts/android-tests/instrumentation.txt`, `validation.json`, and `validation-apiNN.json`, including the tested APK checksum, API level, and test count. `--class` enables focused diagnosis and produces a partial validation report.

### Verified local run

On 2026-11-21, the refreshed signed `2.1.0` APK passed all **8 instrumentation tests** on **Android 16 / API 36**, with airplane mode enabled and Wi-Fi disabled. The current report is `artifacts/android-tests/validation-current-api36.json`; it identifies the exact APK checksum.

This build rebuilt and synchronized the Android web assets, compared freshly compiled Java method signatures/instructions with all eight existing release classes, preserved the native bridge/resources/DEX, and aligned/signed the refreshed APK with the existing signing lineage. A full Gradle rebuild was unavailable because the cached Gradle distribution lacked its runtime libraries and network downloads were restricted. The APK build manifest records that limitation; fresh Gradle lint/unit tasks were not run.

An initial Android 15 / API 35 native test run reported AAC audible-region durations shorter than the selected 1.25 seconds (1.115 seconds for 22,050 Hz mono WAV input and 1.184 seconds for 44,100 Hz stereo MP3 input). That target disconnected during diagnosis. Android 16 was selected for the current validation; the Android 15 AAC issue remains unresolved and must be checked before claiming equivalent native-audio behavior on that version.

On 2026-11-10, the signed `2.1.0` release passed all **8 instrumentation tests** on an **Android 16 / API 36 emulator**, with airplane mode enabled and Wi-Fi disabled. The full runtime report is `artifacts/android-tests/validation-api36.json`, also recorded as `validation.json`, and its SHA-256 matches the release APK and build manifest.

Native regressions covered all four supported sample rates, mono/stereo output, and all six advertised input containers. They verified 1024-sample AAC-LC packet spacing and the 1.25-second decoded-tone trim region within 30 ms. Container-duration checks allow rate-dependent encoder priming and final frame padding.

For hardware verification, additionally exercise the system file picker, speaker/headphone playback, native share targets, long-file limits, storage-full behavior, and background/foreground transitions on the intended phone. Android 7–9 saves through the system document picker; Android 10+ uses scoped Downloads storage.

For update verification, install the published v2.0.0 APK, create recognizable library/settings data, then install the new signed release with `adb install -r`. Confirm installation succeeds and retained data remains usable.

## Publish matching source and artifacts

Commit the reviewed source and push it before publishing. Create the `v2.1.0` release targeting that exact source commit and attach:

1. `Audio-Studio-Release.apk`
2. `Audio-Studio-Release.apk.sha256`
3. `Audio-Studio-Release.apk.build.json`
4. A runtime validation report when available.

Release notes must state the Android versions and workflows actually verified. Download the published APK again, compare its SHA-256 with the sidecar, and verify the APK signature. Keep production signing credentials separate from public build and runtime evidence.
