import React, { useState, useRef } from "react";
import {
  Sliders,
  BarChart3,
  Scissors,
  Upload,
  Play,
  Pause,
  Download,
  AlertTriangle,
  Volume2,
  Activity,
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { AudioAnalyzer, AudioAnalysisMetrics } from "../services/audioAnalyzer";
import { AudioEngine } from "../services/audioEngine";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatTime(secs: number): string {
  if (isNaN(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export const AudioToolsView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [metrics, setMetrics] = useState<AudioAnalysisMetrics | null>(null);

  // Trimmer state
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isTrimming, setIsTrimming] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setIsAnalyzing(true);
    setAnalysisStatus("Analyzing track data…");

    try {
      const result = await AudioAnalyzer.analyze(file, (msg) => setAnalysisStatus(msg));
      setMetrics(result);
      setTrimStart(0);
      setTrimEnd(result.durationSec);
      toast.success("Audio analysis complete!");
    } catch (err: any) {
      toast.error(`Analysis failed: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportTrimmed = async () => {
    if (!selectedFile || !metrics) return;
    if (trimEnd <= trimStart) {
      toast.error("Trim end time must be greater than start time.");
      return;
    }

    setIsTrimming(true);
    toast.info("Trimming and rendering audio on device…");

    try {
      const result = await AudioEngine.compressAudio(selectedFile, {
        targetBitrateKbps: 256,
        trimStartSec: trimStart,
        trimEndSec: trimEnd,
        outputName: `${selectedFile.name.replace(/\.[^/.]+$/, "")}_trimmed`
      });

      await AudioEngine.saveProcessedFile(result);
      toast.success("Trimmed audio saved to your device!");
    } catch (err: any) {
      toast.error(`Trimming failed: ${err.message}`);
    } finally {
      setIsTrimming(false);
    }
  };

  return (
    <div className="audio-tools-view">
      {!selectedFile && (
        <section
          className="dropzone-modern glass-panel"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            accept=".mp3,.m4a,.aac,.wav,.flac,.ogg,audio/*"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <div className="dropzone-icon-ring">
            <BarChart3 size={36} className="text-accent" />
          </div>
          <h2>Analyze or Trim Audio Track</h2>
          <p>Measure LUFS, true peak dBFS, clipping, silence intervals, and frequency spectrum.</p>
          <button type="button" className="btn-primary">
            <Upload size={18} />
            <span>Select Track for Analysis</span>
          </button>
        </section>
      )}

      {isAnalyzing && (
        <div className="analyzing-card glass-panel text-center">
          <Activity size={32} className="pulse-icon text-accent mx-auto" />
          <h3 className="mt-3">Analyzing Audio on Local Device</h3>
          <p className="text-muted">{analysisStatus}</p>
        </div>
      )}

      {selectedFile && metrics && !isAnalyzing && (
        <div className="tools-grid">
          {/* Top: Metrics Overview Cards */}
          <div className="metrics-strip">
            <div className="metric-card glass-panel">
              <span className="metric-label">Loudness (LUFS)</span>
              <span className={`metric-value ${metrics.lufs > -14 ? "text-warning" : "text-accent"}`}>
                {metrics.lufs} LUFS
              </span>
              <span className="metric-sub">Target: -14 LUFS (Spotify/Apple)</span>
            </div>

            <div className="metric-card glass-panel">
              <span className="metric-label">Peak Level</span>
              <span className={`metric-value ${metrics.peakDb > -0.5 ? "text-danger" : "text-success"}`}>
                {metrics.peakDb} dBFS
              </span>
              <span className="metric-sub">Ceiling: -1.0 dBFS recommended</span>
            </div>

            <div className="metric-card glass-panel">
              <span className="metric-label">RMS Energy</span>
              <span className="metric-value">{metrics.rmsDb} dBFS</span>
              <span className="metric-sub">Dynamic range: {metrics.dynamicRangeDb} dB</span>
            </div>

            <div className="metric-card glass-panel">
              <span className="metric-label">Clipping Detection</span>
              <span className={`metric-value ${metrics.clippingCount > 0 ? "text-danger" : "text-success"}`}>
                {metrics.clippingCount} samples
              </span>
              <span className="metric-sub">
                {metrics.clippingCount === 0 ? "Clean waveform" : "Potential distortion"}
              </span>
            </div>
          </div>

          {/* Interactive Waveform Canvas */}
          <div className="waveform-panel glass-panel">
            <div className="panel-header">
              <div className="title-row">
                <Activity size={18} className="text-accent" />
                <h3>Waveform Analysis</h3>
              </div>
              <span className="badge-pill">
                {formatTime(metrics.durationSec)} · {metrics.sampleRate} Hz · {metrics.channels} Ch
              </span>
            </div>

            <div className="waveform-bars-container">
              {metrics.waveformPeaks.map((peak, idx) => {
                const heightPercent = Math.max(8, Math.round(peak * 100));
                const isClipped = peak >= 0.98;
                return (
                  <div
                    key={idx}
                    className={`wave-bar ${isClipped ? "clipped" : ""}`}
                    style={{ height: `${heightPercent}%` }}
                    title={`Peak: ${Math.round(peak * 100)}%`}
                  />
                );
              })}
            </div>
          </div>

          {/* Frequency Spectrum Estimation */}
          <div className="spectrum-panel glass-panel">
            <div className="panel-header">
              <div className="title-row">
                <BarChart3 size={18} className="text-accent" />
                <h3>Frequency Energy Distribution</h3>
              </div>
            </div>

            <div className="spectrum-grid">
              {Object.entries(metrics.frequencyBands).map(([band, val]) => (
                <div key={band} className="spectrum-col">
                  <div className="spectrum-meter">
                    <div className="meter-fill" style={{ height: `${val}%` }} />
                  </div>
                  <span className="band-name">{band}</span>
                  <span className="band-val">{val}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Local Audio Trimmer */}
          <div className="trimmer-panel glass-panel">
            <div className="panel-header">
              <div className="title-row">
                <Scissors size={18} className="text-accent" />
                <h3>Local Audio Trimmer</h3>
              </div>
              <span className="text-muted">
                Selected: {formatTime(Math.max(0, trimEnd - trimStart))}
              </span>
            </div>

            <div className="trimmer-controls">
              <div className="trim-row">
                <label>Start: {formatTime(trimStart)}</label>
                <input
                  type="range"
                  min="0"
                  max={metrics.durationSec}
                  step="0.5"
                  value={trimStart}
                  onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 1))}
                  className="range-slider"
                />
              </div>

              <div className="trim-row">
                <label>End: {formatTime(trimEnd)}</label>
                <input
                  type="range"
                  min="0"
                  max={metrics.durationSec}
                  step="0.5"
                  value={trimEnd}
                  onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 1))}
                  className="range-slider"
                />
              </div>

              <button
                type="button"
                className="btn-primary w-full mt-4"
                onClick={exportTrimmed}
                disabled={isTrimming}
              >
                <Scissors size={16} />
                <span>{isTrimming ? "Rendering Trimmed Audio…" : "Export Trimmed Region"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
