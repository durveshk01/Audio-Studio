import { analyzePcm } from "./analysisMath";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = ({ data }: MessageEvent<{ channels: ArrayBuffer[]; sampleRate: number; fileSize: number }>) => {
  try {
    const metrics = analyzePcm(data.channels.map((buffer) => new Float32Array(buffer)), data.sampleRate, data.fileSize,
      (status) => scope.postMessage({ status }));
    scope.postMessage({ metrics });
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : "Audio analysis failed." }); }
};
