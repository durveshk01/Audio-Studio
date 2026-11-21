import React, { useState, useRef, useEffect } from "react";
import { BarChart3, Scissors, Upload, Activity, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { AudioAnalyzer, type AudioAnalysisMetrics } from "../services/audioAnalyzer";
import { AudioEngine, assertAudioInput, type ProcessedAudioResult } from "../services/audioEngine";
import { MP3_BITRATES, AUDIO_SAMPLE_RATES, type AudioOutputFormat } from "../services/audioEncoding";
import { AudioPlayer } from "../components/AudioPlayer";
import { formatBytes, formatTime } from "../services/format";
import { errorMessage, isCancelled } from "../services/errors";

const BANDS = { subBass: "20–60 Hz", bass: "60–250 Hz", lowMid: "250–500 Hz", mid: "500 Hz–2 kHz", highMid: "2–6 kHz", high: "6–20 kHz" };
const decibels = (value: number) => value <= -120 ? "≤ −120" : value.toFixed(1);

export const AudioToolsView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [metrics, setMetrics] = useState<AudioAnalysisMetrics | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimStatus, setTrimStatus] = useState("");
  const [trimFormat, setTrimFormat] = useState<AudioOutputFormat>("wav");
  const [trimBitrate, setTrimBitrate] = useState(192);
  const [formats, setFormats] = useState<AudioOutputFormat[]>(["mp3", "wav"]);
  const [trimResult, setTrimResult] = useState<ProcessedAudioResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisController = useRef<AbortController | null>(null);
  const trimController = useRef<AbortController | null>(null);
  const selectionRef = useRef(0);
  const trimmingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const invalidateSelection = () => { selectionRef.current++; };
    void AudioEngine.getEngineInfo().then((info) => { if (!disposed) setFormats(info.outputFormats); }).catch((error: unknown) => toast.warning(errorMessage(error)));
    return () => { disposed = true; invalidateSelection(); analysisController.current?.abort(); trimController.current?.abort(); };
  }, []);

  const handleFileSelect = async (file: File) => {
    if (trimmingRef.current) return;
    try { assertAudioInput(file); } catch (error) { toast.error(errorMessage(error)); return; }
    analysisController.current?.abort();
    const selection = ++selectionRef.current;
    const controller = new AbortController(); analysisController.current = controller;
    setSelectedFile(file); setMetrics(null); setTrimResult(null); setTrimStart(0); setTrimEnd(0);
    setAnalysisError(""); setIsAnalyzing(true); setAnalysisStatus("Decoding selected audio…");
    try {
      const result = await AudioAnalyzer.analyze(file, (status) => { if (selection === selectionRef.current) setAnalysisStatus(status); }, controller.signal);
      if (selection !== selectionRef.current) return;
      setMetrics(result); setTrimEnd(result.durationSec); setAnalysisStatus("");
      if (result.sampleRate < 32000) setTrimBitrate(128);
    } catch (error) {
      if (selection !== selectionRef.current) return;
      if (isCancelled(error)) setAnalysisStatus("Analysis cancelled. Analyze again or choose another track.");
      else { setAnalysisError(errorMessage(error)); toast.error(`Analysis failed: ${errorMessage(error)}`); }
    } finally { if (selection === selectionRef.current) { setIsAnalyzing(false); analysisController.current = null; } }
  };

  const exportTrimmed = async () => {
    if (!selectedFile || !metrics || trimmingRef.current) return;
    if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd) || trimStart < 0 || trimEnd > metrics.durationSec || trimEnd <= trimStart) { toast.error("Choose a valid trim region inside the track."); return; }
    trimmingRef.current = true; setIsTrimming(true);
    const controller = new AbortController(); trimController.current = controller;
    try {
      const result = await AudioEngine.compressAudio(selectedFile, { targetBitrateKbps: trimBitrate,
        targetSampleRate: AUDIO_SAMPLE_RATES.includes(metrics.sampleRate as typeof AUDIO_SAMPLE_RATES[number]) ? metrics.sampleRate : 44100,
        targetChannels: Math.min(2, metrics.channels), trimStartSec: trimStart, trimEndSec: trimEnd,
        outputFormat: trimFormat, outputName: `${selectedFile.name.replace(/\.[^/.]+$/, "")}_trimmed`, signal: controller.signal }, (progress) => setTrimStatus(`${progress.percent}% · ${progress.stage}`));
      setTrimResult(result);
      await AudioEngine.saveProcessedFile(result);
      toast.success(AudioEngine.isNative() ? "Trimmed audio saved." : "Trimmed audio download started.");
    } catch (error) { if (isCancelled(error)) toast.info("Trim or save cancelled; completed exports remain available."); else toast.error(`Trimming failed: ${errorMessage(error)}`); }
    finally { trimmingRef.current = false; trimController.current = null; setIsTrimming(false); setTrimStatus(""); }
  };

  const minimumRegion = Math.min(0.01, (metrics?.durationSec || 0.02) / 2);
  const changeStart = (value: number) => { setTrimStart(Math.max(0, Math.min(value, trimEnd - minimumRegion))); };
  const changeEnd = (value: number) => { setTrimEnd(Math.min(metrics?.durationSec || 0, Math.max(value, trimStart + minimumRegion))); };

  return <div className="audio-tools-view">
    <input type="file" accept=".mp3,.m4a,.aac,.wav,.flac,.ogg,audio/*" ref={fileInputRef} hidden aria-label="Audio file for analysis"
      onChange={(event) => { if (event.target.files?.[0]) void handleFileSelect(event.target.files[0]); event.target.value = ""; }} />
    {!selectedFile ? <section className="dropzone-modern glass-panel" onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files[0]) void handleFileSelect(event.dataTransfer.files[0]); }}>
      <div className="dropzone-icon-ring"><BarChart3 size={36} className="text-accent" /></div><h2>Analyze or Trim Audio</h2>
      <p>Measure gated loudness, sample peaks, estimated intersample peaks, clipping, silence, and FFT band energy locally. Up to 100 MB.</p>
      <button type="button" className="btn-primary" onClick={() => fileInputRef.current?.click()}><Upload size={18} />Select Track for Analysis</button>
    </section> : <div className="workspace-toolbar glass-panel"><span className="file-name">{selectedFile.name}</span>
      <div className="header-actions"><button type="button" className="btn-secondary btn-sm" disabled={isTrimming} onClick={() => fileInputRef.current?.click()}>Change File</button>
        {!isAnalyzing && <button type="button" className="btn-secondary btn-sm" disabled={isTrimming} onClick={() => handleFileSelect(selectedFile)}>Analyze Again</button>}</div>
    </div>}
    {isAnalyzing && <div className="analyzing-card glass-panel recovery-panel" role="status"><Activity size={28} className="pulse-icon text-accent" /><h3>Analyzing on Your Device</h3><p>{analysisStatus}</p><button type="button" className="btn-secondary" onClick={() => { analysisController.current?.abort(); setAnalysisStatus("Cancelling analysis…"); }}>Cancel Analysis</button></div>}
    {analysisError && <p className="glass-panel recovery-panel text-danger" role="alert">Analysis failed: {analysisError}. Choose another track or analyze again.</p>}
    {!isAnalyzing && analysisStatus && <p className="glass-panel recovery-panel" role="status">{analysisStatus}</p>}
    {selectedFile && metrics && !isAnalyzing && <div className="tools-grid">
      <div className="metrics-strip">
        <div className="metric-card glass-panel"><span className="metric-label">Integrated loudness</span><span className="metric-value text-accent">{metrics.lufs === null ? "N/A" : `${metrics.lufs.toFixed(1)} LUFS`}</span><span className="metric-sub">K-weighted, absolute/relative gates; at least 400 ms of audible audio</span></div>
        <div className="metric-card glass-panel"><span className="metric-label">Sample peak</span><span className={`metric-value ${metrics.peakDb >= 0 ? "text-danger" : "text-success"}`}>{decibels(metrics.peakDb)} dBFS</span><span className="metric-sub">Maximum across every decoded sample and channel</span></div>
        <div className="metric-card glass-panel"><span className="metric-label">Interpolated peak estimate</span><span className="metric-value">{decibels(metrics.truePeakDb)} dBTP</span><span className="metric-sub">4× windowed-sinc estimate; not a certified true-peak meter</span></div>
        <div className="metric-card glass-panel"><span className="metric-label">RMS / crest factor</span><span className="metric-value">{decibels(metrics.rmsDb)} dBFS</span><span className="metric-sub">Peak-to-RMS crest factor: {metrics.dynamicRangeDb.toFixed(1)} dB (not loudness range)</span></div>
        <div className="metric-card glass-panel"><span className="metric-label">Near-full-scale samples</span><span className={`metric-value ${metrics.clippingCount ? "text-danger" : "text-success"}`}>{metrics.clippingCount.toLocaleString()}</span><span className="metric-sub">Absolute sample value ≥ 0.999; possible clipping</span></div>
        <div className="metric-card glass-panel"><span className="metric-label">Measured silence</span><span className="metric-value">{metrics.silencePercent}%</span><span className="metric-sub">100 ms blocks with RMS below −50 dBFS</span></div>
      </div>
      <section className="waveform-panel glass-panel"><div className="panel-header"><div className="title-row"><Activity size={18} className="text-accent" /><h3>Peak Envelope</h3></div><span className="badge-pill">{formatTime(metrics.durationSec)} · {metrics.sampleRate} Hz decoded · {metrics.channels} Ch · {formatBytes(metrics.fileSizeBytes)}</span></div>
        <div className="waveform-bars-container" role="img" aria-label={`Measured waveform, sample peak ${decibels(metrics.peakDb)} dBFS`}>
          {metrics.waveformPeaks.map((peak, index) => <div key={index} className={`wave-bar ${peak >= 0.999 ? "clipped" : ""}`} style={{ height: `${Math.max(1, Math.min(100, peak * 100))}%` }} title={`Peak ${(peak * 100).toFixed(1)}%`} />)}
        </div>
      </section>
      <section className="spectrum-panel glass-panel"><div className="panel-header"><div className="title-row"><BarChart3 size={18} className="text-accent" /><h3>FFT Frequency Energy</h3></div></div>
        <p className="card-desc">Hann-windowed FFT samples across the track, summed by channel. Percent of measured energy between 20 Hz and 20 kHz, limited by the decoded sample rate.</p>
        <div className="spectrum-grid">{Object.entries(metrics.frequencyBands).map(([band, value]) => <div key={band} className="spectrum-col"><div className="spectrum-meter" aria-hidden="true"><div className="meter-fill" style={{ height: `${value}%` }} /></div><span className="band-name">{BANDS[band as keyof typeof BANDS]}</span><span className="band-val">{value}%</span></div>)}</div>
      </section>
      <section className="silence-panel glass-panel"><h3>Silence Intervals</h3>{metrics.silenceIntervals.length ? <><p className="card-desc">{metrics.silenceIntervals.length} measured interval(s). Showing up to 20.</p><ul>{metrics.silenceIntervals.slice(0, 20).map((interval, index) => <li key={index}>{interval.startSec.toFixed(2)}–{interval.endSec.toFixed(2)} s ({(interval.endSec - interval.startSec).toFixed(2)} s)</li>)}</ul></> : <p className="card-desc">No blocks below the −50 dBFS silence threshold.</p>}</section>
      <section className="trimmer-panel glass-panel"><div className="panel-header"><div className="title-row"><Scissors size={18} className="text-accent" /><h3>Local Audio Trimmer</h3></div><span className="text-muted">Selected: {(trimEnd - trimStart).toFixed(2)} s</span></div>
        <p className="card-desc">Exports a newly rendered region. WAV is 16-bit PCM; MP3 and AAC are lossy encodings.</p>
        <fieldset className="trimmer-controls" disabled={isTrimming}><legend className="sr-only">Trim region and output</legend>
          <div className="trim-row"><label htmlFor="trim-start">Start (seconds)</label><input id="trim-start" type="number" min={0} max={Math.max(0, trimEnd - minimumRegion)} step={0.01} value={Number(trimStart.toFixed(3))} className="text-input" onChange={(event) => changeStart(Number(event.target.value))} /><input type="range" min={0} max={metrics.durationSec} step={minimumRegion} value={trimStart} onChange={(event) => changeStart(Number(event.target.value))} className="range-slider" aria-label="Trim start" /></div>
          <div className="trim-row"><label htmlFor="trim-end">End (seconds)</label><input id="trim-end" type="number" min={trimStart + minimumRegion} max={metrics.durationSec} step={0.01} value={Number(trimEnd.toFixed(3))} className="text-input" onChange={(event) => changeEnd(Number(event.target.value))} /><input type="range" min={0} max={metrics.durationSec} step={minimumRegion} value={trimEnd} onChange={(event) => changeEnd(Number(event.target.value))} className="range-slider" aria-label="Trim end" /></div>
          <div className="form-group"><label htmlFor="trim-format">Trim output format</label><select id="trim-format" className="select-input" value={trimFormat} onChange={(event) => setTrimFormat(event.target.value as AudioOutputFormat)}><option value="wav">WAV (16-bit PCM)</option><option value="mp3">MP3</option><option value="m4a" disabled={!formats.includes("m4a")}>M4A / AAC{!formats.includes("m4a") ? " (unavailable)" : ""}</option></select></div>
            {trimFormat !== "wav" && <div className="form-group"><label htmlFor="trim-bitrate">Trim bitrate</label><select id="trim-bitrate" className="select-input" value={trimBitrate} onChange={(event) => setTrimBitrate(Number(event.target.value))}>{MP3_BITRATES.map((bitrate) => <option key={bitrate} value={bitrate} disabled={trimFormat === "mp3" && metrics.sampleRate < 32000 && bitrate > 160}>{bitrate} kbps</option>)}</select></div>}
          <button type="button" className="btn-primary w-full" onClick={exportTrimmed}><Scissors size={16} />{isTrimming ? "Rendering Trimmed Audio…" : "Export Trimmed Region"}</button>
        </fieldset>
        {isTrimming && <><p className="mt-3" role="status">{trimStatus}</p><button type="button" className="btn-secondary" onClick={() => trimController.current?.abort()}>Cancel Trim</button></>}
      </section>
      {trimResult && <section className="recovery-panel glass-panel"><p><CheckCircle2 size={16} className="text-success" /> Export ready: {trimResult.fileName} · {trimResult.durationSec.toFixed(2)} s · {formatBytes(trimResult.outputSize)}</p>
        <button type="button" className="btn-secondary" disabled={isTrimming} onClick={() => { void AudioEngine.saveProcessedFile(trimResult).catch((error: unknown) => { if (!isCancelled(error)) toast.error(errorMessage(error)); }); }}>Save Prepared Trim</button>
        <AudioPlayer blob={trimResult.blob} src={trimResult.nativePath ? AudioEngine.nativeFileUrl(trimResult.nativePath) : undefined} title={trimResult.fileName} />
      </section>}
      <AudioPlayer blob={selectedFile} title={selectedFile.name} />
    </div>}
  </div>;
};
