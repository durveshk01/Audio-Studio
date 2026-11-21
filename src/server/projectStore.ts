import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface ProjectIndexTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  fileSize: number;
  format: string;
  favorite: boolean;
  dateAdded: string;
}

export interface ProjectIndex {
  version: 1;
  tracks: ProjectIndexTrack[];
  trackCount: number;
  syncedAt: string;
}

export function validateProjectIndex(value: unknown): ProjectIndexTrack[] {
  if (!value || typeof value !== "object" || !("tracks" in value) || !Array.isArray(value.tracks)
    || value.tracks.length > 2000) throw new Error("Supply a library index with at most 2,000 tracks.");
  const ids = new Set<string>();
  return value.tracks.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid library track.");
    const t = item as Record<string, unknown>;
    const text = (key: string, max = 500) => {
      if (typeof t[key] !== "string" || (t[key] as string).length > max) throw new Error(`Invalid ${key}.`);
      return t[key] as string;
    };
    const number = (key: string) => {
      if (typeof t[key] !== "number" || !Number.isFinite(t[key]) || (t[key] as number) < 0) throw new Error(`Invalid ${key}.`);
      return t[key] as number;
    };
    const id = text("id", 200);
    if (!id || ids.has(id)) throw new Error("Library track IDs must be unique and nonempty.");
    ids.add(id);
    const dateAdded = text("dateAdded", 40);
    if (!Number.isFinite(Date.parse(dateAdded)) || typeof t.favorite !== "boolean") throw new Error("Invalid library track date or favorite flag.");
    return { id, title: text("title"), artist: text("artist"), album: text("album"), durationSec: number("durationSec"),
      fileSize: number("fileSize"), format: text("format", 20), favorite: t.favorite, dateAdded };
  });
}

/** Durable, atomically replaced metadata indexes. Audio and credentials are never stored here. */
export class ProjectStore {
  private pending = new Map<string, Promise<void>>();
  constructor(private root: string) {}

  private file(owner: string) {
    return path.join(this.root, `${createHash("sha256").update(owner).digest("hex")}.json`);
  }

  async save(owner: string, tracks: ProjectIndexTrack[]): Promise<ProjectIndex> {
    const previous = this.pending.get(owner) || Promise.resolve();
    const index: ProjectIndex = { version: 1, tracks, trackCount: tracks.length, syncedAt: new Date().toISOString() };
    const write = previous.catch(() => {}).then(async () => {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      const destination = this.file(owner);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(index), { mode: 0o600, flag: "wx" });
        await fs.rename(temporary, destination);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
    this.pending.set(owner, write);
    try { await write; } finally { if (this.pending.get(owner) === write) this.pending.delete(owner); }
    return index;
  }

  async load(owner: string): Promise<ProjectIndex> {
    await this.pending.get(owner);
    try {
      const contents: unknown = JSON.parse(await fs.readFile(this.file(owner), "utf8"));
      const tracks = validateProjectIndex(contents);
      return { version: 1, tracks, trackCount: tracks.length, syncedAt: (contents as ProjectIndex).syncedAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, tracks: [], trackCount: 0, syncedAt: "" };
    }
  }
}
