import { expect, test } from "./fixtures";

test("all workspace deep links render and fit the viewport", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of ["home", "compressor", "metatune", "tools", "library", "settings"]) {
    await page.goto(`/${route}`);
    await expect(page.locator("#main-content")).not.toBeEmpty();
    await expect(page.getByText("Loading workspace…", { exact: true })).toHaveCount(0);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("compression queue survives navigation and supports removal", async ({ page }) => {
  await page.goto("/compressor");
  await page.getByLabel("Audio files for compression").setInputFiles({ name: "sample.wav", mimeType: "audio/wav", buffer: Buffer.from("audio") });
  await expect(page.getByRole("heading", { name: "Audio Queue (1)" })).toBeVisible();
  await page.evaluate(() => { window.location.hash = "/settings"; });
  await expect(page).toHaveURL(/#\/settings$/);
  await page.goBack();
  // Same-document history preserves the mounted compressor workspace.
  await expect(page.getByRole("heading", { name: "Audio Queue (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Remove sample.wav from queue" }).click();
  await expect(page.getByRole("heading", { name: "Drop Audio Files Here" })).toBeVisible();
});
