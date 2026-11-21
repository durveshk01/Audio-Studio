import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeMp3, encodeWav } from "../src/client/services/audioEncoding";

const root = process.cwd();
if (!existsSync(root)) throw new Error("Project directory is unavailable.");
const directory = path.resolve(root, "artifacts/audio-fixtures");
mkdirSync(directory, { recursive: true });
const rate = 48000;
const channel = Float32Array.from({ length: rate * 2 }, (_, i) => 0.35 * Math.sin(2 * Math.PI * 880 * i / rate));
const wav = path.join(directory, "native-tone.wav");
writeFileSync(wav, encodeWav([channel, channel], rate));
writeFileSync(path.join(directory, "native-tone.mp3"), await encodeMp3([channel, channel], rate, 192));
for (const [format, codec, extra] of [
  ["m4a", "aac", ["-b:a", "192k"]], ["aac", "aac", ["-b:a", "192k"]],
  ["flac", "flac", []], ["ogg", "libvorbis", ["-q:a", "4"]]
] as Array<[string, string, string[]]>) {
  const result = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", codec, ...extra, path.join(directory, `native-tone.${format}`)], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status) throw new Error(result.stderr || `Could not create ${format} test fixture.`);
}
console.log("Created real WAV, local-encoder MP3, M4A, AAC, FLAC, and OGG fixtures for Android decoding tests.");
