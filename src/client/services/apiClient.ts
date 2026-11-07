export interface BackendHealth {
  ok: boolean;
  version: string;
  mode: string;
  renderAvailable: boolean;
}

export class ApiClient {
  private static baseUrl = "";

  public static setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, "");
  }

  public static async getHealth(): Promise<BackendHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const data = await response.json();
        return {
          ok: true,
          version: data.version || "2.0.0",
          mode: data.mode || "lightweight-coordinator",
          renderAvailable: true
        };
      }
    } catch {
      // Backend not running or offline
    }

    return {
      ok: true,
      version: "2.0.0 (Local)",
      mode: "device-standalone",
      renderAvailable: false
    };
  }

  public static async generateCoverArt(
    prompt: string,
    style = "cinematic",
    mood = "vibrant"
  ): Promise<string> {
    const fullPrompt = `${prompt}, ${style} style, ${mood} mood, high resolution album artwork, 4k digital art, clean masterpiece`;
    const encoded = encodeURIComponent(fullPrompt);

    // Try backend proxy if available
    try {
      const res = await fetch(`${this.baseUrl}/api/generate-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt, style, mood }),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.imageUrl) return data.imageUrl;
      }
    } catch {
      // Direct client fallback
    }

    // Direct Pollinations API fallback for instant client-side generation
    const seed = Math.floor(Math.random() * 100000);
    return `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&seed=${seed}&nologo=true`;
  }

  public static async fetchImageBlob(imageUrl: string): Promise<Blob> {
    // If it's a data url
    if (imageUrl.startsWith("data:")) {
      const res = await fetch(imageUrl);
      return await res.blob();
    }

    // Attempt direct fetch
    try {
      const res = await fetch(imageUrl);
      if (res.ok) return await res.blob();
    } catch {
      // Attempt backend proxy
    }

    const proxyUrl = `${this.baseUrl}/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    const proxyRes = await fetch(proxyUrl);
    if (!proxyRes.ok) throw new Error("Could not download artwork image.");
    return await proxyRes.blob();
  }

  public static async syncProjects(data: any): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/cloud/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
