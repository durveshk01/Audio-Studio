import { muxAac } from "./mp4";

export type AudioOutputFormat = "mp3" | "m4a" | "wav";
export const MP3_BITRATES = [64, 96, 128, 160, 192, 224, 256, 320];
export const AUDIO_SAMPLE_RATES = [22050, 32000, 44100, 48000];

export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const length = channels[0]?.length || 0;
  if (!length || channels.some((channel) => channel.length !== length)) throw new Error("Cannot encode empty or inconsistent PCM channels.");
  const bytes = new Uint8Array(44 + length * channels.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes.length - 44, true);
  let offset = 44;
  for (let i = 0; i < length; i++) for (const channel of channels) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true); offset += 2;
  }
  return bytes;
}

export async function encodeMp3(channels: Float32Array[], sampleRate: number, bitrateKbps: number, progress?: (percent: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  if (!MP3_BITRATES.includes(bitrateKbps) || (sampleRate < 32000 && bitrateKbps > 160)) throw new Error("MP3 supports the listed standard bitrates; use 32 kHz or higher above 160 kbps.");
  const encoder = new Mp3Encoder(channels.length, sampleRate, bitrateKbps);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const count = channels[0].length;
  for (let start = 0; start < count; start += 1152) {
    const pcm = channels.map((channel) => {
      const output = new Int16Array(Math.min(1152, count - start));
      for (let i = 0; i < output.length; i++) {
        const value = Math.max(-1, Math.min(1, channel[start + i]));
        output[i] = Math.round(value < 0 ? value * 32768 : value * 32767);
      }
      return output;
    });
    const encoded = encoder.encodeBuffer(pcm[0], pcm[1]);
    if (encoded.length) chunks.push(Uint8Array.from(encoded));
    if (start % (1152 * 32) === 0) { progress?.(Math.round(start / count * 98)); await new Promise((resolve) => setTimeout(resolve, 0)); }
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Uint8Array.from(tail));
  const { concat } = await import("./mp4");
  return concat(...chunks);
}

export async function canEncodeAac(sampleRate = 44100, channels = 2, bitrateKbps = 192): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
  try { return Boolean((await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, bitrate: bitrateKbps * 1000 })).supported); }
  catch { return false; }
}

export async function encodeAac(channels: Float32Array[], sampleRate: number, bitrateKbps: number, progress?: (percent: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  if (!await canEncodeAac(sampleRate, channels.length, bitrateKbps)) throw new Error("AAC encoding is not available in this browser. Choose MP3 or WAV, or use Android native M4A.");
  const samples: Uint8Array<ArrayBuffer>[] = [];
  let config = new Uint8Array(0);
  let failure: DOMException | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); samples.push(bytes);
      const description = metadata?.decoderConfig?.description;
      if (description) config = Uint8Array.from(new Uint8Array(ArrayBuffer.isView(description)
        ? description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength) as ArrayBuffer
        : description));
    },
    error: (error) => { failure = error; }
  });
  try {
    encoder.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: channels.length, bitrate: bitrateKbps * 1000 });
    const count = channels[0].length;
    for (let start = 0; start < count; start += 1024) {
      if (failure) throw failure;
      const frames = Math.min(1024, count - start);
      const data = new Float32Array(frames * channels.length);
      channels.forEach((channel, index) => data.set(channel.subarray(start, start + frames), index * frames));
      const audio = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: frames, numberOfChannels: channels.length,
        timestamp: Math.round(start * 1_000_000 / sampleRate), data });
      try { encoder.encode(audio); } finally { audio.close(); }
      if (encoder.encodeQueueSize >= 32) await encoder.flush();
      if (start % (1024 * 32) === 0) progress?.(Math.round(start / count * 98));
    }
    await encoder.flush();
    if (failure) throw failure;
    return muxAac(samples, sampleRate, channels.length, bitrateKbps * 1000, config);
  } finally { if (encoder.state !== "closed") encoder.close(); }
}
