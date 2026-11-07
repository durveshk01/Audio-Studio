import React, { useRef, useState, useEffect } from "react";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { Activity, CheckCircle, Disc, Download, Music, Radio, RefreshCw, Settings2, Sparkles, UploadCloud, X, AlertCircle } from "lucide-react";
import { Toaster, toast } from "sonner";

// --- Types ---
interface PublicFile {
  id: string;
  name: string;
  format: string;
  originalSize: number;
  outputSize?: number;
  duration?: number;
  bitrateKbps?: number;
  progress: number;
  status: "queued" | "processing" | "completed" | "failed" | "skipped";
  downloadUrl?: string;
  error?: string;
}

interface PublicJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  targetMb: number;
  force: boolean;
  currentFileId?: string;
  completed: number;
  remaining: number;
  overallProgress: number;
  files: PublicFile[];
  zipUrl?: string;
  error?: string;
}

function formatBytes(bytes: number, decimals = 1) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

const PRESETS = [
  { id: 'p60', label: 'Max Quality', target: 60, desc: 'Near transparent', color: '#10b981' },
  { id: 'p40', label: 'High Quality', target: 40, desc: 'Excellent balance', color: '#3b82f6' },
  { id: 'p30', label: 'Balanced', target: 30, desc: 'Standard compression', color: '#8b5cf6' },
  { id: 'p20', label: 'Small File', target: 20, desc: 'Fast sharing', color: '#d946ef' },
  { id: 'p10', label: 'Extreme', target: 10, desc: 'Maximum reduction', color: '#f43f5e' },
];

const PROCESSING_MESSAGES = [
  "Analyzing audio frequencies...",
  "Optimizing bitrate...",
  "Preserving sound quality...",
  "Removing unnecessary data...",
  "Finalizing your compressed audio..."
];

function App() {
  const [activeTool, setActiveTool] = useState<"compressor" | "metatune">("compressor");
  const [files, setFiles] = useState<File[]>([]);
  const [targetMb, setTargetMb] = useState(30);
  const [presetId, setPresetId] = useState('p30');
  const [force, setForce] = useState(false);
  
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [job, setJob] = useState<PublicJob | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (job?.status === 'processing' || isUploading) {
      const int = setInterval(() => setMsgIdx(i => (i + 1) % PROCESSING_MESSAGES.length), 2500);
      return () => clearInterval(int);
    }
  }, [job?.status, isUploading]);

  const activePreset = PRESETS.find(p => p.id === presetId);
  const activeColor = activePreset?.color || '#8b5cf6';

  const addFiles = (incoming: FileList | File[]) => {
    const next = Array.from(incoming);
    const valid = next.filter((file) => /\.(mp3|m4a)$/i.test(file.name));
    const invalid = next.length - valid.length;

    if (invalid) toast.error(`${invalid} unsupported file${invalid === 1 ? "" : "s"} ignored. Use MP3 or M4A.`);
    
    const remainingSlots = 100 - files.length;
    if (remainingSlots <= 0) {
      toast.error("You can upload up to 100 files per batch.");
      return;
    }

    const accepted = valid.slice(0, remainingSlots);
    if (valid.length > remainingSlots) {
      toast.warning(`Added ${remainingSlots} files. Maximum 100 files per batch reached.`);
    }
    setFiles((current) => [...current, ...accepted]);
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const handlePresetClick = (preset: typeof PRESETS[0]) => {
    setPresetId(preset.id);
    setTargetMb(preset.target);
  };

  const updateTargetSize = (value: string) => {
    const nextTarget = Number(value);
    setTargetMb(nextTarget);
    setPresetId(PRESETS.find((preset) => preset.target === nextTarget)?.id ?? "custom");
  };

  const startCompression = async () => {
    if (!files.length) {
      toast.error("Add at least one MP3 or M4A file.");
      return;
    }
    if (!Number.isFinite(targetMb) || targetMb <= 0 || targetMb > 1000) {
      toast.error("Choose a target size between 1 MB and 1000 MB.");
      return;
    }

    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    body.append("targetMb", String(targetMb));
    body.append("force", String(force));

    setIsUploading(true);
    try {
      const response = await fetch("/api/jobs", { method: "POST", body });
      const payload = (await response.json()) as PublicJob | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Upload failed.");
      // Set job BEFORE clearing isUploading to prevent a brief flash where
      // neither the upload screen nor the processing screen is shown.
      setJob(payload);
      setIsUploading(false);
      listenForProgress(payload.id);
      toast.success("Compression engine started.");
    } catch (error) {
      setIsUploading(false);
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    }
  };

  const listenForProgress = (jobId: string) => {
    eventSourceRef.current?.close();
    const events = new EventSource(`/api/jobs/${jobId}/events`);
    eventSourceRef.current = events;
    let retryCount = 0;

    events.onmessage = (event) => {
      retryCount = 0; // reset on successful message
      try {
        const payload = JSON.parse(event.data) as PublicJob;
        setJob(payload);
        if (payload.status === "completed") {
          toast.success("Your compressed tracks are ready.");
          events.close();
          eventSourceRef.current = null;
        }
        if (payload.status === "failed") {
          toast.error(payload.error ?? "Compression failed.");
          events.close();
          eventSourceRef.current = null;
        }
      } catch (err) {
        console.warn("SSE parse error:", err);
      }
    };
    events.onerror = () => {
      retryCount += 1;
      if (retryCount >= 5 || events.readyState === EventSource.CLOSED) {
        toast.error("Lost connection to progress updates.");
        events.close();
        eventSourceRef.current = null;
      }
    };
  };

  const reset = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setFiles([]);
    setJob(null);
  };

  const renderSignatureVisualizer = (isProcessing = false) => (
    <div className={`signature-visualizer ${isProcessing ? 'processing' : ''}`} style={{ '--theme-color': activeColor } as React.CSSProperties}>
      <div className="vis-ring ring-1" />
      <div className="vis-ring ring-2" />
      <div className="vis-core">
        {isProcessing ? (
          <>
            <span className="vis-value">{job?.overallProgress || 0}</span>
            <span className="vis-unit">%</span>
            <span className="vis-label">Completed</span>
          </>
        ) : (
          <>
            <span className="vis-value">{targetMb}</span>
            <span className="vis-unit">MB</span>
            <span className="vis-label">Target Per Track</span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Toaster theme="dark" position="top-center" />
      <div className="studio-shell">
        <header className="nav studio-nav">
          <a className="brand" href="/" aria-label="Audio Studio home">
            <span className="brand-mark"><Activity /></span>
            <span>Audio Studio<span className="brand-dot">.</span></span>
          </a>
          <nav className="studio-tabs" aria-label="Audio Studio tools">
            <button type="button" className={`studio-tab ${activeTool === "compressor" ? "active" : ""}`} aria-pressed={activeTool === "compressor"} onClick={() => setActiveTool("compressor")}>
              <Music size={16} /> Compressor
            </button>
            <button type="button" className={`studio-tab ${activeTool === "metatune" ? "active" : ""}`} aria-pressed={activeTool === "metatune"} onClick={() => setActiveTool("metatune")}>
              <Sparkles size={16} /> MetaTune
            </button>
          </nav>
        </header>

        <main className={`compressor-main ${activeTool === "compressor" ? "" : "is-hidden"}`}>
        {!job && files.length === 0 && (
          <div className="hero">
            <div className="hero-copy">
              <div className="eyebrow"><Sparkles size={14} /> A lighter way to listen</div>
              <h1>Big sound.<br /><span>Smaller files.</span></h1>
              <p>Choose a size, drop in your tracks, and let smart bitrate compression take it from here.</p>
              <div className="hero-highlights">
                <span><i /> No sign-up</span><span><i /> Up to 100 tracks</span><span><i /> Files auto-delete</span>
              </div>
            </div>
            <div className="sound-card" aria-hidden="true">
              <div className="sound-card-top"><span className="sound-icon"><Music size={16} /></span><span>SMART ENCODING</span><span className="sound-live"><i /> READY</span></div>
              <div className="waveform">{Array.from({ length: 39 }, (_, index) => {
                const height = 18 + Math.abs(Math.sin(index * 0.57) * Math.cos(index * 0.19)) * 76;
                return <i key={index} style={{ "--bar-height": `${height}%`, "--bar-delay": `${(index % 13) * -0.11}s` } as React.CSSProperties} />;
              })}</div>
              <div className="sound-card-bottom"><strong>Made for your music library</strong><span>Bitrate tuned to each track’s duration and target size.</span></div>
            </div>
          </div>
        )}

        {!job && files.length === 0 && (
          <section
            className={`dropzone ${isDragging ? "dragging" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
          >
            <input type="file" multiple accept=".mp3,.m4a,audio/mpeg,audio/mp4" ref={inputRef} onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }} />
            <div className="dropzone-content">
              <div className="visualizer-idle">
                <Radio size={32} className="pulse-icon" />
              </div>
              <div className="dropzone-copy"><h2>Drop your tracks here</h2><p>or browse files from your device</p></div>
              <button className="btn-primary" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
                <UploadCloud /> Select Audio Files
              </button>
              <div className="dropzone-formats"><span>MP3</span><span>M4A</span><i /> Up to 100 files per batch
              </div>
            </div>
          </section>
        )}

        {!job && files.length > 0 && (
          <div className="workspace-grid">
            <div className="tracks-panel glass-panel">
              <h3><Music size={18} /> Uploaded Tracks ({files.length})</h3>
              <div className="tracks-list">
                {files.map((file, idx) => (
                    <div key={`${file.name}-${file.size}-${idx}`} className="audio-player-card">
                    <div className="player-icon"><Disc /></div>
                    <div className="player-info">
                      <h4>{file.name}</h4>
                      <div className="player-meta">
                        <span>{formatBytes(file.size)}</span>
                        <span>{file.name.split('.').pop()?.toUpperCase()}</span>
                      </div>
                    </div>
                    <button className="remove-btn" onClick={() => removeFile(idx)} aria-label={`Remove ${file.name}`}><X size={18} /></button>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="settings-panel glass-panel">
              <h3><Settings2 size={18} /> Compression Engine</h3>
              
              <div className="visualizer-container">
                {renderSignatureVisualizer()}
              </div>

              <div className="target-control">
                <label htmlFor="target-size">Target size <span>per track</span></label>
                <div className="target-input-wrap"><input id="target-size" type="number" min="1" max="1000" step="1" value={targetMb} onChange={(e) => updateTargetSize(e.target.value)} /><span>MB</span></div>
              </div>

              <div className="presets-grid">
                {PRESETS.map(p => (
                  <button
                    key={p.id}
                    className={`preset-btn ${presetId === p.id ? 'active' : ''}`}
                    onClick={() => handlePresetClick(p)}
                    style={{ '--accent': p.color, '--accent-rgb': p.color === '#10b981' ? '16, 185, 129' : p.color === '#3b82f6' ? '59, 130, 246' : p.color === '#8b5cf6' ? '139, 92, 246' : p.color === '#d946ef' ? '217, 70, 239' : '244, 63, 94' } as React.CSSProperties}
                  >
                    <div>
                      <div className="preset-name">{p.label}</div>
                      <div className="preset-meta">{p.desc}</div>
                    </div>
                    <div className="preset-name">{p.target} MB</div>
                  </button>
                ))}
              </div>

              <label className="toggle-row">
                <input type="checkbox" className="toggle-input" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span className="toggle-switch" />
                <span className="toggle-copy"><strong>Force recompression</strong><small>Reprocess files already under this size.</small></span>
              </label>

              <button className="btn-primary" onClick={startCompression} disabled={isUploading} style={{ width: '100%', justifyContent: 'center' }}>
                <Sparkles /> {isUploading ? "Uploading tracks…" : `Compress ${files.length} track${files.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}

        {(job?.status === 'processing' || job?.status === 'queued' || (isUploading && !job)) && (
          <div className="processing-screen glass-panel">
            <span className="processing-kicker"><span className="status-dot" /> {job ? `${job.completed} of ${job.files.length} tracks complete` : "Uploading your tracks"}</span>
            {renderSignatureVisualizer(true)}
            <h2 className="processing-text">{isUploading && !job ? "Preparing your tracks…" : PROCESSING_MESSAGES[msgIdx]}</h2>
            <div className="progress-bar-container">
              <div className="progress-fill" style={{ width: `${job?.overallProgress || 0}%` }} />
            </div>
            <p className="processing-note">You can keep this tab open while we work through the batch.</p>
          </div>
        )}

        {job?.status === 'failed' && (
          <div className="failure-screen glass-panel">
            <div className="failure-icon"><AlertCircle size={28} /></div>
            <div><h2>We couldn’t finish this batch</h2><p>{job.error || "Something interrupted the compression job. Try again with your audio files."}</p></div>
            <button className="btn-secondary" onClick={reset}><RefreshCw size={17} /> Start over</button>
          </div>
        )}

        {job?.status === 'completed' && (
          <div className="success-screen">
            <div className="success-hero glass-panel">
              <CheckCircle className="success-icon" />
              <h2>{job.files.some((file) => file.status === "failed") ? "Batch complete" : "Compression complete"}</h2>
              <p className="success-summary">{job.files.filter((file) => file.status === "completed" || file.status === "skipped").length} tracks ready{job.files.some((file) => file.status === "failed") ? ` · ${job.files.filter((file) => file.status === "failed").length} could not be processed` : " to download"}</p>
              
              {(() => {
                const totalOrig = job.files.reduce((acc, f) => acc + f.originalSize, 0);
                const totalComp = job.files.reduce((acc, f) => acc + (f.outputSize || f.originalSize), 0);
                const saved = Math.max(0, totalOrig - totalComp);
                const savedPercent = totalOrig > 0 ? Math.round((saved / totalOrig) * 100) : 0;
                
                return (
                  <div className="space-saved-stat">
                    <span className="saved-value">{savedPercent}%</span>
                    <span className="saved-label">Smaller</span>
                  </div>
                );
              })()}
              
              <div className="success-actions">
                {job.zipUrl && (
                  <a href={job.zipUrl} className="btn-primary" style={{ textDecoration: 'none' }}>
                    <Download /> Download ZIP Archive
                  </a>
                )}
                <button className="btn-secondary" onClick={reset}>
                  <RefreshCw /> Compress More
                </button>
              </div>
            </div>

            <div className="tracks-list" style={{ maxHeight: 'none' }}>
              {job.files.map((file) => (
                <div key={file.id} className="result-row">
                  <div className="player-info">
                    <h4>{file.name}</h4>
                    <div className={`player-meta result-status ${file.status}`}>
                      {file.status === "completed" ? "Compressed successfully" : file.status === "skipped" ? "Already under target · left unchanged" : file.error || "Could not process this file"}
                    </div>
                  </div>
                  
                  <div className="result-stats">
                    <div className="stat-group">
                      <span className="stat-label">Original</span>
                      <span className="stat-val">{formatBytes(file.originalSize)}</span>
                    </div>
                    <div className="stat-group">
                      <span className="stat-label">Compressed</span>
                      <span className="stat-val highlight">{file.outputSize ? formatBytes(file.outputSize) : "—"}</span>
                    </div>
                    <div className="stat-group">
                      <span className="stat-label">Bitrate</span>
                      <span className="stat-val">{file.bitrateKbps ? `${file.bitrateKbps} kbps` : "—"}</span>
                    </div>
                  </div>

                  {file.downloadUrl && (
                    <a href={file.downloadUrl} className="remove-btn" title="Download">
                      <Download size={20} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        </main>
        <iframe
          className={`metatune-frame ${activeTool === "metatune" ? "" : "is-hidden"}`}
          src="/metatune"
          title="MetaTune music workspace"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
