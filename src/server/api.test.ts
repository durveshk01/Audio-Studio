import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app";
import { ProjectStore } from "./projectStore";
import { fetchApprovedImage, isPublicAddress, validateImageUrl } from "./imageFetch";

describe("coordinator HTTP security and persistence", () => {
  let server: Server;
  let close: () => void;
  let root: string;
  let url: string;
  const alice = "test-alice-token-".padEnd(48, "a");
  const bob = "test-bob-token-".padEnd(48, "b");
  const track = { id: "local-track", title: "Independent Artist", artist: "Artist", album: "Album", durationSec: 2,
    fileSize: 12000, format: "mp3", favorite: true, dateAdded: "2026-11-09T00:00:00.000Z" };
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-studio-api-test-"));
    const clientDir = path.join(root, "client");
    await fs.mkdir(clientDir);
    await fs.writeFile(path.join(clientDir, "index.html"), '<!doctype html><div id="root"></div>');
    const coordinator = await createApp({ tempRoot: path.join(root, "temporary"), syncStorageDir: path.join(root, "indexes"),
      apiTokens: { alice, bob }, enableMetaTune: false, allowedOrigins: ["https://studio.example.test"], clientDir });
    close = coordinator.close;
    server = coordinator.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  it("requires authorization for saved indexes and remote processing", async () => {
    for (const route of ["/api/cloud/projects", "/api/jobs/unknown", "/api/download/unknown/zip"]) {
      const response = await fetch(url + route);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    }
  });

  it("isolates owners and writes an index that survives a store restart", async () => {
    const saved = await fetch(url + "/api/cloud/sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${alice}` },
      body: JSON.stringify({ tracks: [track], untrustedOwnerId: "bob", privateAudioPath: "/private/audio" }) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ success: true, trackCount: 1 });
    const other = await fetch(url + "/api/cloud/projects", { headers: { Authorization: `Bearer ${bob}` } });
    expect(await other.json()).toMatchObject({ tracks: [], trackCount: 0 });
    const restored = await new ProjectStore(path.join(root, "indexes")).load("alice");
    expect(restored.tracks).toEqual([track]);
    expect(JSON.stringify(restored)).not.toContain("privateAudioPath");
    expect(await new ProjectStore(path.join(root, "indexes")).load("bob")).toMatchObject({ tracks: [] });
  });

  it("rejects invalid or duplicate index tracks without replacing saved data", async () => {
    const response = await fetch(url + "/api/cloud/sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${alice}` },
      body: JSON.stringify({ tracks: [track, track] }) });
    expect(response.status).toBe(400);
    expect((await new ProjectStore(path.join(root, "indexes")).load("alice")).trackCount).toBe(1);
  });

  it("blocks unapproved origins and returns actual JSON 404s", async () => {
    expect((await fetch(url + "/health", { headers: { Origin: "https://attacker.example.test" } })).status).toBe(403);
    const allowed = await fetch(url + "/health", { headers: { Origin: "https://studio.example.test" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://studio.example.test");
    expect(allowed.headers.get("content-security-policy")).toContain("object-src 'none'");
    const missing = await fetch(url + "/api/missing");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
  });

  it("serves the MetaTune SPA deep link without requiring the legacy service", async () => {
    const response = await fetch(url + "/metatune");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('id="root"');
    expect((await fetch(url + "/metatune/health")).status).toBe(503);
  });

  it("rejects SSRF URLs before contacting any upstream", async () => {
    for (const upstream of ["http://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "https://example.com/", "https://gen.pollinations.ai@localhost/"]) {
      const response = await fetch(url + `/api/proxy-image?url=${encodeURIComponent(upstream)}`);
      expect(response.status).toBe(400);
    }
  });
});

describe("image provider validation", () => {
  it("rejects private, loopback, reserved and mapped addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.31.0.1", "192.168.1.2", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"]) expect(isPublicAddress(address)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects credentials/ports and private DNS responses even for an approved host", async () => {
    expect(() => validateImageUrl("https://user:secret@gen.pollinations.ai/image", ["gen.pollinations.ai"])).toThrow();
    expect(() => validateImageUrl("https://gen.pollinations.ai:1234/image", ["gen.pollinations.ai"])).toThrow();
    await expect(fetchApprovedImage("https://gen.pollinations.ai/image", ["gen.pollinations.ai"], {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }]
    })).rejects.toThrow("restricted address");
  });
});
