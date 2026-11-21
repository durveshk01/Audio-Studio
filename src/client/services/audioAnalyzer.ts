import { decodeLocalAudio } from "./audioEngine";
import type { AudioAnalysisMetrics } from "./analysisMath";

export type { AudioAnalysisMetrics } from "./analysisMath";

export class AudioAnalyzer {
  static async analyze(file: File | Blob, onStatus?: (status: string) => void, signal?: AbortSignal): Promise<AudioAnalysisMetrics> {
    onStatus?.("Decoding selected audio locally…");
    const decoded = await decodeLocalAudio(file, signal);
    if (signal?.aborted) throw new DOMException("Analysis cancelled.", "AbortError");
    const worker = new Worker(new URL("./audioAnalysis.worker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      const clean = () => { worker.terminate(); signal?.removeEventListener("abort", abort); };
      const abort = () => { clean(); reject(new DOMException("Analysis cancelled.", "AbortError")); };
      signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = () => { clean(); reject(new Error("The local analysis worker failed.")); };
      worker.onmessage = ({ data }: MessageEvent<{ metrics?: AudioAnalysisMetrics; status?: string; error?: string }>) => {
        if (data.metrics) { clean(); resolve(data.metrics); }
        else if (data.error) { clean(); reject(new Error(data.error)); }
        else if (data.status) onStatus?.(data.status);
      };
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c).slice().buffer);
      worker.postMessage({ channels, sampleRate: decoded.sampleRate, fileSize: file.size }, channels);
    });
  }
}
