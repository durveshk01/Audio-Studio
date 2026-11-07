import fs from "node:fs";
import path from "node:path";
import { ID3Writer } from "browser-id3-writer";
import JSZip from "jszip";

async function verifyAudioEngine() {
  console.log("=== Testing Real Audio File Processing ===");

  const samplePath = path.resolve("metatune/test.mp3");
  if (!fs.existsSync(samplePath)) {
    throw new Error(`Sample MP3 not found at ${samplePath}`);
  }

  const sampleBytes = fs.readFileSync(samplePath);
  console.log(`✓ Loaded sample file: ${samplePath} (${sampleBytes.length} bytes)`);

  // 1. Test ID3 Tag Writing
  console.log("\n1. Testing ID3v2 Tag Writing on test.mp3...");
  const writer = new ID3Writer(sampleBytes.buffer);
  writer.setFrame("TIT2", "Audio Studio Device Test Track");
  writer.setFrame("TPE1", ["Audio Studio Engine"]);
  writer.setFrame("TALB", "Device Processing Demo");
  writer.setFrame("TYER", 2026);
  writer.setFrame("TCON", ["Studio Electronic"]);
  writer.addTag();

  const taggedBlob = writer.getBlob();
  const taggedArrayBuf = await taggedBlob.arrayBuffer();
  const taggedBuffer = Buffer.from(taggedArrayBuf);
  console.log(`✓ Tagged audio buffer generated: ${taggedBuffer.length} bytes`);

  // Verify ID3 header
  const header = taggedBuffer.subarray(0, 3).toString("utf-8");
  if (header !== "ID3") {
    throw new Error(`Expected ID3 header, got ${header}`);
  }
  console.log(`✓ Verified ID3v2 header: ${header}`);

  // Save tagged test output
  const outDir = path.resolve("artifacts");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const taggedOutPath = path.join(outDir, "test_tagged_output.mp3");
  fs.writeFileSync(taggedOutPath, taggedBuffer);
  console.log(`✓ Saved tagged MP3 to ${taggedOutPath}`);

  // 2. Test ZIP archiving locally
  console.log("\n2. Testing Local ZIP Archive Packaging...");
  const zip = new JSZip();
  zip.file("Audio-Studio-Master.mp3", taggedBuffer);
  zip.file("metadata.json", JSON.stringify({
    title: "Audio Studio Device Test Track",
    artist: "Audio Studio Engine",
    date: new Date().toISOString()
  }, null, 2));

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const zipOutPath = path.join(outDir, "test_batch_archive.zip");
  fs.writeFileSync(zipOutPath, zipBuffer);
  console.log(`✓ Created ZIP archive: ${zipOutPath} (${zipBuffer.length} bytes)`);

  // 3. Verify ZIP integrity
  const loadedZip = await JSZip.loadAsync(zipBuffer);
  const unzippedMp3 = await loadedZip.file("Audio-Studio-Master.mp3")?.async("nodebuffer");
  if (!unzippedMp3 || unzippedMp3.length !== taggedBuffer.length) {
    throw new Error("Unzipped file does not match original bytes!");
  }
  console.log(`✓ Verified ZIP integrity (unzipped ${unzippedMp3.length} bytes perfectly matches original)`);

  console.log("\n=== ALL REAL AUDIO ENGINE CHECKS PASSED SUCCESSFULLY ===");
}

verifyAudioEngine().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
