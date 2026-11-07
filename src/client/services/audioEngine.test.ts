import { describe, expect, it } from "vitest";
import { AudioEngine } from "./audioEngine";
import JSZip from "jszip";

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
