import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const ANDROID = resolve(ROOT, "android");
const executable = (name) => process.platform === "win32" ? `${name}.exe` : name;

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...options.env },
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout || 20 * 60 * 1000
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).${options.capture ? `\n${output}` : ""}`);
  return output;
}

export function sdkDirectory() {
  for (const path of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (path && existsSync(path)) return resolve(path);
  }
  const properties = resolve(ANDROID, "local.properties");
  if (existsSync(properties)) {
    const value = readFileSync(properties, "utf8").match(/^sdk\.dir=(.+)$/m)?.[1].trim().replace(/\\(.)/g, "$1");
    if (value && existsSync(value)) return resolve(value);
  }
  throw new Error("Set ANDROID_HOME to your Android SDK, or configure android/local.properties.");
}

export function javaTool(name) {
  const path = process.env.JAVA_HOME && resolve(process.env.JAVA_HOME, "bin", executable(name));
  return path && existsSync(path) ? path : executable(name);
}

export function buildToolsDirectory() {
  const directory = resolve(sdkDirectory(), "build-tools");
  const versions = readdirSync(directory).filter((version) => /^\d+\.\d+\.\d+$/.test(version));
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!versions.length) throw new Error("Install Android SDK build-tools (36.0.0 or later).");
  return resolve(directory, versions[0]);
}

export function apksigner(args, options) {
  return run(javaTool("java"), ["-jar", resolve(buildToolsDirectory(), "lib/apksigner.jar"), ...args], options);
}

export function androidTool(name, args, options) {
  const directory = name === "adb" ? resolve(sdkDirectory(), "platform-tools") : buildToolsDirectory();
  return run(resolve(directory, executable(name)), args, options);
}

export function gradle(tasks) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Android builds require Node.js 22.12+.");
  const version = run(javaTool("java"), ["-version"], { capture: true });
  if (Number(version.match(/version "(\d+)/)?.[1] || 0) < 21) throw new Error("Capacitor 8 requires JDK 21 or later. Set JAVA_HOME accordingly.");
  return run(javaTool("java"), [
    "-classpath", resolve(ANDROID, "gradle/wrapper/gradle-wrapper.jar"),
    "org.gradle.wrapper.GradleWrapperMain", "--no-daemon", "--console=plain", "--stacktrace", ...tasks
  ], { cwd: ANDROID, env: { ANDROID_HOME: sdkDirectory() } });
}

export function isMain(url) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
}

export function ensureParent(path) {
  if (!existsSync(dirname(path))) throw new Error(`The parent directory does not exist: ${dirname(path)}`);
}
