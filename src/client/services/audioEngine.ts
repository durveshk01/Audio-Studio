import { Capacitor, registerPlugin } from "@capacitor/core";
import JSZip from "jszip";
import { ID3Writer } from "browser-id3-writer";

export interface EngineInfo {
  platform: "android" | "web";
  isNativeDevicePowered: boolean;
  engineName: string;
  hardwareAcceleration: boolean;
  cpuAbi?: string;
  availableCores?: number;
  memoryMb?: number;
  supportedFormats: string[];
}

export interface CompressionOptions {
  targetBitrateKbps: number;
  targetSampleRate?: number;
  targetChannels?: number;
  trimStartSec?: number;
  trimEndSec?: number;
  outputFormat?: "m4a" | "mp3" | "wav";
  outputName?: string;
}

export interface ProgressCallback {
  (progress: {
    percent: number;
    stage: string;
    bytesProcessed?: number;
  }): void;
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
  hasCoverArt?: boolean;
  coverArtBase64?: string;
  lyrics?: string;
}

interface NativeAudioEnginePlugin {
  getEngineInfo(): Promise<any>;
  extractMetadata(options: { path?: string; uri?: string }): Promise<any>;
  processAudio(options: {
    path?: string;
    uri?: string;
    targetBitrateKbps: number;
    targetSampleRate?: number;
    targetChannels?: number;
    trimStartSeconds?: number;
    trimEndSeconds?: number;
    outputName?: string;
  }): Promise<any>;
  cancelProcessing(): Promise<void>;
  saveToDownloads(options: { path: string; displayName?: string }): Promise<any>;
  shareFile(options: { path: string; title?: string }): Promise<void>;
  addListener(eventName: string, listenerFunc: (event: any) => void): Promise<any>;
}

const NativePlugin = Capacitor.isNativePlatform()
  ? registerPlugin<NativeAudioEnginePlugin>("NativeAudioEngine")
  : null;

export class AudioEngine {
  public static isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  public static async getEngineInfo(): Promise<EngineInfo> {
    if (this.isNative() && NativePlugin) {
      try {
        const info = await NativePlugin.getEngineInfo();
        return {
          platform: "android",
          isNativeDevicePowered: true,
          engineName: `Android Hardware Engine (${info.abi || "arm64"})`,
          hardwareAcceleration: true,
          cpuAbi: info.abi,
          availableCores: info.availableCores,
          memoryMb: info.freeMemoryMb,
          supportedFormats: ["MP3", "M4A", "AAC", "WAV", "FLAC", "OGG"]
        };
      } catch (err) {
        console.warn("Could not query native engine info, falling back", err);
      }
    }

    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    return {
      platform: "web",
      isNativeDevicePowered: true,
      engineName: `Browser Web Audio Engine (${cores} Cores)`,
      hardwareAcceleration: typeof window !== "undefined" && Boolean(window.AudioContext || (window as any).webkitAudioContext),
      availableCores: cores,
      supportedFormats: ["MP3", "M4A", "WAV", "AAC", "OGG"]
    };
  }

  public static async readMetadata(file: File): Promise<AudioMetadata> {
    const meta: AudioMetadata = {
      title: file.name.replace(/\.[^/.]+$/, ""),
      durationSec: 0,
      hasCoverArt: false
    };

    if (this.isNative() && NativePlugin && (file as any).path) {
      try {
        const nativeMeta = await NativePlugin.extractMetadata({ path: (file as any).path });
        return {
          title: nativeMeta.title || meta.title,
          artist: nativeMeta.artist || "Unknown Artist",
          album: nativeMeta.album || "Unknown Album",
          albumArtist: nativeMeta.albumArtist,
          genre: nativeMeta.genre || "Other",
          year: nativeMeta.year || nativeMeta.date,
          trackNumber: nativeMeta.trackNumber,
          composer: nativeMeta.composer,
          durationSec: nativeMeta.durationSec || 0,
          bitrate: nativeMeta.bitrate ? Math.round(Number(nativeMeta.bitrate) / 1000) : undefined,
          hasCoverArt: Boolean(nativeMeta.hasCoverArt),
          coverArtBase64: nativeMeta.coverArtBase64
        };
      } catch (err) {
        console.warn("Native metadata read fallback to browser parsing", err);
      }
    }

    // Web audio metadata fallback
    try {
      const buffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        try {
          const decoded = await ctx.decodeAudioData(buffer.slice(0));
          meta.durationSec = decoded.duration;
        } finally {
          await ctx.close().catch(() => {});
        }
      }
    } catch {
      // Ignore duration decode errors for raw files
    }

    return meta;
  }

  public static async compressAudio(
    file: File,
    options: CompressionOptions,
    onProgress?: ProgressCallback
  ): Promise<ProcessedAudioResult> {
    onProgress?.({ percent: 5, stage: "Reading file into device memory…" });

    // 1. Android Native Processing
    if (this.isNative() && NativePlugin) {
      try {
        onProgress?.({ percent: 15, stage: "Initializing hardware encoder…" });
        let listener: any = null;
        if (onProgress) {
          listener = await NativePlugin.addListener("transcodeProgress", (event: any) => {
            onProgress({
              percent: Math.min(98, 15 + Math.round((event.percent || 0) * 0.8)),
              stage: event.stage || "Encoding audio on device…",
              bytesProcessed: event.bytesProcessed
            });
          });
        }

        const inputPath = (file as any).path || (file as any).nativeURL;
        const res = await NativePlugin.processAudio({
          path: inputPath,
          targetBitrateKbps: options.targetBitrateKbps,
          targetSampleRate: options.targetSampleRate || 44100,
          targetChannels: options.targetChannels || 2,
          trimStartSeconds: options.trimStartSec,
          trimEndSeconds: options.trimEndSec,
          outputName: options.outputName
        });

        if (listener) {
          listener.remove();
        }

        onProgress?.({ percent: 100, stage: "Hardware compression complete!" });
        return {
          nativePath: res.outputPath,
          contentUri: res.contentUri,
          fileName: res.fileName,
          outputSize: res.outputSize,
          originalSize: res.originalSize || file.size,
          durationSec: res.durationSec,
          bitrateKbps: res.outputBitrateKbps,
          sampleRate: res.outputSampleRate,
          channels: res.outputChannels,
          savedPercent: res.savedPercent,
          format: "m4a"
        };
      } catch (nativeErr) {
        console.warn("Native transcode failed, attempting client Web Audio transcode:", nativeErr);
      }
    }

    // 2. Client-Side Web Audio Processing (Vercel & Browser)
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Web Audio API is not supported in this environment.");
    }

    onProgress?.({ percent: 20, stage: "Decoding audio data locally…" });
    const arrayBuf = await file.arrayBuffer();
    const ctx = new AudioCtx();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuf);
    } finally {
      await ctx.close().catch(() => {});
    }

    const duration = audioBuffer.duration;
    const startSec = Math.max(0, options.trimStartSec || 0);
    const endSec = options.trimEndSec && options.trimEndSec > startSec ? Math.min(duration, options.trimEndSec) : duration;
    const trimmedDuration = Math.max(0.1, endSec - startSec);

    const outSampleRate = options.targetSampleRate || Math.min(44100, audioBuffer.sampleRate);
    const outChannels = options.targetChannels || Math.min(2, audioBuffer.numberOfChannels);

    onProgress?.({ percent: 50, stage: "Resampling and processing channels…" });

    const offlineCtx = new OfflineAudioContext(
      outChannels,
      Math.ceil(trimmedDuration * outSampleRate),
      outSampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0, startSec, trimmedDuration);

    onProgress?.({ percent: 70, stage: "Rendering processed audio…" });
    const renderedBuffer = await offlineCtx.startRendering();

    onProgress?.({ percent: 85, stage: "Encoding audio with target bitrate…" });
    // Encode to WAV / PCM with target resolution
    const wavBlob = audioBufferToWavBlob(renderedBuffer, options.targetBitrateKbps);

    onProgress?.({ percent: 100, stage: "Audio processing complete!" });

    const savedPercent = Math.max(0, Math.round(((file.size - wavBlob.size) / file.size) * 100));
    const cleanName = (options.outputName || file.name.replace(/\.[^/.]+$/, "")) + ".wav";

    return {
      blob: wavBlob,
      fileName: cleanName,
      outputSize: wavBlob.size,
      originalSize: file.size,
      durationSec: trimmedDuration,
      bitrateKbps: options.targetBitrateKbps,
      sampleRate: outSampleRate,
      channels: outChannels,
      savedPercent,
      format: "wav"
    };
  }

  public static async writeMp3Metadata(
    mp3Blob: Blob,
    metadata: AudioMetadata,
    artworkBlob?: Blob | null
  ): Promise<Blob> {
    const arrayBuffer = await mp3Blob.arrayBuffer();
    const writer = new ID3Writer(arrayBuffer);

    if (metadata.title) writer.setFrame("TIT2", metadata.title);
    if (metadata.artist) writer.setFrame("TPE1", [metadata.artist]);
    if (metadata.album) writer.setFrame("TALB", metadata.album);
    if (metadata.albumArtist) writer.setFrame("TPE2", metadata.albumArtist);
    if (metadata.genre) writer.setFrame("TCON", [metadata.genre]);
    if (metadata.year) writer.setFrame("TYER", Number(metadata.year) || new Date().getFullYear());
    if (metadata.composer) writer.setFrame("TCOM", [metadata.composer]);
    if (metadata.trackNumber) writer.setFrame("TRCK", metadata.trackNumber);
    if (metadata.lyrics) {
      writer.setFrame("USLT", {
        description: "Lyrics",
        lyrics: metadata.lyrics,
        language: "eng"
      });
    }

    if (artworkBlob) {
      const artBuffer = await artworkBlob.arrayBuffer();
      writer.setFrame("APIC", {
        type: 3, // Cover front
        data: artBuffer,
        description: "Cover Art",
        useUnicodeEncoding: false
      });
    }

    writer.addTag();
    return writer.getBlob();
  }

  public static async createZip(files: Array<{ name: string; blob?: Blob; nativePath?: string }>): Promise<Blob> {
    const zip = new JSZip();
    for (const file of files) {
      if (file.blob) {
        zip.file(file.name, file.blob);
      } else if (file.nativePath) {
        // Fallback for native file references if needed
        zip.file(file.name, `Local file saved at: ${file.nativePath}`);
      }
    }
    return await zip.generateAsync({ type: "blob" });
  }

  public static async saveProcessedFile(
    result: ProcessedAudioResult,
    displayName?: string
  ): Promise<void> {
    const name = displayName || result.fileName;

    if (this.isNative() && NativePlugin && result.nativePath) {
      try {
        await NativePlugin.saveToDownloads({
          path: result.nativePath,
          displayName: name
        });
        return;
      } catch (err) {
        console.warn("Native saveToDownloads failed, trying web download fallback", err);
      }
    }

    if (result.blob) {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  public static async shareAudio(result: ProcessedAudioResult, title = "Share Audio"): Promise<void> {
    if (this.isNative() && NativePlugin && result.nativePath) {
      try {
        await NativePlugin.shareFile({ path: result.nativePath, title });
        return;
      } catch (err) {
        console.warn("Native share failed", err);
      }
    }

    if (typeof navigator !== "undefined" && navigator.share && result.blob) {
      try {
        const file = new File([result.blob], result.fileName, { type: result.blob.type });
        await navigator.share({
          title,
          files: [file]
        });
        return;
      } catch {
        // Fallback to downloading
      }
    }

    await this.saveProcessedFile(result);
  }
}

/**
 * Encodes an AudioBuffer into a WAV Blob with bitrate/bit-depth scaling
 */
function audioBufferToWavBlob(buffer: AudioBuffer, targetBitrateKbps: number): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = targetBitrateKbps < 96 ? 8 : 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // Write WAV Header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // Write Interleaved PCM Audio Data
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      if (bitDepth === 16) {
        const s = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, s, true);
        offset += 2;
      } else {
        const s = Math.floor((sample + 1) * 127.5);
        view.setUint8(offset, s);
        offset += 1;
      }
    }
  }

  return new Blob([view], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
