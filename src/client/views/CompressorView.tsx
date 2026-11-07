import React, { useState, useRef } from "react";
import {
  UploadCloud,
  Music,
  Disc,
  X,
  Play,
  RotateCcw,
  Sparkles,
  Download,
  Share2,
  FileArchive,
  AlertCircle,
  CheckCircle2,
  Sliders,
  Radio
} from "lucide-react";
import { toast } from "sonner";
import {
  AudioEngine,
  CompressionOptions,
  ProcessedAudioResult
} from "../services/audioEngine";
import { LibraryStorage } from "../services/libraryStorage";
import { ComparePlayer } from "../components/ComparePlayer";

interface BatchItem {
  id: string;
  file: File;
  name: string;
  format: string;
  originalSize: number;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  stage: string;
  result?: ProcessedAudioResult;
  error?: string;
}

const PRESETS = [
  { id: "p320", label: "Studio Master", kbps: 320, desc: "320 kbps · Transparent", color: "#10b981" },
  { id: "p256", label: "High Fidelity", kbps: 256, desc: "256 kbps · Audiophile", color: "#3b82f6" },
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
  const [outputFormat, setOutputFormat] = useState<"m4a" | "mp3" | "wav">("m4a");
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (fileList: FileList | File[]) => {
    const list = Array.from(fileList);
    const valid = list.filter((f) => /\.(mp3|m4a|aac|wav|flac|ogg)$/i.test(f.name));
    const invalidCount = list.length - valid.length;

    if (invalidCount > 0) {
      toast.warning(`${invalidCount} unsupported file(s) ignored.`);
    }

    if (!valid.length) return;

    const newItems: BatchItem[] = valid.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
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

  const processSingleItem = async (item: BatchItem): Promise<void> => {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: "processing", progress: 5, stage: "Starting…" } : i))
    );

    const options: CompressionOptions = {
      targetBitrateKbps: customKbps,
      targetSampleRate: sampleRate,
      targetChannels: channels,
      outputFormat
    };

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

      // Save to local library automatically
      await LibraryStorage.saveTrack({
        id: item.id,
        title: item.name.replace(/\.[^/.]+$/, ""),
        artist: "Processed Audio",
        album: "Audio Studio Exports",
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
      });
    } catch (err: any) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: "failed", error: err.message || "Failed to compress", stage: "Failed" }
            : i
        )
      );
    }
  };

  const startBatchCompression = async () => {
    if (!items.length) {
      toast.error("Please add at least one audio file.");
      return;
    }

    setIsProcessingBatch(true);
    toast.info("Beginning device-powered audio compression…");

    const queued = items.filter((i) => i.status === "queued" || i.status === "failed");
    for (const item of queued) {
      await processSingleItem(item);
    }

    setIsProcessingBatch(false);
    toast.success("Batch compression finished!");
  };

  const downloadAllZip = async () => {
    const completed = items.filter((i) => i.status === "completed" && i.result);
    if (!completed.length) {
      toast.warning("No completed files to export.");
      return;
    }

    toast.info("Assembling ZIP archive on device…");
    const zipFiles = completed.map((i) => ({
      name: i.result!.fileName,
      blob: i.result!.blob,
      nativePath: i.result!.nativePath
    }));

    const zipBlob = await AudioEngine.createZip(zipFiles);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AudioStudio_Batch_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success("ZIP archive downloaded!");
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
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            multiple
            accept=".mp3,.m4a,.aac,.wav,.flac,.ogg,audio/*"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="dropzone-icon-ring">
            <Radio size={36} className="pulse-icon text-accent" />
          </div>
          <h2>Drop Audio Files Here</h2>
          <p>Supports MP3, M4A, AAC, WAV, FLAC · Up to 100 tracks per batch</p>
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
                          <span className="text-success">
                            {formatBytes(item.result.outputSize)} (-{item.result.savedPercent}%)
                          </span>
                        </>
                      )}
                    </div>
                    {item.status === "processing" && (
                      <div className="mini-progress">
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
                  </div>

                  <div className="card-actions">
                    {item.status === "completed" && item.result && (
                      <>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => AudioEngine.saveProcessedFile(item.result!)}
                          title="Save to device"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => AudioEngine.shareAudio(item.result!)}
                          title="Share audio"
                        >
                          <Share2 size={16} />
                        </button>
                      </>
                    )}
                    {item.status === "failed" && (
                      <button
                        type="button"
                        className="btn-icon text-warning"
                        onClick={() => processSingleItem(item)}
                        title="Retry"
                      >
                        <RotateCcw size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-icon text-muted"
                      onClick={() => removeItem(item.id)}
                      disabled={item.status === "processing"}
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
            <div className="column-header">
              <div className="title-row">
                <Sliders size={18} className="text-accent" />
                <h3>Compression Engine</h3>
              </div>
            </div>

            <div className="presets-section">
              <label className="section-label">Bitrate Presets</label>
              <div className="presets-grid">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`preset-card ${presetId === p.id ? "active" : ""}`}
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
              <input
                id="custom-kbps"
                type="range"
                min="64"
                max="320"
                step="32"
                value={customKbps}
                onChange={(e) => {
                  setCustomKbps(Number(e.target.value));
                  setPresetId("custom");
                }}
                className="range-slider"
              />
            </div>

            <div className="options-row">
              <div className="option-col">
                <label htmlFor="sample-rate">Sample Rate</label>
                <select
                  id="sample-rate"
                  value={sampleRate}
                  onChange={(e) => setSampleRate(Number(e.target.value))}
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
                  onChange={(e) => setOutputFormat(e.target.value as any)}
                  className="select-input"
                >
                  <option value="m4a">M4A (Hardware AAC)</option>
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV (Lossless)</option>
                </select>
              </div>
            </div>

            <div className="action-button-group">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={startBatchCompression}
                disabled={isProcessingBatch}
              >
                <Sparkles size={18} />
                <span>
                  {isProcessingBatch
                    ? "Processing on Device…"
                    : `Compress ${items.length} Track${items.length === 1 ? "" : "s"}`}
                </span>
              </button>

              {completedCount > 0 && (
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={downloadAllZip}
                >
                  <FileArchive size={18} />
                  <span>Export All as ZIP ({completedCount})</span>
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
            originalSize={firstCompleted.originalSize}
            compressedSize={firstCompleted.result.outputSize}
            originalBitrate={320}
            compressedBitrate={firstCompleted.result.bitrateKbps}
            title={firstCompleted.name}
          />
        </section>
      )}
    </div>
  );
};
