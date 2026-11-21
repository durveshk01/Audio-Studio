import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { LibraryStorage, type LibraryTrack } from "./libraryStorage";

describe("transactional device library", () => {
  const track: LibraryTrack = { id: "persistent-track", title: "Saved Audio", artist: "Artist", album: "Album", durationSec: 1,
    fileSize: 3, format: "wav", favorite: false, dateAdded: "2026-11-09T00:00:00.000Z", blob: new Blob(["pcm"]), isProcessed: false };

  it("commits track bytes before resolving and atomically toggles favorites", async () => {
    await LibraryStorage.saveTrack(track);
    const stored = await LibraryStorage.getTrack(track.id);
    expect(await stored?.blob?.text()).toBe("pcm");
    const toggles = await Promise.all([LibraryStorage.toggleFavorite(track.id), LibraryStorage.toggleFavorite(track.id)]);
    expect(toggles).toEqual([true, false]);
    expect((await LibraryStorage.getTrack(track.id))?.favorite).toBe(false);
    await LibraryStorage.deleteTrack(track.id);
    expect(await LibraryStorage.getTrack(track.id)).toBeNull();
  });

  it("preserves simultaneous changes to different preferences", async () => {
    await Promise.all([LibraryStorage.saveSettings({ theme: "light" }), LibraryStorage.saveSettings({ defaultBitrate: 128 }),
      LibraryStorage.saveSettings({ reducedMotion: true })]);
    expect(await LibraryStorage.getSettings()).toMatchObject({ theme: "light", defaultBitrate: 128, reducedMotion: true });
  });

  it("surfaces failed writes rather than announcing success", async () => {
    await expect(LibraryStorage.saveTrack({ ...track, blob: undefined })).rejects.toThrow("audio bytes");
    await expect(LibraryStorage.saveTrack({ ...track, uncloneable: () => {} } as LibraryTrack)).rejects.toThrow();
    expect(await LibraryStorage.getTrack(track.id)).toBeNull();
  });
});
