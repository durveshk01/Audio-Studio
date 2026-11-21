import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { AudioOutputFormat } from "./audioEncoding";
import { validateMetadata } from "./metadataValidation";

export const MAX_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_EXPORT_BYTES = 200 * 1024 * 1024;

export interface EngineInfo {
  platform: "android" | "web";
  isNativeDevicePowered: boolean;
  engineName: string;
  hardwareAcceleration: boolean;
  cpuAbi?: string;
  availableCores?: number;
  memoryMb?: number;
  supportedFormats: string[];
  outputFormats: AudioOutputFormat[];
}

export interface CompressionOptions {
  targetBitrateKbps: number;
  targetSampleRate?: number;
  targetChannels?: number;
  trimStartSec?: number;
  trimEndSec?: number;
  outputFormat?: AudioOutputFormat;
  outputName?: string;
  signal?: AbortSignal;
}

export interface ProgressCallback {
  (progress: { percent: number; stage: string; bytesProcessed?: number }): void;
}

export interface ProcessedAudioResult {
  blob?: Blob;
  nativePath?: string;
  contentUri?: string;
  fileName: string;
  outputSize: number;
  originalSize: number;
  durationSec: number;
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
  savedPercent: number;
  format: string;
  metadata?: AudioMetadata;
}

export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: string;
  date?: string;
  trackNumber?: string;
  composer?: string;
  durationSec?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  hasCoverArt?: boolean;
  coverArtBase64?: string;
  lyrics?: string;
}

interface NativeResult {
  outputPath: string; fileName: string; outputSize: number; originalSize: number;
  durationSec: number; outputBitrateKbps: number; outputSampleRate: number; outputChannels: number;
  contentUri?: string;
}

interface NativeAudioEnginePlugin {
  getEngineInfo(): Promise<{ abi: string; availableCores: number; freeMemoryMb: number; aacAvailable: boolean; hardwareAcceleration: boolean }>;
  processAudio(options: { path: string; targetBitrateKbps: number; targetSampleRate: number; targetChannels: number;
    trimStartSeconds?: number; trimEndSeconds?: number; outputName: string }): Promise<NativeResult>;
  importFileChunk(options: { fileName: string; sessionId?: string; base64: string; complete: boolean }): Promise<{ sessionId: string; path: string }>;
  removeTemporaryFile(options: { path: string }): Promise<void>;
  deleteNativeExport(options: { path: string }): Promise<void>;
  cancelProcessing(): Promise<void>;
  saveToDownloads(options: { path: string; displayName: string }): Promise<{ uri: string }>;
  shareFile(options: { path: string; title: string }): Promise<void>;
  clearTemporaryCache(): Promise<{ bytesRemoved: number }>;
  addListener(eventName: "transcodeProgress", listener: (event: { percent: number; stage: string; bytesProcessed: number }) => void): Promise<PluginListenerHandle>;
}

const NativePlugin = Capacitor.isNativePlatform() ? registerPlugin<NativeAudioEnginePlugin>("NativeAudioEngine") : null;
let processing = false;

export function safeFileName(value: string): string {
  const clean = value.replace(/[\x00-\x1f/\\:*?"<>|]/g, "_").replace(/[. ]+$/, "").trim();
  const encoder = new TextEncoder();
  const extension = clean.match(/\.[a-z0-9]{1,10}$/i)?.[0] || "";
  const base = extension ? clean.slice(0, -extension.length) : clean;
  const limit = 180 - encoder.encode(extension).length;
  let name = "", bytes = 0;
  for (const character of base || "AudioTrack") {
    bytes += encoder.encode(character).length;
    if (bytes > limit) break;
    name += character;
  }
  return name + extension;
}

export function assertAudioInput(file: Blob): void {
  if (!file.size) throw new Error("The selected audio file is empty.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Choose an audio file up to 100 MB.");
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Operation cancelled.", "AbortError");
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(text)}`;
}

export async function decodeLocalAudio(file: Blob, signal?: AbortSignal): Promise<AudioBuffer> {
  assertAudioInput(file); checkAbort(signal);
  if (typeof AudioContext === "undefined") throw new Error("Web Audio is not supported in this browser.");
  const context = new AudioContext();
  try {
    const { parseBlob } = await import("music-metadata");
    const { format } = await parseBlob(file, { duration: true, skipCovers: true });
    // decodeAudioData resamples to the context's rate, not the source file's rate.
    if (!format.duration || !Number.isFinite(format.duration) || !format.numberOfChannels) throw new Error("Could not determine a safe decoded size. Choose a supported audio file, or use Android native M4A conversion.");
    const size = Math.ceil(format.duration * context.sampleRate) * format.numberOfChannels * 4;
    if (size > MAX_DECODED_BYTES) throw new Error("This track needs more than 128 MB of decoded audio. Choose a shorter track or native M4A conversion on Android.");
    checkAbort(signal);
    const bytes = await file.arrayBuffer(); checkAbort(signal);
    const decoded = await context.decodeAudioData(bytes); checkAbort(signal);
    if (decoded.length * decoded.numberOfChannels * 4 > MAX_DECODED_BYTES) throw new Error("Decoded audio exceeds the 128 MB working limit.");
    return decoded;
  } catch (error) {
    if (error instanceof DOMException && error.name === "EncodingError") throw new Error("This browser cannot decode the selected audio. Try a supported file or Android native M4A processing.");
    throw error;
  } finally { await context.close(); }
}

async function encodeInWorker(buffer: AudioBuffer, options: CompressionOptions, onProgress?: ProgressCallback): Promise<Blob> {
  checkAbort(options.signal);
  const worker = new Worker(new URL("./audioEncoding.worker.ts", import.meta.url), { type: "module" });
  const format = options.outputFormat || "mp3";
  return new Promise((resolve, reject) => {
    const clean = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort); };
    const abort = () => { clean(); reject(new DOMException("Operation cancelled.", "AbortError")); };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => { clean(); reject(new Error("The audio worker could not complete encoding.")); };
    worker.onmessage = ({ data }: MessageEvent<{ percent?: number; bytes?: ArrayBuffer; error?: string }>) => {
      if (data.error) { clean(); reject(new Error(data.error)); }
      else if (data.bytes) { clean(); resolve(new Blob([data.bytes], { type: format === "wav" ? "audio/wav" : format === "mp3" ? "audio/mpeg" : "audio/mp4" })); }
      else if (data.percent !== undefined) onProgress?.({ percent: 55 + Math.round(data.percent * 0.4), stage: `Encoding ${format.toUpperCase()} locally…` });
    };
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice().buffer);
    worker.postMessage({ channels, sampleRate: buffer.sampleRate, bitrateKbps: options.targetBitrateKbps, format }, channels);
  });
}

async function stageNativeFile(blob: Blob, fileName: string, signal?: AbortSignal): Promise<string> {
  if (!NativePlugin) throw new Error("Native storage is unavailable.");
  if (blob.size > 200 * 1024 * 1024) throw new Error("Device export exceeds the 200 MB limit. Export fewer tracks at once.");
  let sessionId: string | undefined;
  let path = "";
  try {
    for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
      checkAbort(signal);
      const chunk = blob.slice(offset, offset + 1024 * 1024);
      const base64 = (await blobToDataUrl(chunk)).split(",")[1];
      const result = await NativePlugin.importFileChunk({ fileName: safeFileName(fileName), sessionId, base64, complete: offset + chunk.size >= blob.size });
      sessionId = result.sessionId; path = result.path;
    }
    checkAbort(signal);
    if (!path) throw new Error("No bytes were available to export.");
    return path;
  } catch (error) { if (path) await NativePlugin.removeTemporaryFile({ path }).catch(() => {}); throw error; }
}

export class AudioEngine {
  static isNative(): boolean { return Capacitor.isNativePlatform(); }
  static isProcessing(): boolean { return processing; }

  static async getEngineInfo(): Promise<EngineInfo> {
    if (NativePlugin) {
      const info = await NativePlugin.getEngineInfo();
      return { platform: "android", isNativeDevicePowered: true, engineName: "Android MediaCodec + local MP3/PCM encoders",
        hardwareAcceleration: info.hardwareAcceleration, cpuAbi: info.abi, availableCores: info.availableCores, memoryMb: info.freeMemoryMb,
        supportedFormats: ["MP3", "M4A", "AAC", "WAV", "FLAC", "OGG"], outputFormats: info.aacAvailable ? ["m4a", "mp3", "wav"] : ["mp3", "wav"] };
    }
    const { canEncodeAac } = await import("./audioEncoding");
    return { platform: "web", isNativeDevicePowered: true, engineName: "Web Audio + local worker encoders", hardwareAcceleration: false,
      availableCores: typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency,
      supportedFormats: ["MP3", "M4A", "WAV", "AAC", "OGG", "FLAC"], outputFormats: await canEncodeAac() ? ["mp3", "m4a", "wav"] : ["mp3", "wav"] };
  }

  static async readMetadata(file: File | Blob): Promise<AudioMetadata> {
    assertAudioInput(file);
    const { parseBlob } = await import("music-metadata");
    const { common, format, native } = await parseBlob(file, { duration: true });
    const dateAlias = Object.values(native).flat().find((tag) => tag.id === "TXXX:DATE" || tag.id === "TXX:DATE")?.value;
    const date = typeof dateAlias === "string" && /^\d{4}-\d{2}$/.test(dateAlias) ? dateAlias : common.date;
    const picture = common.picture?.find((p) => /front/i.test(p.type || "")) || common.picture?.[0];
    const coverArtBase64 = picture && picture.data.length <= 8 * 1024 * 1024 && ["image/jpeg", "image/png"].includes(picture.format)
      ? await blobToDataUrl(new Blob([Uint8Array.from(picture.data)], { type: picture.format })) : undefined;
    return { title: common.title, artist: common.artist, album: common.album, albumArtist: common.albumartist, genre: common.genre?.join("; "),
      year: date && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(date) ? date : common.year === undefined ? undefined : String(common.year), date,
      trackNumber: common.track.no === null ? undefined : `${common.track.no}${common.track.of ? `/${common.track.of}` : ""}`,
      composer: common.composer?.join("; "), lyrics: common.lyrics?.map((l) => l.text || "").join("\n"),
      durationSec: format.duration, bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
      sampleRate: format.sampleRate, channels: format.numberOfChannels, hasCoverArt: Boolean(coverArtBase64), coverArtBase64 };
  }

  static async compressAudio(file: File, options: CompressionOptions, onProgress?: ProgressCallback): Promise<ProcessedAudioResult> {
    if (processing) throw new Error("Another audio operation is running. Wait or cancel it first.");
    assertAudioInput(file); checkAbort(options.signal);
    if (!Number.isFinite(options.targetBitrateKbps) || options.targetBitrateKbps < 64 || options.targetBitrateKbps > 320) throw new Error("Select a target bitrate between 64 and 320 kbps.");
    const rate = options.targetSampleRate || 44100;
    const channels = options.targetChannels || 2;
    if (![22050, 32000, 44100, 48000].includes(rate) || ![1, 2].includes(channels)) throw new Error("Select a supported sample rate and mono or stereo output.");
    const format = options.outputFormat || "mp3";
    if (!["mp3", "m4a", "wav"].includes(format)) throw new Error("Unsupported output format.");
    if (format === "mp3" && (![64, 96, 128, 160, 192, 224, 256, 320].includes(options.targetBitrateKbps) || (rate < 32000 && options.targetBitrateKbps > 160))) throw new Error("MP3 above 160 kbps needs a sample rate of at least 32 kHz.");
    const fileName = `${safeFileName((options.outputName || file.name).replace(/\.(mp3|m4a|wav|aac|flac|ogg)$/i, ""))}.${format}`;
    processing = true;
    try {
      onProgress?.({ percent: 2, stage: "Reading local audio…" });
      let metadata: AudioMetadata | undefined;
      try { metadata = await this.readMetadata(file); } catch { /* The decoder validates playable audio independently. */ }
      const hasTags = Boolean(metadata && [metadata.title, metadata.artist, metadata.album, metadata.albumArtist, metadata.genre, metadata.year, metadata.date, metadata.trackNumber, metadata.composer, metadata.lyrics, metadata.coverArtBase64].some(Boolean));
      const artwork = metadata?.coverArtBase64 ? await (await fetch(metadata.coverArtBase64)).blob() : undefined;
      if (NativePlugin && format === "m4a") {
        const inputPath = await stageNativeFile(file, file.name, options.signal);
        let listener: PluginListenerHandle | undefined;
        let outputPath: string | undefined;
        let delivered = false;
        const abort = () => { void NativePlugin.cancelProcessing().catch(() => {}); };
        options.signal?.addEventListener("abort", abort, { once: true });
        try {
          checkAbort(options.signal);
          listener = await NativePlugin.addListener("transcodeProgress", (event) => onProgress?.({ percent: Math.min(99, 5 + Math.round(event.percent * 0.94)), stage: event.stage, bytesProcessed: event.bytesProcessed }));
          checkAbort(options.signal);
          const res = await NativePlugin.processAudio({ path: inputPath, targetBitrateKbps: options.targetBitrateKbps, targetSampleRate: rate,
            targetChannels: channels, trimStartSeconds: options.trimStartSec, trimEndSeconds: options.trimEndSec, outputName: fileName });
          outputPath = res.outputPath;
          checkAbort(options.signal);
          let result: ProcessedAudioResult = { nativePath: res.outputPath, contentUri: res.contentUri, fileName: res.fileName, outputSize: res.outputSize, originalSize: file.size,
            durationSec: res.durationSec, bitrateKbps: res.outputBitrateKbps, sampleRate: res.outputSampleRate, channels: res.outputChannels,
            savedPercent: Math.round((file.size - res.outputSize) / file.size * 100), format, metadata };
          if (hasTags && metadata) {
            try {
              if (res.outputSize > MAX_INPUT_BYTES) throw new Error("Tagged M4A exports are limited to 100 MB. Choose a lower bitrate or a shorter track.");
              const tagged = await this.writeMetadata(new File([await this.getProcessedBlob(result)], fileName, { type: "audio/mp4" }), metadata, artwork);
              result = { ...result, blob: tagged, nativePath: undefined, contentUri: undefined, outputSize: tagged.size,
                bitrateKbps: Math.round(tagged.size * 8 / res.durationSec / 1000), savedPercent: Math.round((file.size - tagged.size) / file.size * 100) };
            } finally { await NativePlugin.deleteNativeExport({ path: res.outputPath }); outputPath = undefined; }
          }
          checkAbort(options.signal);
          onProgress?.({ percent: 100, stage: "M4A encoding complete." });
          delivered = true;
          return result;
        } finally {
          options.signal?.removeEventListener("abort", abort);
          if (!delivered && outputPath) await NativePlugin.deleteNativeExport({ path: outputPath }).catch(() => {});
          try { await listener?.remove(); }
          finally { await NativePlugin.removeTemporaryFile({ path: inputPath }); }
        }
      }

      onProgress?.({ percent: 10, stage: "Decoding audio on this device…" });
      const decoded = await decodeLocalAudio(file, options.signal);
      const start = options.trimStartSec ?? 0;
      const end = options.trimEndSec ?? decoded.duration;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > decoded.duration + 0.01) throw new Error("Choose a trim region inside the track with end after start.");
      const length = Math.round((Math.min(end, decoded.duration) - start) * rate);
      if (length < 1 || length * channels * 4 > MAX_DECODED_BYTES) throw new Error("The rendered audio exceeds the supported working size.");
      checkAbort(options.signal);
      onProgress?.({ percent: 30, stage: "Resampling and mixing channels…" });
      const context = new OfflineAudioContext(channels, length, rate);
      const source = context.createBufferSource(); source.buffer = decoded; source.connect(context.destination);
      source.start(0, start, end - start);
      const rendered = await context.startRendering(); checkAbort(options.signal);
      let blob = await encodeInWorker(rendered, { ...options, outputFormat: format }, onProgress);
      if (hasTags && metadata && format !== "wav") blob = await this.writeMetadata(new File([blob], fileName, { type: blob.type }), metadata, artwork);
      const { parseBlob } = await import("music-metadata");
      const actual = (await parseBlob(blob, { duration: true, skipCovers: true })).format;
      const durationSec = actual.duration || rendered.duration;
      onProgress?.({ percent: 100, stage: `${format.toUpperCase()} encoding complete.` });
      return { blob, fileName, outputSize: blob.size, originalSize: file.size, durationSec,
        bitrateKbps: format === "wav" ? rate * channels * 16 / 1000 : Math.round((actual.bitrate || blob.size * 8 / durationSec) / 1000),
        sampleRate: actual.sampleRate || rate, channels: actual.numberOfChannels || channels,
        savedPercent: Math.round((file.size - blob.size) / file.size * 100), format, metadata };
    } finally { processing = false; }
  }

  static async writeMp3Metadata(input: Blob, metadata: AudioMetadata, artwork?: Blob | null): Promise<Blob> {
    assertAudioInput(input);
    validateMetadata(metadata, artwork);
    const { default: MP3Tag } = await import("mp3tag.js");
    const writer = new MP3Tag(await input.arrayBuffer());
    writer.read({ unsupported: true });
    if (writer.error) throw new Error(`Could not read existing MP3 tags: ${writer.error}`);
    const version = writer.tags.v2Details?.version[0] || 3;
    const frames = writer.tags.v2 ||= {};
    // Some encoders put a v2.4 TDRC frame in a v2.3 tag. The parser reads it as
    // text, but the writer expects raw bytes for frames unsupported by that version.
    // Convert it to the matching standard year/date frames before saving.
    if (version < 4 && typeof frames.TDRC === "string") {
      const date = frames.TDRC.split("\\\\")[0];
      const yearKey = version === 2 ? "TYE" : "TYER";
      const dateKey = version === 2 ? "TDA" : "TDAT";
      if (frames[yearKey] === undefined) frames[yearKey] = date.slice(0, 4);
      if (/^\d{4}-\d{2}-\d{2}/.test(date) && frames[dateKey] === undefined) frames[dateKey] = date.slice(8, 10) + date.slice(5, 7);
      delete frames.TDRC;
    }
    // Migrate ID3v1-only values before replacing the old trailer; clearing a field must not reveal a stale v1 value.
    const legacy = [["TIT2", "TT2", writer.tags.title], ["TPE1", "TP1", writer.tags.artist], ["TALB", "TAL", writer.tags.album],
      ["TCON", "TCO", writer.tags.genre], ["TRCK", "TRK", writer.tags.track]] as const;
    for (const [modern, old, value] of legacy) {
      const key = version === 2 ? old : modern;
      if (frames[key] === undefined && value) frames[key] = value;
    }
    if (writer.tags.comment && !frames.COMM && !frames.COM) Object.assign(frames, { [version === 2 ? "COM" : "COMM"]: [{ language: "eng", descriptor: "", text: writer.tags.comment }] });
    if (writer.tags.year && !frames.TYER && !frames.TDRC && !frames.TYE) Object.assign(frames, { [version === 2 ? "TYE" : version === 4 ? "TDRC" : "TYER"]: writer.tags.year });
    const fields: Array<[keyof AudioMetadata, keyof typeof frames, keyof typeof frames]> = [
      ["title", "TIT2", "TT2"], ["artist", "TPE1", "TP1"], ["album", "TALB", "TAL"], ["albumArtist", "TPE2", "TP2"],
      ["genre", "TCON", "TCO"], ["composer", "TCOM", "TCM"], ["trackNumber", "TRCK", "TRK"]
    ];
    for (const [field, modern, old] of fields) {
      const value = metadata[field];
      if (value === undefined) continue;
      const key = version === 2 ? old : modern;
      if (value === "") delete frames[key]; else Object.assign(frames, { [key]: String(value) });
    }
    const year = metadata.year ?? metadata.date;
    if (year !== undefined) {
      const key = version === 2 ? "TYE" : version === 4 ? "TDRC" : "TYER";
      for (const alias of ["TXXX", "TXX"] as const) {
        if (!frames[alias]) continue;
        frames[alias] = frames[alias].filter((frame) => frame.description !== "DATE");
        if (!frames[alias].length) delete frames[alias];
      }
      delete frames.TYE; delete frames.TYER; delete frames.TDRC; delete frames.TDAT; delete frames.TDA;
      delete frames.TIME; delete frames.TIM;
      if (year) {
        frames[key] = version === 4 ? year : year.slice(0, 4);
        if (version < 4 && year.length === 10) frames[version === 2 ? "TDA" : "TDAT"] = year.slice(8, 10) + year.slice(5, 7);
        // ID3v2.2/2.3 has no month-only date representation.
        if (version < 4 && year.length === 7) {
          const key = version === 2 ? "TXX" : "TXXX";
          frames[key] = [...(frames[key] || []).filter((frame) => frame.description !== "DATE"), { description: "DATE", text: year }];
        }
      }
    }
    if (metadata.lyrics !== undefined) {
      const key = version === 2 ? "ULT" : "USLT";
      if (metadata.lyrics === "") delete frames[key];
      else frames[key] = [{ language: "eng", descriptor: "", text: metadata.lyrics }];
    }
    if (artwork !== undefined) {
      const key = version === 2 ? "PIC" : "APIC";
      if (!artwork) delete frames[key];
      else {
        if (!["image/jpeg", "image/png"].includes(artwork.type) || artwork.size > 8 * 1024 * 1024) throw new Error("Choose JPEG or PNG artwork up to 8 MB.");
        frames[key] = [{ type: 3, format: version === 2 ? artwork.type === "image/png" ? "PNG" : "JPG" : artwork.type,
          description: "Cover", data: Array.from(new Uint8Array(await artwork.arrayBuffer())) }];
      }
    }
    writer.save({ id3v1: { include: false }, id3v2: { version: version === 2 ? 2 : version === 4 ? 4 : 3, padding: 0, unsupported: true, encoding: "utf16" } });
    if (writer.error) throw new Error(`Could not write MP3 tags: ${writer.error}`);
    return new Blob([writer.buffer as ArrayBuffer], { type: "audio/mpeg" });
  }

  static async writeMetadata(file: File, metadata: AudioMetadata, artwork?: Blob | null): Promise<Blob> {
    assertAudioInput(file);
    if (/\.mp3$/i.test(file.name)) return this.writeMp3Metadata(file, metadata, artwork);
    if (/\.m4a$/i.test(file.name)) return (await import("./mp4Metadata")).writeM4aMetadata(file, metadata, artwork);
    throw new Error("Metadata editing supports MP3 and standard M4A files.");
  }

  static nativeFileUrl(path: string): string { return Capacitor.convertFileSrc(path.startsWith("file:") ? path : `file://${path}`); }

  static async getProcessedBlob(file: { blob?: Blob; nativePath?: string; outputSize?: number }, maxBytes = MAX_EXPORT_BYTES): Promise<Blob> {
    const tooLarge = () => new Error("In-memory exports are limited to 200 MB. Export fewer tracks, or save/share native audio directly.");
    if (Math.max(file.outputSize || 0, file.blob?.size || 0) > maxBytes) throw tooLarge();
    if (file.blob) return file.blob;
    if (NativePlugin && file.nativePath) {
      const response = await fetch(this.nativeFileUrl(file.nativePath));
      if (!response.ok) throw new Error("The saved audio file is no longer available on this device.");
      if (Number(response.headers.get("content-length") || 0) > maxBytes) { await response.body?.cancel(); throw tooLarge(); }
      if (!response.body) throw new Error("This WebView cannot safely read the native export. Save or share the audio directly.");
      const reader = response.body.getReader();
      const parts: ArrayBuffer[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); throw tooLarge(); }
          parts.push(value.slice().buffer);
        }
      } finally { reader.releaseLock(); }
      return new Blob(parts, { type: response.headers.get("content-type") || "audio/mp4" });
    }
    throw new Error("No audio bytes are available for this file.");
  }

  static async createZip(files: Array<{ name: string; blob?: Blob; nativePath?: string; outputSize?: number }>): Promise<Blob> {
    if (!files.length) throw new Error("Choose at least one completed file to archive.");
    if (files.reduce((sum, file) => sum + (file.outputSize || file.blob?.size || 0), 0) > MAX_EXPORT_BYTES) throw new Error("ZIP exports are limited to 200 MB. Export fewer tracks at once.");
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const names = new Set<string>();
    let size = 0;
    for (const file of files) {
      const blob = await this.getProcessedBlob(file, MAX_EXPORT_BYTES - size);
      size += blob.size;
      const clean = safeFileName(file.name);
      const dot = clean.lastIndexOf(".");
      const base = dot > 0 ? clean.slice(0, dot) : clean;
      const extension = dot > 0 ? clean.slice(dot) : "";
      let name = clean, count = 1;
      while (names.has(name.toLowerCase())) name = `${base} (${count++})${extension}`;
      names.add(name.toLowerCase());
      zip.file(name, await blob.arrayBuffer());
    }
    return zip.generateAsync({ type: "blob", compression: "STORE" });
  }

  static async saveBlob(blob: Blob, fileName: string): Promise<void> {
    if (NativePlugin) {
      const path = await stageNativeFile(blob, fileName);
      try { await NativePlugin.saveToDownloads({ path, displayName: safeFileName(fileName) }); }
      finally { await NativePlugin.removeTemporaryFile({ path }); }
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = safeFileName(fileName);
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }

  static async saveProcessedFile(result: ProcessedAudioResult, displayName?: string): Promise<void> {
    if (NativePlugin && result.nativePath) await NativePlugin.saveToDownloads({ path: result.nativePath, displayName: safeFileName(displayName || result.fileName) });
    else await this.saveBlob(await this.getProcessedBlob(result), displayName || result.fileName);
  }

  static async shareAudio(result: ProcessedAudioResult, title = "Share Audio"): Promise<void> {
    if (NativePlugin) {
      const path = result.nativePath || await stageNativeFile(await this.getProcessedBlob(result), result.fileName);
      // Shared temporary files remain available until cache maintenance, so receiving apps can read them asynchronously.
      await NativePlugin.shareFile({ path, title }); return;
    }
    const file = new File([await this.getProcessedBlob(result)], result.fileName, { type: result.blob?.type });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, files: [file] }); return;
    }
    await this.saveProcessedFile(result);
  }

  static async clearTemporaryCache(): Promise<number> {
    if (processing) throw new Error("Wait for audio processing to finish before clearing temporary files.");
    let bytes = NativePlugin ? (await NativePlugin.clearTemporaryCache()).bytesRemoved : 0;
    if (typeof caches !== "undefined") for (const name of await caches.keys()) {
      if (!name.startsWith("audio-studio-runtime-")) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) bytes += Number((await cache.match(request))?.headers.get("content-length") || 0);
      await caches.delete(name);
    }
    return bytes;
  }

  static async deleteNativeExport(path: string): Promise<void> {
    if (NativePlugin) await NativePlugin.deleteNativeExport({ path });
  }
}
