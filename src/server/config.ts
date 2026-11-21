import "dotenv/config";
import path from "node:path";
import os from "node:os";

const toInt = (value: string | undefined, fallback: number, min = 1, max = 65535) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

function apiTokens(): Record<string, string> {
  if (!process.env.API_TOKENS) return {};
  try {
    const value: unknown = JSON.parse(process.env.API_TOKENS);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const entries = Object.entries(value);
    if (!entries.length || entries.some(([id, token]) => !/^[\w-]{1,80}$/.test(id)
      || typeof token !== "string" || token.length < 32 || token.length > 256 || /\s/.test(token))) throw new Error();
    if (new Set(entries.map(([, token]) => token)).size !== entries.length) throw new Error();
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    throw new Error("API_TOKENS must map unique owner IDs to unique tokens of at least 32 characters.");
  }
}

export const config = {
  port: toInt(process.env.PORT, 10000),
  metaTunePort: toInt(process.env.METATUNE_PORT, 10001),
  maxUploadFiles: toInt(process.env.MAX_UPLOAD_FILES, 20, 1, 100),
  maxFileMb: toInt(process.env.MAX_FILE_MB, 100, 1, 600),
  maxRequestMb: toInt(process.env.MAX_REQUEST_MB, 200, 1, 1000),
  maxConcurrentJobs: toInt(process.env.MAX_CONCURRENT_JOBS, 2, 1, 4),
  maxQueuedJobs: toInt(process.env.MAX_QUEUED_JOBS, 4, 1, 20),
  ffmpegThreads: toInt(process.env.FFMPEG_THREADS, 2, 1, 4),
  jobTtlMinutes: toInt(process.env.JOB_TTL_MINUTES, 60),
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  tempRoot: process.env.TEMP_ROOT || path.join(os.tmpdir(), "audiocompress"),
  enableMetaTune: process.env.ENABLE_METATUNE === "true",
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,https://localhost,capacitor://localhost").split(",").map((s) => s.trim()).filter(Boolean),
  apiTokens: apiTokens(),
  syncStorageDir: process.env.SYNC_STORAGE_DIR || "",
  pollinationsApiKey: process.env.POLLINATIONS_API_KEY || "",
  imageHosts: ["image.pollinations.ai", "gen.pollinations.ai"]
};

export type ServerConfig = typeof config;
