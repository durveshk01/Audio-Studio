import { describe, expect, it } from "vitest";
import { config } from "./config";
import { formatFromFilename, sanitizeFilename } from "./utils";

describe("Server Utilities & Configuration", () => {
  it("verifies server config limits and defaults", () => {
    expect(config.port).toBeGreaterThan(0);
    expect(config.maxUploadFiles).toBeGreaterThan(0);
    expect(config.maxFileMb).toBeGreaterThan(0);
    expect(config.jobTtlMinutes).toBeGreaterThan(0);
  });

  it("sanitizes filenames safely", () => {
    expect(sanitizeFilename("my test track?.mp3")).toBe("my-test-track.mp3");
    expect(sanitizeFilename("../../../secret.m4a")).toBe("secret.m4a");
    expect(sanitizeFilename("normal_song.mp3")).toBe("normal_song.mp3");
  });

  it("extracts valid audio format from filename", () => {
    expect(formatFromFilename("song.mp3")).toBe("mp3");
    expect(formatFromFilename("audio.m4a")).toBe("m4a");
    expect(formatFromFilename("TRACK.MP3")).toBe("mp3");
    expect(formatFromFilename("unsupported.txt")).toBeNull();
    expect(formatFromFilename("video.mp4")).toBeNull();
  });
});
