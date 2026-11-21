import { APP_VERSION } from "../../shared/version";
import type { ProjectIndex, ProjectIndexTrack } from "../../server/projectStore";
import { DEVICE_ONLY } from "./runtime";

export interface BackendHealth {
  ok: boolean; version: string; mode: string; renderAvailable: boolean;
  syncAvailable: boolean; coverGenerationAvailable: boolean;
}

export function normalizeBackendUrl(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:"
    && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Use an HTTPS backend URL, or HTTP localhost for development.");
  return url.href.replace(/\/+$/, "");
}

export class ApiClient {
  private static baseUrl = !DEVICE_ONLY && import.meta.env?.VITE_BACKEND_URL ? normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL) : "";
  private static accessToken = "";
  static setBaseUrl(url: string) {
    if (DEVICE_ONLY) return;
    const next = normalizeBackendUrl(url || import.meta.env?.VITE_BACKEND_URL || "");
    if (next === this.baseUrl) return;
    this.baseUrl = next;
    this.accessToken = "";
    if (typeof window !== "undefined") window.dispatchEvent(new Event("audio-studio:backend-changed"));
  }
  static setAccessToken(token: string) {
    if (DEVICE_ONLY) return;
    this.accessToken = token.trim();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("audio-studio:backend-changed"));
  }
  static hasAccessToken(): boolean { return Boolean(this.accessToken); }
  static isConfigured(): boolean { return !DEVICE_ONLY && Boolean(this.baseUrl || import.meta.env?.DEV); }

  private static async request<T>(route: string, read: (response: Response) => Promise<T>, init: RequestInit = {}, timeout = 10_000): Promise<T> {
    if (!this.isConfigured()) throw new Error("Configure the optional backend URL in Settings first.");
    const headers = new Headers(init.headers);
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort(); else init.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("The backend request timed out.", "TimeoutError")), timeout);
    try {
      const response = await fetch(this.baseUrl + route, { ...init, headers, signal: controller.signal, credentials: "omit" });
      if (!response.ok) {
        let message = `Backend request failed (${response.status}).`;
        if (response.headers.get("content-type")?.includes("application/json")) {
          const data: unknown = await response.json();
          if (data && typeof data === "object" && "error" in data && typeof data.error === "string") message = data.error;
        }
        throw new Error(message);
      }
      return await read(response);
    } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
  }

  static async getHealth(): Promise<BackendHealth> {
    const local: BackendHealth = { ok: false, version: APP_VERSION, mode: "local-only", renderAvailable: false, syncAvailable: false, coverGenerationAvailable: false };
    if (!this.isConfigured()) return local;
    try {
      const data = await this.request<Record<string, unknown> | null>("/health", async (response) =>
        response.headers.get("content-type")?.includes("application/json") ? response.json() : null, {}, 4000);
      if (!data) return local;
      if (data.ok !== true || typeof data.version !== "string" || typeof data.mode !== "string") return local;
      return { ok: true, version: data.version, mode: data.mode, renderAvailable: true, syncAvailable: data.syncAvailable === true,
        coverGenerationAvailable: data.coverGenerationAvailable === true };
    } catch { return local; }
  }

  static async generateCoverArt(prompt: string, style = "cinematic", mood = "vibrant", signal?: AbortSignal): Promise<Blob> {
    const blob = await this.request("/api/generate-cover", (response) => response.blob(), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, style, mood }), signal }, 65_000);
    if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type) || !blob.size || blob.size > 8 * 1024 * 1024) throw new Error("The provider did not return usable artwork.");
    return blob;
  }

  static async syncProjects(tracks: ProjectIndexTrack[]): Promise<{ syncedAt: string; trackCount: number }> {
    const data = await this.request<{ success?: boolean; syncedAt: string; trackCount: number }>("/api/cloud/sync", (response) => response.json(),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, tracks }) });
    if (!data.success || typeof data.syncedAt !== "string") throw new Error("The backend did not confirm a saved index.");
    return data;
  }

  static async getProjectIndex(): Promise<ProjectIndex> {
    const data = await this.request<ProjectIndex>("/api/cloud/projects", (response) => response.json());
    if (data.version !== 1 || !Array.isArray(data.tracks)) throw new Error("The backend returned an invalid library index.");
    return data;
  }
}
