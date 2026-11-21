import fs from "node:fs/promises";
import { parseBuffer } from "music-metadata";
import { expect, test } from "./fixtures";
import { encodeWav } from "../../src/client/services/audioEncoding";

const tone = Buffer.from(encodeWav([Float32Array.from({ length: 48000 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 880 * i / 48000))], 48000));

test("does not resume a delayed A/B track after leaving its workspace", async ({ page }) => {
  await page.goto("/compressor");
  await page.getByLabel("Audio files for compression").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: tone });
  await page.getByRole("button", { name: "Compress Audio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save tone.mp3", exact: true })).toBeVisible({ timeout: 20_000 });
  const comparison = page.locator(".compare-player-card");
  // Delay metadata availability at the media boundary while keeping the real player and audio.
  await comparison.locator("audio").first().evaluate((audio: HTMLAudioElement) => {
    Object.defineProperty(audio, "readyState", { configurable: true, get: () => 0 });
    Object.defineProperty(audio, "duration", { configurable: true, get: () => NaN });
  });
  await comparison.getByRole("button", { name: "Play comparison", exact: true }).click();
  await expect(comparison.getByRole("button", { name: "Pause comparison", exact: true })).toBeVisible();
  await comparison.getByRole("button", { name: /Original Audio/ }).click();
  await page.evaluate(() => { window.location.hash = "/settings"; });
  await expect(page.getByRole("heading", { name: "Studio Preferences & Diagnostics", exact: true })).toBeVisible();
  const paused = await comparison.locator("audio").first().evaluate(async (audio: HTMLAudioElement) => {
    Reflect.deleteProperty(audio, "duration");
    Reflect.deleteProperty(audio, "readyState");
    audio.dispatchEvent(new Event("loadedmetadata"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return audio.paused;
  });
  expect(paused).toBe(true);
  await expect(comparison.getByRole("button", { name: "Play comparison", exact: true, includeHidden: true })).toHaveCount(1);
});

test("compresses real audio, edits tags and artwork, and saves a persistent favorite", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/compressor");
  await page.getByLabel("Audio files for compression").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: tone });
  await page.getByLabel("Target Bitrate", { exact: true }).selectOption("128");
  await page.getByRole("button", { name: "Compress Audio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save tone.mp3", exact: true })).toBeVisible({ timeout: 20_000 });
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save tone.mp3", exact: true }).click();
  const mp3Download = await saving;
  const mp3 = await fs.readFile((await mp3Download.path())!);
  const source = await parseBuffer(mp3, { mimeType: "audio/mpeg" }, { duration: true });
  expect(source.format.codec).toContain("MPEG");
  expect(source.format.bitrate).toBeCloseTo(128000, -3);
  expect(mp3.length).toBeLessThan(tone.length);

  await page.goto("/metatune");
  await page.getByLabel("Audio file for metadata editing").setInputFiles({ name: "tone.mp3", mimeType: "audio/mpeg", buffer: mp3 });
  await expect(page.getByLabel("Track Title", { exact: true })).toBeEnabled();
  await page.getByLabel("Track Title", { exact: true }).fill("Verified Tone");
  await page.getByLabel("Artist", { exact: true }).fill("Audio Studio QA");
  await page.getByLabel("Year", { exact: true }).fill("2026");
  await page.getByRole("button", { name: "Create Local Cover", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save & Export Audio", exact: true })).toBeEnabled();
  const tagging = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save & Export Audio", exact: true }).click();
  const taggedDownload = await tagging;
  const tagged = await parseBuffer(await fs.readFile((await taggedDownload.path())!), { mimeType: "audio/mpeg" }, { duration: true });
  expect(tagged.common).toMatchObject({ title: "Verified Tone", artist: "Audio Studio QA", year: 2026 });
  expect(tagged.common.picture?.[0].format).toBe("image/png");
  expect(tagged.format.duration).toBeCloseTo(source.format.duration!, 2);

  await page.goto("/library");
  await expect(page.getByRole("button", { name: "Listen to Verified Tone", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Favorite Verified Tone", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unfavorite Verified Tone", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Unfavorite Verified Tone", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("analyzes a known tone and exports the selected WAV region", async ({ page }) => {
  await page.goto("/tools");
  await page.getByLabel("Audio file for analysis").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: tone });
  await expect(page.getByLabel("Start (seconds)", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Start (seconds)", { exact: true }).fill("0.25");
  await page.getByLabel("End (seconds)", { exact: true }).fill("0.75");
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export.*Trim/i }).click();
  const download = await saving;
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  const result = await parseBuffer(await fs.readFile((await download.path())!), { mimeType: "audio/wav" }, { duration: true });
  expect(result.format.duration).toBeCloseTo(0.5, 2);
  expect(result.format.bitsPerSample).toBe(16);
  expect(result.format.codec).toContain("PCM");
});
