# Project repair and APK publication implementation plan

**Goal:** Review the current project changes, repair reproducible errors, verify the app, and publish matching source and a signed APK to the existing GitHub repository.

**Architecture:** Preserve the React/Capacitor local audio workflows and optional Express/FastAPI services. Use the existing signing identity, release scripts, regression tests, and `main` branch.

**Constraints:** Keep private signing files and environment values out of GitHub. Do not replace existing changes. Respect the session's restricted filesystem and network policy.

- [x] Inventory tracked and untracked source, configuration, documentation, tests, and the existing GitHub release.
- [x] Run TypeScript, lint, unit tests, production build, audio verification, and desktop/mobile workflow tests.
- [x] Reproduce and repair delayed A/B playback after navigation using a browser regression in `tests/e2e/audio.spec.ts` and `src/client/components/ComparePlayer.tsx`.
- [x] Check remaining runtime/error paths and validate the fix with focused regressions. Android 15 AAC duration checks failed and require another API 35 run; the target disconnected during diagnosis.
- [x] Rebuild the Android web assets, verify compiled Java source matches the existing native release classes, refresh the APK while preserving native bridge/resources/DEX, align/sign, and pass all eight Android 16 runtime tests. A complete Gradle rebuild is blocked by an incomplete cached distribution and restricted network.
- [x] Review the final diff and rerun affected checks: 38 unit tests, 10 browser tests, TypeScript, lint, and production builds pass. Python dependency installation, FFmpeg verification, and npm audit require unavailable dependencies/network.
- [ ] Commit and push to `durveshk01/Audio-Studio`, publish v2.1.0 with APK/checksum/build/runtime evidence, and verify the published artifact. Record any policy or authentication blocker precisely.

Publication is blocked in this session: the GitHub push connector returned "MCP tool call requires approval, but approval policy is never". The local `.git` directory is read-only, command-line GitHub access is network-restricted, and `gh auth status` reports an invalid saved token. The source-change archive, tracked patch, release notes, checksum, build evidence, runtime report, and publishing script are prepared under `artifacts/publication/`.

The user selected Android 16 for the current verification after the Android 15 emulator disconnected. Android 15 AAC-duration behavior remains recorded as a known limitation.
