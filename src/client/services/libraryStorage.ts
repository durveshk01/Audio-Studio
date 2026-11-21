import { Capacitor } from "@capacitor/core";
import { blobToDataUrl } from "./audioEngine";

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
  backendUrl: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "dark", defaultBitrate: 192, defaultFormat: Capacitor.isNativePlatform() ? "m4a" : "mp3", cloudSyncEnabled: false, reducedMotion: false, backendUrl: ""
};

const DB_NAME = "AudioStudioDB";
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function storageError(error: DOMException | null): Error {
  if (error?.name === "QuotaExceededError") return new Error("Device storage is full. Free space and try saving again; your current export is still available.");
  return error || new Error("The local storage transaction failed. Please try again.");
}

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Local storage is unavailable in this browser.")); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("tracks")) {
        const tracks = db.createObjectStore("tracks", { keyPath: "id" });
        for (const key of ["title", "artist", "album", "favorite", "dateAdded"]) tracks.createIndex(key, key, { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(new Error("Another tab is holding local storage open. Close it and try again."));
  }).catch((error: unknown) => { dbPromise = null; throw error; });
  return dbPromise;
}

async function requestTransaction<T>(name: "tracks" | "settings", mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await getDB();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    let result: T;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(storageError(transaction.error));
    transaction.onerror = () => reject(storageError(transaction.error));
    try {
      const request = work(transaction.objectStore(name));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(storageError(request.error));
    } catch (error) { transaction.abort(); reject(error); }
  });
}

function settingsFrom(value: unknown): UserSettings {
  const s = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { ...s,
    theme: s.theme === "light" ? "light" : "dark",
    defaultBitrate: typeof s.defaultBitrate === "number" && [64, 96, 128, 160, 192, 224, 256, 320].includes(s.defaultBitrate) ? s.defaultBitrate : 192,
    defaultFormat: s.defaultFormat === "m4a" || s.defaultFormat === "wav" || s.defaultFormat === "mp3" ? s.defaultFormat : DEFAULT_SETTINGS.defaultFormat,
    cloudSyncEnabled: s.cloudSyncEnabled === true, reducedMotion: s.reducedMotion === true,
    backendUrl: typeof s.backendUrl === "string" ? s.backendUrl : ""
  };
}

export class LibraryStorage {
  static async getAllTracks(): Promise<LibraryTrack[]> {
    return requestTransaction<LibraryTrack[]>("tracks", "readonly", (store) => store.getAll());
  }

  static async getTrack(id: string): Promise<LibraryTrack | null> {
    return (await requestTransaction<LibraryTrack | undefined>("tracks", "readonly", (store) => store.get(id))) || null;
  }

  static async saveTrack(track: LibraryTrack): Promise<void> {
    if (!track.id || (!track.blob && !track.nativePath)) throw new Error("A library track must contain audio bytes or a saved native file.");
    let normalized = track;
    if (track.coverArtBase64?.startsWith("blob:")) {
      const response = await fetch(track.coverArtBase64);
      if (!response.ok) throw new Error("The cover preview is no longer available. Choose the artwork again before saving.");
      normalized = { ...track, coverArtBase64: await blobToDataUrl(await response.blob()) };
    }
    await requestTransaction<IDBValidKey>("tracks", "readwrite", (store) => store.put(normalized));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("audio-studio:library-changed"));
  }

  static async deleteTrack(id: string): Promise<void> {
    await requestTransaction<undefined>("tracks", "readwrite", (store) => store.delete(id));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("audio-studio:library-changed"));
  }

  static async toggleFavorite(id: string): Promise<boolean> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("tracks", "readwrite");
      const store = transaction.objectStore("tracks");
      let favorite = false;
      transaction.oncomplete = () => resolve(favorite);
      transaction.onabort = () => reject(storageError(transaction.error));
      transaction.onerror = () => reject(storageError(transaction.error));
      const request = store.get(id);
      request.onsuccess = () => {
        const track = request.result as LibraryTrack | undefined;
        if (!track) { transaction.abort(); reject(new Error("The library track was not found.")); return; }
        favorite = !track.favorite;
        store.put({ ...track, favorite });
      };
      request.onerror = () => reject(storageError(request.error));
    });
  }

  static async getSettings(): Promise<UserSettings> {
    const record = await requestTransaction<{ value: unknown } | undefined>("settings", "readonly", (store) => store.get("user_settings"));
    return settingsFrom(record?.value);
  }

  static async saveSettings(update: Partial<UserSettings>): Promise<void> {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      let updated: UserSettings;
      transaction.oncomplete = () => {
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("audio-studio:settings-changed", { detail: updated }));
        resolve();
      };
      transaction.onabort = () => reject(storageError(transaction.error));
      transaction.onerror = () => reject(storageError(transaction.error));
      const request = store.get("user_settings");
      request.onsuccess = () => {
        updated = settingsFrom({ ...settingsFrom(request.result?.value), ...update });
        store.put({ key: "user_settings", value: updated });
      };
      request.onerror = () => reject(storageError(request.error));
    });
  }
}
