import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, ANDROID, androidTool, gradle, isMain, run } from "./android-tools.mjs";
import { signApk } from "./android-signing.mjs";
import { verifyApk, verifyLocalAssets } from "./android-build.mjs";

function test() {
  verifyLocalAssets();
  const apk = resolve(ROOT, "artifacts/apk/Audio-Studio-Release.apk");
  if (!existsSync(apk)) throw new Error("Build a signed release with npm run android:apk before testing it.");
  verifyApk(apk, true);
  const option = (name) => {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Provide a value for ${name}.`);
    return value;
  };
  const devices = androidTool("adb", ["devices"], { capture: true }).split("\n").map((line) => line.match(/^(\S+)\s+device\s*$/)?.[1]).filter(Boolean);
  const requested = option("--serial") || process.env.ANDROID_SERIAL;
  const serial = requested || (devices.length === 1 ? devices[0] : undefined);
  if (!serial || !devices.includes(serial)) throw new Error("Select one authorized device with --serial <id> (see adb devices), or start a single emulator.");
  const adb = (args, options) => androidTool("adb", ["-s", serial, ...args], options);
  const classFilter = option("--class");
  run(process.execPath, [resolve(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/generate-native-fixtures.ts"]);
  gradle([":app:assembleDebugAndroidTest"]);
  const unsigned = resolve(ANDROID, "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk");
  const directory = resolve(ROOT, "artifacts/android-tests");
  mkdirSync(directory, { recursive: true });
  const instrumented = resolve(directory, "Audio-Studio-Instrumentation.apk");
  signApk(unsigned, instrumented);
  adb(["install", "-r", "--no-streaming", apk]);
  adb(["install", "-r", "--no-streaming", instrumented]);
  const expectedVersion = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;
  const args = ["shell", "am", "instrument", "-w", "-r", "-e", "release", "true", "-e", "expectedVersion", expectedVersion];
  if (classFilter) args.push("-e", "class", classFilter);
  args.push("com.audiostudio.mobile.test/androidx.test.runner.AndroidJUnitRunner");
  const output = adb(args, { capture: true });
  writeFileSync(resolve(directory, "instrumentation.txt"), output);
  console.log(output.trim());
  const tests = output.match(/OK \((\d+) tests?\)/)?.[1];
  if (!tests || /FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=|Process crashed/.test(output)) {
    try { writeFileSync(resolve(directory, "logcat-failure.txt"), adb(["logcat", "-d", "-v", "threadtime", "-t", "3000"], { capture: true })); }
    catch (error) { console.warn(`Could not capture Android failure logs: ${error.message}`); }
    throw new Error("Release APK instrumentation failed. See artifacts/android-tests/instrumentation.txt.");
  }
  const version = adb(["shell", "getprop", "ro.build.version.release"], { capture: true }).trim();
  const api = adb(["shell", "getprop", "ro.build.version.sdk"], { capture: true }).trim();
  const validation = { apk: "Audio-Studio-Release.apk", sha256: readFileSync(`${apk}.sha256`, "utf8").split(" ")[0], serial,
    androidVersion: version, apiLevel: Number(api), testsPassed: Number(tests), testedAt: new Date().toISOString(), release: true, internetPermission: false, classFilter: classFilter || null };
  writeFileSync(resolve(directory, classFilter ? `validation-api${api}-partial.json` : `validation-api${api}.json`), JSON.stringify(validation, null, 2));
  if (!classFilter) writeFileSync(resolve(directory, "validation.json"), JSON.stringify(validation, null, 2));
}

if (isMain(import.meta.url)) {
  try { test(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
