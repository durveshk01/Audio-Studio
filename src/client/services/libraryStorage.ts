export interface LibraryTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  fileSize: number;
  format: string;
  bitrateKbps?: number;
  coverArtBase64?: string;
  favorite: boolean;
  dateAdded: string;
  blob?: Blob;
  nativePath?: string;
  isProcessed: boolean;
  originalSize?: number;
  savedPercent?: number;
}

export interface UserSettings {
  theme: "dark" | "light";
  defaultBitrate: number;
  defaultFormat: "m4a" | "mp3" | "wav";
  cloudSyncEnabled: boolean;
  reducedMotion: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: "dark",
  defaultBitrate: 192,
  defaultFormat: "m4a",
  cloudSyncEnabled: false,
  reducedMotion: false
};

const DB_NAME = "AudioStudioDB";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("tracks")) {
        const trackStore = db.createObjectStore("tracks", { keyPath: "id" });
        trackStore.createIndex("title", "title", { unique: false });
        trackStore.createIndex("artist", "artist", { unique: false });
        trackStore.createIndex("album", "album", { unique: false });
        trackStore.createIndex("favorite", "favorite", { unique: false });
        trackStore.createIndex("dateAdded", "dateAdded", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error("Failed to open AudioStudioDB"));
    };
  });

  return dbPromise;
}

export class LibraryStorage {
  public static async getAllTracks(): Promise<LibraryTrack[]> {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("tracks", "readonly");
        const store = tx.objectStore("tracks");
        const request = store.getAll();
        request.onsuccess = () => resolve((request.result || []) as LibraryTrack[]);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return [];
    }
  }

  public static async getTrack(id: string): Promise<LibraryTrack | null> {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("tracks", "readonly");
        const store = tx.objectStore("tracks");
        const request = store.get(id);
        request.onsuccess = () => resolve((request.result as LibraryTrack) || null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  public static async saveTrack(track: LibraryTrack): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("tracks", "readwrite");
      const store = tx.objectStore("tracks");
      const request = store.put(track);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public static async deleteTrack(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("tracks", "readwrite");
      const store = tx.objectStore("tracks");
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public static async toggleFavorite(id: string): Promise<boolean> {
    const track = await this.getTrack(id);
    if (!track) return false;
    track.favorite = !track.favorite;
    await this.saveTrack(track);
    return track.favorite;
  }

  public static async getSettings(): Promise<UserSettings> {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction("settings", "readonly");
        const store = tx.objectStore("settings");
        const request = store.get("user_settings");
        request.onsuccess = () => {
          if (request.result && request.result.value) {
            resolve({ ...DEFAULT_SETTINGS, ...request.result.value });
          } else {
            resolve(DEFAULT_SETTINGS);
          }
        };
        request.onerror = () => resolve(DEFAULT_SETTINGS);
      });
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  public static async saveSettings(settings: Partial<UserSettings>): Promise<void> {
    try {
      const current = await this.getSettings();
      const updated = { ...current, ...settings };
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("settings", "readwrite");
        const store = tx.objectStore("settings");
        const request = store.put({ key: "user_settings", value: updated });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn("Could not save settings:", err);
    }
  }
}
