import { encodeWav, encodeMp3, encodeAac, type AudioOutputFormat } from "./audioEncoding";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<{ channels: ArrayBuffer[]; sampleRate: number; bitrateKbps: number; format: AudioOutputFormat }>) => {
  try {
    const channels = data.channels.map((buffer) => new Float32Array(buffer));
    const progress = (percent: number) => scope.postMessage({ percent });
    const bytes = data.format === "wav" ? encodeWav(channels, data.sampleRate)
      : data.format === "mp3" ? await encodeMp3(channels, data.sampleRate, data.bitrateKbps, progress)
        : await encodeAac(channels, data.sampleRate, data.bitrateKbps, progress);
    scope.postMessage({ bytes: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : "Audio encoding failed." });
  }
};
