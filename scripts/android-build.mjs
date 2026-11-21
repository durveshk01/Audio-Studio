import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ANDROID, ROOT, androidTool, gradle, isMain } from "./android-tools.mjs";
import { loadSigning, signApk } from "./android-signing.mjs";

export function verifyLocalAssets() {
  const directory = resolve(ANDROID, "app/src/main/assets");
  const config = JSON.parse(readFileSync(resolve(directory, "capacitor.config.json"), "utf8"));
  if (config.appId !== "com.audiostudio.mobile" || config.server?.url || config.server?.cleartext) throw new Error("Android must use bundled local assets, with no remote server URL or cleartext navigation.");
  if (!existsSync(resolve(directory, "public/index.html"))) throw new Error("Bundled web assets are missing. Run npm run android:sync first.");
  const index = readFileSync(resolve(directory, "public/index.html"), "utf8");
  if (!index.includes("assets/") || /<script[^>]+src=["']https?:/.test(index)) throw new Error("The APK does not contain a standalone production app shell.");
  return config;
}

export function verifyApk(path, release) {
  const badging = androidTool("aapt2", ["dump", "badging", path], { capture: true });
  const version = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;
  if (!badging.includes("name='com.audiostudio.mobile'") || !badging.includes(`versionName='${version}'`)) throw new Error("The APK identity/version does not match the project.");
  if (release && (badging.includes("application-debuggable") || badging.includes("android.permission.INTERNET"))) throw new Error("Release APK must be non-debuggable and have no Internet permission.");
  return badging;
}

function build() {
  verifyLocalAssets();
  const debug = process.argv.includes("--debug");
  const checksOnly = process.argv.includes("--checks-only");
  if (!debug && !checksOnly) loadSigning();
  const tasks = [":app:testDebugUnitTest", ":app:lintRelease"];
  if (!checksOnly) tasks.push(debug ? ":app:assembleDebug" : ":app:assembleRelease");
  gradle(tasks);
  if (checksOnly) return;
  const output = resolve(ROOT, "artifacts/apk");
  if (!existsSync(ROOT)) throw new Error("The project directory is unavailable.");
  mkdirSync(output, { recursive: true });
  const path = resolve(output, debug ? "Audio-Studio-Debug.apk" : "Audio-Studio-Release.apk");
  let certificate;
  if (debug) copyFileSync(resolve(ANDROID, "app/build/outputs/apk/debug/app-debug.apk"), path);
  else {
    const unsigned = resolve(ANDROID, "app/build/outputs/apk/release/app-release-unsigned.apk");
    const aligned = resolve(output, "app-release-aligned.apk");
    androidTool("zipalign", ["-f", "-P", "16", "4", unsigned, aligned]);
    certificate = signApk(aligned, path);
    copyFileSync(path, resolve(ANDROID, "app/build/outputs/apk/release/app-release.apk"));
    console.log(certificate.trim());
  }
  verifyApk(path, !debug);
  androidTool("zipalign", ["-c", "-P", "16", "4", path]);
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName = debug ? "Audio-Studio-Debug.apk" : "Audio-Studio-Release.apk";
  writeFileSync(resolve(output, `${fileName}.sha256`), `${sha256}  ${fileName}\n`);
  writeFileSync(resolve(output, `${fileName}.build.json`), JSON.stringify({
    version: JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version,
    applicationId: "com.audiostudio.mobile", variant: debug ? "debug" : "release", sizeBytes: bytes.length,
    sha256, builtAt: new Date().toISOString(), bundledAssets: true, internetPermission: debug,
    checks: ["testDebugUnitTest", "lintRelease", "APK identity", "zip alignment"], certificate
  }, null, 2));
  console.log(`Verified ${fileName}: ${bytes.length} bytes; SHA-256 ${sha256}`);
  console.log(`APK: ${path}`);
}

if (isMain(import.meta.url)) {
  try { build(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
