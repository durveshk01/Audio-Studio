import { test as base } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../src/server/app";

export const test = base.extend<object, { studioUrl: string }>({
  studioUrl: [async ({}, use) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-studio-e2e-"));
    const coordinator = await createApp({ tempRoot: root, enableMetaTune: false, apiTokens: {}, syncStorageDir: "" });
    const server = coordinator.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try { await use(`http://127.0.0.1:${(server.address() as { port: number }).port}`); }
    finally {
      coordinator.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  }, { scope: "worker" }],
  baseURL: async ({ studioUrl }, use) => { await use(studioUrl); }
});

export { expect } from "@playwright/test";
