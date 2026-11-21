import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, ArrowRight, Zap, CheckCircle2 } from "lucide-react";
import { useAudioSource } from "./useAudioSource";
import { formatBytes, formatTime } from "../services/format";
import { errorMessage } from "../services/errors";

interface ComparePlayerProps {
  originalFile?: File | Blob;
  compressedBlob?: Blob;
  compressedSrc?: string;
  originalSize: number;
  compressedSize: number;
  originalBitrate?: number;
  compressedBitrate?: number;
  title?: string;
}

type Track = "original" | "compressed";

export const ComparePlayer: React.FC<ComparePlayerProps> = ({ originalFile, compressedBlob, compressedSrc, originalSize,
  compressedSize, originalBitrate, compressedBitrate, title = "Audio Comparison" }) => {
  const origUrl = useAudioSource(originalFile);
  const compUrl = useAudioSource(compressedBlob, compressedSrc);
  const originalRef = useRef<HTMLAudioElement>(null);
  const compressedRef = useRef<HTMLAudioElement>(null);
  const activeRef = useRef<Track>("compressed");
  const pendingRef = useRef<{ track: Track; time: number; play: boolean } | null>(null);
  const [activeTrack, setActiveTrack] = useState<Track>("compressed");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  const element = (track: Track) => track === "original" ? originalRef.current : compressedRef.current;

  useEffect(() => {
    const original = originalRef.current, compressed = compressedRef.current;
    const pause = () => { pendingRef.current = null; original?.pause(); compressed?.pause(); };
    pause(); pendingRef.current = null;
    setCurrentTime(0); setDuration(0); setIsPlaying(false); setError("");
    window.addEventListener("audio-studio:navigate", pause);
    return () => { pause(); window.removeEventListener("audio-studio:navigate", pause); };
  }, [origUrl, compUrl]);

  const play = async (track: Track) => {
    const audio = element(track);
    if (!audio) return;
    setError("");
    try {
      await audio.play();
      if (activeRef.current !== track) audio.pause();
    } catch (cause) { if (activeRef.current === track) setError(`Playback failed: ${errorMessage(cause)}`); }
  };

  const syncTime = (track: Track) => {
    if (activeRef.current !== track) return;
    const audio = element(track);
    if (audio) { setCurrentTime(audio.currentTime || 0); setDuration(Number.isFinite(audio.duration) ? audio.duration : 0); }
  };

  const applyPending = (track: Track) => {
    const pending = pendingRef.current, audio = element(track);
    if (pending?.track === track && audio && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(pending.time, Math.max(0, audio.duration - 0.01));
      pendingRef.current = null;
      if (pending.play) void play(track);
    }
    syncTime(track);
  };

  const toggleTrack = (track: Track) => {
    if (track === activeRef.current) return;
    const previous = element(activeRef.current), next = element(track);
    const time = previous?.currentTime || 0, wasPlaying = previous ? !previous.paused : false;
    previous?.pause(); activeRef.current = track; setActiveTrack(track); setIsPlaying(false); setError("");
    pendingRef.current = { track, time, play: wasPlaying };
    if (next && next.readyState >= 1) applyPending(track);
    else { setCurrentTime(time); setDuration(0); }
  };

  const togglePlay = () => {
    const audio = element(activeRef.current);
    if (!audio) return;
    if (!audio.paused) audio.pause(); else void play(activeRef.current);
  };

  const savings = originalSize > 0 ? Math.round((originalSize - compressedSize) / originalSize * 100) : 0;
  const bitrate = (value?: number) => value && Number.isFinite(value) ? `${value} kbps` : "bitrate unknown";

  return <div className="compare-player-card glass-panel">
    {(["original", "compressed"] as Track[]).map((track) => <audio key={track} ref={track === "original" ? originalRef : compressedRef}
      src={(track === "original" ? origUrl : compUrl) || undefined} preload="metadata"
      onLoadedMetadata={() => applyPending(track)} onDurationChange={() => syncTime(track)} onTimeUpdate={() => syncTime(track)}
      onPlay={() => { if (activeRef.current === track) { setIsPlaying(true); setError(""); } else element(track)?.pause(); }}
      onPause={() => { if (activeRef.current === track) setIsPlaying(false); }} onEnded={() => { if (activeRef.current === track) setIsPlaying(false); }}
      onError={() => { if (activeRef.current === track) { setIsPlaying(false); setError("This version cannot be played here, or its audio file is unavailable."); } }} />)}
    <div className="compare-header">
      <div className="compare-title"><Zap size={18} className="text-accent" /><span>A/B Audio Comparison</span></div>
      <div className={`savings-badge ${savings < 0 ? "text-warning" : ""}`}><CheckCircle2 size={14} /><span>{Math.abs(savings)}% {savings >= 0 ? "smaller" : "larger"}</span></div>
    </div>
    <div className="comparison-tabs">
      <button type="button" className={`comp-tab ${activeTrack === "original" ? "active" : ""}`} onClick={() => toggleTrack("original")} aria-pressed={activeTrack === "original"} disabled={!origUrl}>
        <span className="tab-name">Original Audio</span><span className="tab-meta">{formatBytes(originalSize)} · {bitrate(originalBitrate)}</span>
      </button>
      <div className="comp-arrow" aria-hidden="true"><ArrowRight size={16} /></div>
      <button type="button" className={`comp-tab ${activeTrack === "compressed" ? "active" : ""}`} onClick={() => toggleTrack("compressed")} aria-pressed={activeTrack === "compressed"} disabled={!compUrl}>
        <span className="tab-name">Processed Audio</span><span className="tab-meta">{formatBytes(compressedSize)} · {bitrate(compressedBitrate)}</span>
      </button>
    </div>
    <div className="compare-playback">
      <button type="button" className="play-btn-large" onClick={togglePlay} disabled={!(activeTrack === "original" ? origUrl : compUrl)} aria-label={isPlaying ? "Pause comparison" : "Play comparison"}>
        {isPlaying ? <Pause size={24} /> : <Play size={24} />}
      </button>
      <div className="compare-info"><div className="track-name">{title}</div><div className="now-listening">Listening to: <strong>{activeTrack === "original" ? "Original Source" : "Processed Result"}</strong></div></div>
      <div className="player-timeline"><span className="time-display">{formatTime(currentTime)}</span>
        <input type="range" min={0} max={duration || 0} step={0.01} value={Math.min(currentTime, duration)} disabled={!duration} aria-label="Seek comparison"
          onChange={(event) => { const audio = element(activeRef.current); if (audio) audio.currentTime = Number(event.target.value); syncTime(activeRef.current); }} />
        <span className="time-display">{formatTime(duration)}</span>
      </div>
    </div>
    {error && <p className="text-danger mt-3" role="alert">{error}</p>}
  </div>;
};
