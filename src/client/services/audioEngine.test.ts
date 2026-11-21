import { describe, expect, it } from "vitest";
import { AudioEngine, safeFileName } from "./audioEngine";
import JSZip from "jszip";
import fs from "node:fs/promises";

describe("AudioEngine unit tests", () => {
  it("reports engine info with valid supported formats", async () => {
    const info = await AudioEngine.getEngineInfo();
    expect(info).toBeDefined();
    expect(info.supportedFormats).toContain("MP3");
    expect(info.supportedFormats).toContain("M4A");
    expect(info.supportedFormats).toContain("WAV");
    expect(info.isNativeDevicePowered).toBe(true);
  });

  it("creates a ZIP archive on device locally without server", async () => {
    const mockFiles = [
      { name: "track1.wav", blob: new Blob(["audio-bytes-1"], { type: "audio/wav" }) },
      { name: "track2.wav", blob: new Blob(["audio-bytes-2"], { type: "audio/wav" }) }
    ];

    const zipBlob = await AudioEngine.createZip(mockFiles);
    expect(zipBlob).toBeInstanceOf(Blob);
    expect(zipBlob.size).toBeGreaterThan(0);

    // Verify zip content with JSZip
    const loaded = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(loaded.file("track1.wav")).toBeDefined();
    expect(loaded.file("track2.wav")).toBeDefined();
    const content1 = await loaded.file("track1.wav")?.async("string");
    expect(content1).toBe("audio-bytes-1");
  });

  it("keeps colliding ZIP names distinct and preserves every audio payload", async () => {
    const files = ["track.mp3", "TRACK.mp3", "track (1).mp3"].map((name, i) => ({ name, blob: new Blob([`audio-${i}`]) }));
    const archive = await JSZip.loadAsync(await (await AudioEngine.createZip(files)).arrayBuffer());
    const contents = await Promise.all(Object.values(archive.files).map((file) => file.async("string")));
    expect(contents.sort()).toEqual(["audio-0", "audio-1", "audio-2"]);
  });

  it("keeps Unicode filenames within native filesystem byte limits", () => {
    const name = safeFileName("🎵 संगीत ".repeat(50));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(180);
    expect(name).not.toContain("\uFFFD");
    expect(safeFileName("../unsafe\\name.mp3")).not.toMatch(/[\\/]/);
    const exported = safeFileName("🎵 संगीत ".repeat(50) + ".mp3");
    expect(new TextEncoder().encode(exported).length).toBeLessThanOrEqual(180);
    expect(exported.endsWith(".mp3")).toBe(true);
  });

  it("rejects oversized native archives before reading their bytes", async () => {
    await expect(AudioEngine.createZip([{ name: "large.m4a", nativePath: "/native/large.m4a", outputSize: 201 * 1024 * 1024 }])).rejects.toThrow("ZIP exports are limited");
  });

  it("checks actual blob bytes even when the reported output size is smaller", async () => {
    await expect(AudioEngine.getProcessedBlob({ blob: new Blob(["12345678"]), outputSize: 1 }, 4)).rejects.toThrow("In-memory exports");
  });

  it("writes a release date supplied without a separate year", async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])], { type: "audio/mpeg" });
    const tagged = await AudioEngine.writeMp3Metadata(blob, { date: "2026" });
    const { default: MP3Tag } = await import("mp3tag.js");
    const reader = new MP3Tag(await tagged.arrayBuffer());
    reader.read();
    expect(reader.tags.year).toBe("2026");
  });

  it("retags the real sample MP3 containing a v2.4 date frame inside a v2.3 tag", async () => {
    const input = new Blob([await fs.readFile(new URL("../../../metatune/test.mp3", import.meta.url))], { type: "audio/mpeg" });
    const original = await AudioEngine.readMetadata(input);
    const output = await AudioEngine.writeMp3Metadata(input, { title: "Retagged sample" });
    const actual = await AudioEngine.readMetadata(output);
    expect(actual).toMatchObject({ title: "Retagged sample", artist: original.artist, year: original.year });
    expect(actual.durationSec).toBeCloseTo(original.durationSec!, 2);
  });

  it("preserves a full ISO date when editing older MP3 tags", async () => {
    const input = new Blob([await fs.readFile(new URL("../../../metatune/test.mp3", import.meta.url))], { type: "audio/mpeg" });
    const output = await AudioEngine.writeMp3Metadata(input, { year: "2026-11-21" });
    const actual = await AudioEngine.readMetadata(output);
    expect(actual.year).toBe("2026-11-21");
    expect(actual.date).toBe("2026-11-21");
  });

  it("round trips a month-only date and removes its stored alias when clearing the date", async () => {
    const input = new Blob([await fs.readFile(new URL("../../../metatune/test.mp3", import.meta.url))], { type: "audio/mpeg" });
    const output = await AudioEngine.writeMp3Metadata(input, { year: "2026-11" });
    expect((await AudioEngine.readMetadata(output)).date).toBe("2026-11");
    const { default: MP3Tag } = await import("mp3tag.js");
    const reader = new MP3Tag(await output.arrayBuffer());
    reader.read();
    expect(reader.tags.v2?.TXXX).toContainEqual({ description: "DATE", text: "2026-11" });
    const cleared = await AudioEngine.writeMp3Metadata(output, { year: "" });
    const after = new MP3Tag(await cleared.arrayBuffer());
    after.read();
    expect(after.tags.v2?.TXXX?.some((frame) => frame.description === "DATE")).not.toBe(true);
  });

  it("handles writeMp3Metadata tags correctly", async () => {
    // Generate a minimal valid dummy MP3 buffer
    const dummyMp3 = new Uint8Array([
      0xff, 0xfb, 0x90, 0x64, // MPEG-1 Layer 3 sync word + header
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00
    ]);
    const blob = new Blob([dummyMp3], { type: "audio/mpeg" });

    const metadata = {
      title: "Device Audio Studio Test",
      artist: "Native Mobile Engine",
      album: "Local Processing",
      genre: "Electronic",
      year: "2026"
    };

    const taggedBlob = await AudioEngine.writeMp3Metadata(blob, metadata);
    expect(taggedBlob).toBeInstanceOf(Blob);
    expect(taggedBlob.size).toBeGreaterThan(blob.size);

    // Check ID3 header (first 3 bytes must be "ID3")
    const buffer = await taggedBlob.arrayBuffer();
    const header = new Uint8Array(buffer, 0, 3);
    const id3Header = String.fromCharCode(...header);
    expect(id3Header).toBe("ID3");
  });
});
