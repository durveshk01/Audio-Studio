import React, { useState, useRef, useEffect } from "react";
import {
  UploadCloud,
  Music,
  Disc,
  X,
  RotateCcw,
  Sparkles,
  Download,
  Share2,
  FileArchive,
  AlertCircle,
  Sliders,
  Radio
} from "lucide-react";
import { toast } from "sonner";
import {
  AudioEngine,
  CompressionOptions,
  ProcessedAudioResult,
  MAX_INPUT_BYTES
} from "../services/audioEngine";
import { LibraryStorage, type UserSettings } from "../services/libraryStorage";
import { ComparePlayer } from "../components/ComparePlayer";
import { errorMessage, isCancelled } from "../services/errors";
import { MP3_BITRATES, type AudioOutputFormat } from "../services/audioEncoding";

interface BatchItem {
  id: string;
  file: File;
  name: string;
  format: string;
  originalSize: number;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  stage: string;
  result?: ProcessedAudioResult;
  error?: string;
  libraryWarning?: string;
}

const PRESETS = [
  { id: "p320", label: "Highest Bitrate", kbps: 320, desc: "320 kbps · Larger files", color: "#10b981" },
  { id: "p256", label: "High Fidelity", kbps: 256, desc: "256 kbps · High quality", color: "#3b82f6" },
  { id: "p192", label: "Broadcast", kbps: 192, desc: "192 kbps · Standard", color: "#8b5cf6" },
  { id: "p160", label: "Balanced", kbps: 160, desc: "160 kbps · Streaming", color: "#d946ef" },
  { id: "p128", label: "Small File", kbps: 128, desc: "128 kbps · Fast share", color: "#f59e0b" },
  { id: "p96", label: "Voice / Podcast", kbps: 96, desc: "96 kbps · Compact", color: "#ef4444" }
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const CompressorView: React.FC = () => {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [presetId, setPresetId] = useState("p192");
  const [customKbps, setCustomKbps] = useState(192);
  const [sampleRate, setSampleRate] = useState(44100);
  const [channels, setChannels] = useState<1 | 2>(2);
  const [outputFormat, setOutputFormat] = useState<AudioOutputFormat>("mp3");
  const [outputFormats, setOutputFormats] = useState<AudioOutputFormat[]>(["mp3", "wav"]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const defaultsRef = useRef<UserSettings | null>(null);
  const outputRef = useRef({ sampleRate, outputFormat, customKbps });
  outputRef.current = { sampleRate, outputFormat, customKbps };

  useEffect(() => {
    let disposed = false;
    let supported: AudioOutputFormat[] = ["mp3", "wav"];
    const apply = (settings: UserSettings) => {
      if (runningRef.current) return;
      const formatChanged = defaultsRef.current?.defaultFormat !== settings.defaultFormat;
      const format = formatChanged ? supported.includes(settings.defaultFormat) ? settings.defaultFormat : "mp3" : outputRef.current.outputFormat;
      let bitrate = defaultsRef.current?.defaultBitrate !== settings.defaultBitrate ? settings.defaultBitrate : outputRef.current.customKbps;
      if (format === "mp3" && outputRef.current.sampleRate < 32000) bitrate = Math.min(160, bitrate);
      if (bitrate !== outputRef.current.customKbps) { setCustomKbps(bitrate); setPresetId(`p${bitrate}`); }
      if (formatChanged) setOutputFormat(format);
      defaultsRef.current = settings;
    };
    void Promise.all([AudioEngine.getEngineInfo(), LibraryStorage.getSettings()]).then(([info, settings]) => {
      if (!disposed) { supported = info.outputFormats; setOutputFormats(supported); apply(settings); }
    }).catch((error: unknown) => toast.warning(errorMessage(error)));
    const changed = (event: Event) => apply((event as CustomEvent<UserSettings>).detail);
    const beforeUnload = (event: BeforeUnloadEvent) => { if (runningRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("audio-studio:settings-changed", changed); window.addEventListener("beforeunload", beforeUnload);
    return () => { disposed = true; controllerRef.current?.abort(); window.removeEventListener("audio-studio:settings-changed", changed); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);

  const addFiles = (fileList: FileList | File[]) => {
    const list = Array.from(fileList);
    const valid = list.filter((f) => /\.(mp3|m4a|aac|wav|flac|ogg)$/i.test(f.name) && f.size > 0 && f.size <= MAX_INPUT_BYTES);
    const invalidCount = list.length - valid.length;

    if (invalidCount > 0) {
      toast.warning(`${invalidCount} empty, unsupported, or over-100 MB file(s) ignored.`);
    }

    if (!valid.length) return;

    const selected = valid.slice(0, Math.max(0, 100 - items.length));
    if (selected.length < valid.length) toast.warning("The queue holds up to 100 tracks. Export and remove completed tracks to add more.");
    const newItems: BatchItem[] = selected.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      format: file.name.split(".").pop()?.toUpperCase() || "AUDIO",
      originalSize: file.size,
      status: "queued",
      progress: 0,
      stage: "Ready"
    }));

    setItems((prev) => [...prev, ...newItems]);
    toast.success(`Added ${newItems.length} audio track(s) to queue.`);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const selectPreset = (p: typeof PRESETS[0]) => {
    setPresetId(p.id);
    setCustomKbps(p.kbps);
  };

  const changeOutput = (format: AudioOutputFormat, rate: number) => {
    setOutputFormat(format); setSampleRate(rate);
    if (format === "mp3" && rate < 32000 && customKbps > 160) { setCustomKbps(160); setPresetId("p160"); }
  };

  const processSingleItem = async (item: BatchItem, options: CompressionOptions): Promise<{ status: "completed" | "failed" | "cancelled"; retainedBytes: number }> => {
    setItems((prev) =>
       prev.map((i) => (i.id === item.id ? { ...i, status: "processing", progress: 5, stage: "Starting…", error: undefined } : i))
    );

    try {
      const result = await AudioEngine.compressAudio(item.file, options, (p) => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, progress: p.percent, stage: p.stage } : i
          )
        );
      });

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: "completed", progress: 100, stage: "Done", result }
            : i
        )
      );

      try { await LibraryStorage.saveTrack({
        id: item.id,
        title: result.metadata?.title || item.name.replace(/\.[^/.]+$/, ""),
        artist: result.metadata?.artist || "Unknown Artist",
        album: result.metadata?.album || "Audio Studio Exports",
        coverArtBase64: result.metadata?.coverArtBase64,
        durationSec: result.durationSec,
        fileSize: result.outputSize,
        format: result.format,
        bitrateKbps: result.bitrateKbps,
        favorite: false,
        dateAdded: new Date().toISOString(),
        blob: result.blob,
        nativePath: result.nativePath,
        isProcessed: true,
        originalSize: result.originalSize,
        savedPercent: result.savedPercent
      }); } catch (error) {
        const warning = errorMessage(error);
        setItems((previous) => previous.map((i) => i.id === item.id ? { ...i, libraryWarning: warning } : i));
        toast.warning(`Export ready, but library save failed: ${warning}`);
      }
      return { status: "completed", retainedBytes: result.blob?.size || 0 };
    } catch (error) {
      const cancelled = isCancelled(error) || options.signal?.aborted;
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : errorMessage(error), stage: cancelled ? "Cancelled" : "Failed" }
            : i
        )
      );
      return { status: cancelled ? "cancelled" : "failed", retainedBytes: 0 };
    }
  };

  const startBatchCompression = async (onlyId?: string) => {
    if (runningRef.current) return;
    const queued = items.filter((i) => (!onlyId || i.id === onlyId) && ["queued", "failed", "cancelled"].includes(i.status));
    if (!queued.length) {
      toast.info("Add new tracks or retry a failed track to process more audio.");
      return;
    }
    runningRef.current = true;
    const controller = new AbortController(); controllerRef.current = controller;
    setIsProcessingBatch(true);
    const options: CompressionOptions = { targetBitrateKbps: customKbps, targetSampleRate: sampleRate, targetChannels: channels, outputFormat, signal: controller.signal };
    let completed = 0, failed = 0, paused = false;
    let retainedBytes = items.reduce((sum, i) => sum + (i.result?.blob?.size || 0), 0);
    try {
      for (const item of queued) {
        if (controller.signal.aborted) break;
        if (retainedBytes >= 128 * 1024 * 1024) { paused = true; break; }
        const result = await processSingleItem(item, options);
        if (result.status === "completed") completed++;
        if (result.status === "failed") failed++;
        retainedBytes += result.retainedBytes;
      }
    } finally {
      runningRef.current = false; controllerRef.current = null; setIsProcessingBatch(false);
    }
    if (paused) toast.info(`${completed} export(s) ready. Remove completed tracks from the queue before continuing to keep device memory bounded.`);
    else if (controller.signal.aborted) toast.info(`Batch cancelled. ${completed} completed export(s) remain available.`);
    else if (failed) toast.warning(`${completed} export(s) ready; ${failed} track(s) failed. Review the queue to retry.`);
    else toast.success(`${completed} audio export(s) ready.`);
  };

  const downloadAllZip = async () => {
    const completed = items.filter((i) => i.status === "completed" && i.result);
    if (!completed.length) {
      toast.warning("No completed files to export.");
      return;
    }

    setIsExportingZip(true);
    try {
    const zipFiles = completed.map((i) => ({
      name: i.result!.fileName,
      blob: i.result!.blob,
      nativePath: i.result!.nativePath,
      outputSize: i.result!.outputSize
    }));

    const zipBlob = await AudioEngine.createZip(zipFiles);
    await AudioEngine.saveBlob(zipBlob, `AudioStudio_Batch_${Date.now()}.zip`);
    toast.success(AudioEngine.isNative() ? "ZIP saved to Downloads." : "ZIP download started.");
    } catch (error) { if (!isCancelled(error)) toast.error(errorMessage(error)); }
    finally { setIsExportingZip(false); }
  };

  const exportItem = async (item: BatchItem, share = false) => {
    if (!item.result) return;
    try { if (share) await AudioEngine.shareAudio(item.result); else await AudioEngine.saveProcessedFile(item.result); }
    catch (error) { if (!isCancelled(error)) toast.error(errorMessage(error)); }
  };

  const completedCount = items.filter((i) => i.status === "completed").length;
  const firstCompleted = items.find((i) => i.status === "completed" && i.result);

  return (
    <div className="compressor-view-container">
      {/* Upload Dropzone */}
      {items.length === 0 && (
        <section
          className={`dropzone-modern glass-panel ${isDragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            accept=".mp3,.m4a,.aac,.wav,.flac,.ogg,audio/*"
            ref={fileInputRef}
            hidden
            aria-label="Audio files for compression"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="dropzone-icon-ring">
            <Radio size={36} className="pulse-icon text-accent" />
          </div>
          <h2>Drop Audio Files Here</h2>
          <p>MP3, M4A, AAC, WAV, FLAC, OGG · 100 MB per file · Up to 100 tracks</p>
          <button
            type="button"
            className="btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            <UploadCloud size={18} />
            <span>Select Audio Files</span>
          </button>
        </section>
      )}

      {/* Main Workspace Grid when files exist */}
      {items.length > 0 && (
        <div className="compressor-grid">
          {/* Left: Track Queue */}
          <div className="queue-column glass-panel">
            <div className="column-header">
              <div className="title-row">
                <Music size={18} className="text-accent" />
                <h3>Audio Queue ({items.length})</h3>
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingBatch}
                >
                  + Add More
                </button>
                <input
                  type="file"
                  multiple
                  accept=".mp3,.m4a,.aac,.wav,.flac,.ogg,audio/*"
                  ref={fileInputRef}
                  aria-label="More audio files for compression"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            <div className="queue-list">
              {items.map((item) => (
                <div key={item.id} className={`queue-card ${item.status}`}>
                  <div className="card-icon">
                    <Disc size={20} />
                  </div>
                  <div className="card-info">
                    <div className="card-name" title={item.name}>
                      {item.name}
                    </div>
                    <div className="card-meta">
                      <span>{formatBytes(item.originalSize)}</span>
                      <span>·</span>
                      <span>{item.format}</span>
                      {item.result && (
                        <>
                          <span>·</span>
                          <span className={item.result.savedPercent >= 0 ? "text-success" : "text-warning"}>
                            {formatBytes(item.result.outputSize)} ({Math.abs(item.result.savedPercent)}% {item.result.savedPercent >= 0 ? "smaller" : "larger"})
                          </span>
                        </>
                      )}
                    </div>
                    {item.status === "processing" && (
                      <div className="mini-progress" role="progressbar" aria-label={`Encoding ${item.name}`} aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className="mini-progress-fill"
                          style={{ width: `${item.progress}%` }}
                        />
                        <span className="stage-text">{item.stage}</span>
                      </div>
                    )}
                    {item.status === "failed" && (
                      <div className="error-text">
                        <AlertCircle size={12} /> {item.error}
                      </div>
                    )}
                    {item.status === "cancelled" && <p className="text-muted">Cancelled · Ready to retry</p>}
                    {item.libraryWarning && <p className="text-warning">Export available; library save failed: {item.libraryWarning}</p>}
                  </div>

                  <div className="card-actions">
                    {item.status === "completed" && item.result && (
                      <>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => exportItem(item)}
                          aria-label={`Save ${item.result.fileName}`}
                          title="Save to device"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => exportItem(item, true)}
                          aria-label={`Share ${item.result.fileName}`}
                          title="Share audio"
                        >
                          <Share2 size={16} />
                        </button>
                      </>
                    )}
                    {(item.status === "failed" || item.status === "cancelled") && (
                      <button
                        type="button"
                        className="btn-icon text-warning"
                        onClick={() => startBatchCompression(item.id)}
                        disabled={isProcessingBatch || isExportingZip}
                        aria-label={`Retry ${item.name}`}
                        title="Retry"
                      >
                        <RotateCcw size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-icon text-muted"
                      onClick={() => removeItem(item.id)}
                      disabled={isProcessingBatch || isExportingZip}
                      aria-label={`Remove ${item.name} from queue`}
                      title="Remove"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Engine Settings */}
          <div className="settings-column glass-panel">
            <fieldset className="engine-controls" disabled={isProcessingBatch || isExportingZip}>
            <legend className="sr-only">Audio output settings</legend>
            <div className="column-header">
              <div className="title-row">
                <Sliders size={18} className="text-accent" />
                <h3>Compression Engine</h3>
              </div>
            </div>

            <div className="presets-section">
              <h4 className="section-label">Bitrate Presets</h4>
              <div className="presets-grid">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`preset-card ${presetId === p.id ? "active" : ""}`}
                    aria-pressed={presetId === p.id}
                    disabled={outputFormat === "wav" || (outputFormat === "mp3" && sampleRate < 32000 && p.kbps > 160)}
                    onClick={() => selectPreset(p)}
                  >
                    <div className="preset-name">{p.label}</div>
                    <div className="preset-sub">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="slider-control">
              <div className="slider-header">
                <label htmlFor="custom-kbps">Target Bitrate</label>
                <span className="slider-value">{customKbps} kbps</span>
              </div>
              <select
                id="custom-kbps"
                value={customKbps}
                disabled={outputFormat === "wav"}
                onChange={(e) => {
                  setCustomKbps(Number(e.target.value));
                  setPresetId("custom");
                }}
                className="select-input"
              >{MP3_BITRATES.map((bitrate) => <option key={bitrate} value={bitrate} disabled={outputFormat === "mp3" && sampleRate < 32000 && bitrate > 160}>{bitrate} kbps</option>)}</select>
              {outputFormat === "mp3" && sampleRate < 32000 && <p className="text-muted">At 22,050 Hz, MP3 supports up to 160 kbps.</p>}
              {outputFormat === "wav" && <p className="text-muted">WAV uses 16-bit PCM: {sampleRate * channels * 16 / 1000} kbps. It may be larger than the source.</p>}
            </div>

            <div className="options-row">
              <div className="option-col">
                <label htmlFor="sample-rate">Sample Rate</label>
                <select
                  id="sample-rate"
                  value={sampleRate}
                  onChange={(e) => changeOutput(outputFormat, Number(e.target.value))}
                  className="select-input"
                >
                  <option value={48000}>48,000 Hz (Broadcast)</option>
                  <option value={44100}>44,100 Hz (CD Audio)</option>
                  <option value={32000}>32,000 Hz</option>
                  <option value={22050}>22,050 Hz (Speech)</option>
                </select>
              </div>

              <div className="option-col">
                <label htmlFor="channel-cfg">Channels</label>
                <select
                  id="channel-cfg"
                  value={channels}
                  onChange={(e) => setChannels(Number(e.target.value) as 1 | 2)}
                  className="select-input"
                >
                  <option value={2}>Stereo (2 Ch)</option>
                  <option value={1}>Mono (1 Ch)</option>
                </select>
              </div>
            </div>

            <div className="options-row">
              <div className="option-col">
                <label htmlFor="output-format">Output Format</label>
                <select
                  id="output-format"
                  value={outputFormat}
                  onChange={(e) => changeOutput(e.target.value as AudioOutputFormat, sampleRate)}
                  className="select-input"
                >
                  <option value="m4a" disabled={!outputFormats.includes("m4a")}>M4A / AAC{!outputFormats.includes("m4a") ? " (encoder unavailable)" : ""}</option>
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV (16-bit PCM)</option>
                </select>
              </div>
            </div>
            </fieldset>

            <div className="action-button-group">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => startBatchCompression()}
                disabled={isProcessingBatch || isExportingZip || !items.some((i) => ["queued", "failed", "cancelled"].includes(i.status))}
              >
                <Sparkles size={18} />
                <span>
                  {isProcessingBatch
                    ? "Processing on Device…"
                    : `${outputFormat === "wav" ? "Convert" : "Compress"} Audio`}
                </span>
              </button>
              {isProcessingBatch && <button type="button" className="btn-secondary w-full" onClick={() => controllerRef.current?.abort()}>Cancel Batch</button>}

              {completedCount > 0 && (
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={downloadAllZip}
                  disabled={isProcessingBatch || isExportingZip}
                >
                  <FileArchive size={18} />
                  <span>{isExportingZip ? "Creating ZIP…" : `Export All as ZIP (${completedCount})`}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* A/B Comparison Player if at least one file finished */}
      {firstCompleted && firstCompleted.result && (
        <section className="mt-6">
          <ComparePlayer
            originalFile={firstCompleted.file}
            compressedBlob={firstCompleted.result.blob}
            compressedSrc={firstCompleted.result.nativePath ? AudioEngine.nativeFileUrl(firstCompleted.result.nativePath) : undefined}
            originalSize={firstCompleted.originalSize}
            compressedSize={firstCompleted.result.outputSize}
            originalBitrate={firstCompleted.result.metadata?.bitrate}
            compressedBitrate={firstCompleted.result.bitrateKbps}
            title={firstCompleted.name}
          />
        </section>
      )}
    </div>
  );
};
