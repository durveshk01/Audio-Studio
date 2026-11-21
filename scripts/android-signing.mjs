import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { ROOT, apksigner, isMain, javaTool, run } from "./android-tools.mjs";

const DIRECTORY = resolve(ROOT, ".signing");
const CONFIG = resolve(DIRECTORY, "config.json");
const LEGACY_CERT = "A29ECB9995C3272A93E42DBB47E5A09A0D242BD377C66DAC1FBD8E262BC1654A";

export function loadSigning() {
  if (process.env.ANDROID_KEYSTORE_PATH) {
    const { ANDROID_KEYSTORE_PATH: keystore, ANDROID_KEYSTORE_PASSWORD: password, ANDROID_KEY_ALIAS: alias, ANDROID_KEY_PASSWORD: keyPassword } = process.env;
    if (!password || !alias || !keyPassword) throw new Error("Set all four ANDROID_KEYSTORE_PATH/PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD values.");
    return { keystore: resolve(keystore), password, alias, keyPassword,
      legacyKeystore: process.env.ANDROID_LEGACY_KEYSTORE_PATH, lineage: process.env.ANDROID_SIGNING_LINEAGE_PATH };
  }
  if (!existsSync(CONFIG)) throw new Error("Release signing is not configured. Run npm run android:signing, then back up the ignored .signing directory securely.");
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  if (!config.password || !config.alias || !config.keystore || !config.keyPassword) throw new Error("The private signing configuration is incomplete.");
  for (const key of ["keystore", "legacyKeystore", "lineage"]) if (config[key]) config[key] = resolve(DIRECTORY, config[key]);
  return config;
}

export function signApk(input, output) {
  const config = loadSigning();
  const env = { AUDIO_STUDIO_RELEASE_PASSWORD: config.password, AUDIO_STUDIO_KEY_PASSWORD: config.keyPassword, AUDIO_STUDIO_LEGACY_PASSWORD: "android" };
  const signer = ["--ks", config.keystore, "--ks-pass", "env:AUDIO_STUDIO_RELEASE_PASSWORD", "--key-pass", "env:AUDIO_STUDIO_KEY_PASSWORD", "--ks-key-alias", config.alias];
  const args = ["sign", "--min-sdk-version", "24", "--v1-signing-enabled", "true", "--v2-signing-enabled", "true", "--v3-signing-enabled", "true", "--v4-signing-enabled", "false", "--out", output];
  if (config.legacyKeystore) {
    if (!config.lineage) throw new Error("Signing-key rotation requires the existing certificate lineage.");
    args.push("--ks", config.legacyKeystore, "--ks-pass", "env:AUDIO_STUDIO_LEGACY_PASSWORD", "--ks-key-alias", "androiddebugkey", "--next-signer", ...signer,
      "--lineage", config.lineage, "--rotation-min-sdk-version", "28");
  } else args.push(...signer);
  apksigner([...args, input], { env });
  return apksigner(["verify", "--verbose", "--print-certs", output], { capture: true });
}

function initialize() {
  if (existsSync(CONFIG)) { loadSigning(); console.log("Existing private release signing configuration is ready."); return; }
  if (!existsSync(ROOT)) throw new Error("The project directory is unavailable.");
  mkdirSync(DIRECTORY, { recursive: true });
  const keystore = resolve(DIRECTORY, "release.jks");
  if (existsSync(keystore)) throw new Error("A release key already exists without its configuration. Restore the configuration instead of replacing the key.");
  const password = randomBytes(32).toString("base64url");
  const alias = "audio-studio-release";
  run(javaTool("keytool"), ["-genkeypair", "-keystore", keystore, "-storetype", "JKS", "-storepass:env", "AUDIO_STUDIO_RELEASE_PASSWORD",
    "-keypass:env", "AUDIO_STUDIO_RELEASE_PASSWORD", "-alias", alias, "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
    "-dname", "CN=Audio Studio Release, O=Audio Studio, C=IN"], { env: { AUDIO_STUDIO_RELEASE_PASSWORD: password }, capture: true });
  const config = { keystore: "release.jks", alias, password, keyPassword: password };
  // Persist credentials before optional migration, so an interrupted migration never loses the new key.
  writeFileSync(CONFIG, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
  console.log("Created a private production release key. Back up .signing securely; it is excluded from Git and release assets.");
}

function migrateLegacy() {
  const config = loadSigning();
  if (config.legacyKeystore) { console.log("The v2.0.0 signing lineage is already configured."); return; }
  const legacy = resolve(homedir(), ".android/debug.keystore");
  if (!existsSync(legacy)) throw new Error("The v2.0.0 signing key is not available on this computer.");
  const certificate = run(javaTool("keytool"), ["-list", "-v", "-keystore", legacy, "-storepass:env", "AUDIO_STUDIO_LEGACY_PASSWORD", "-alias", "androiddebugkey"],
    { capture: true, env: { AUDIO_STUDIO_LEGACY_PASSWORD: "android" } });
  if (!certificate.replace(/:/g, "").includes(LEGACY_CERT)) throw new Error("The local debug key does not match the published v2.0.0 APK.");
  const oldKey = resolve(DIRECTORY, "legacy-v2.jks");
  const lineage = resolve(DIRECTORY, "release.lineage");
  copyFileSync(legacy, oldKey);
  apksigner(["rotate", "--out", lineage, "--old-signer", "--ks", oldKey, "--ks-pass", "env:AUDIO_STUDIO_LEGACY_PASSWORD", "--ks-key-alias", "androiddebugkey",
    "--set-installed-data", "true", "--set-rollback", "false", "--new-signer", "--ks", config.keystore, "--ks-pass", "env:AUDIO_STUDIO_RELEASE_PASSWORD", "--key-pass", "env:AUDIO_STUDIO_KEY_PASSWORD", "--ks-key-alias", config.alias],
    { env: { AUDIO_STUDIO_LEGACY_PASSWORD: "android", AUDIO_STUDIO_RELEASE_PASSWORD: config.password, AUDIO_STUDIO_KEY_PASSWORD: config.keyPassword } });
  writeFileSync(CONFIG, JSON.stringify({ ...config, keystore: "release.jks", legacyKeystore: "legacy-v2.jks", lineage: "release.lineage" }, null, 2), { mode: 0o600 });
  console.log("Configured production-key rotation for Android 9+, retaining v2.0.0 update compatibility on Android 7–8.");
}

if (isMain(import.meta.url)) {
  try { initialize(); if (process.argv.includes("--migrate-v2")) migrateLegacy(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
