import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "dist/client");
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}
const assets = files(directory).filter((path) => !path.endsWith(".map") && !path.endsWith(`${sep}sw.js`));
const fingerprint = createHash("sha256");
for (const path of assets.sort()) fingerprint.update(relative(directory, path)).update(readFileSync(path));
const cache = `audio-studio-shell-${fingerprint.digest("hex").slice(0, 16)}`;
const urls = assets.map((path) => `/${relative(directory, path).split(sep).join("/")}`);
writeFileSync(resolve(directory, "sw.js"), `/* Generated from the complete local app bundle. */
const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(urls)};
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("audio-studio-shell-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/health") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match("/index.html"))));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request)));
  }
});
`);
console.log(`Offline app shell: ${urls.length} bundled assets (${cache}).`);
