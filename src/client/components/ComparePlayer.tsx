import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, ArrowRight, Zap, CheckCircle2 } from "lucide-react";

interface ComparePlayerProps {
  originalFile?: File | Blob;
  compressedBlob?: Blob;
  originalSize: number;
  compressedSize: number;
  originalBitrate?: number;
  compressedBitrate?: number;
  title?: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const ComparePlayer: React.FC<ComparePlayerProps> = ({
  originalFile,
  compressedBlob,
  originalSize,
  compressedSize,
  originalBitrate = 320,
  compressedBitrate = 128,
  title = "Audio Comparison"
}) => {
  const [activeTrack, setActiveTrack] = useState<"original" | "compressed">("compressed");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [origUrl, setOrigUrl] = useState("");
  const [compUrl, setCompUrl] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (originalFile) {
      const url = URL.createObjectURL(originalFile);
      setOrigUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [originalFile]);

  useEffect(() => {
    if (compressedBlob) {
      const url = URL.createObjectURL(compressedBlob);
      setCompUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [compressedBlob]);

  const currentSrc = activeTrack === "original" ? origUrl : compUrl;

  const toggleTrack = (track: "original" | "compressed") => {
    if (track === activeTrack) return;
    const prevTime = audioRef.current?.currentTime || 0;
    const wasPlaying = isPlaying;
    setActiveTrack(track);

    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.currentTime = prevTime;
        if (wasPlaying) {
          audioRef.current.play().catch(() => {});
        }
      }
    }, 50);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  const onTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration) {
        setDuration(audioRef.current.duration);
      }
    }
  };

  const savedPercent = originalSize > 0
    ? Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100))
    : 0;

  return (
    <div className="compare-player-card glass-panel">
      <audio
        ref={audioRef}
        src={currentSrc}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onTimeUpdate}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="compare-header">
        <div className="compare-title">
          <Zap size={18} className="text-accent" />
          <span>A/B Audio Comparison</span>
        </div>
        <div className="savings-badge">
          <CheckCircle2 size={14} />
          <span>{savedPercent}% smaller</span>
        </div>
      </div>

      <div className="comparison-tabs">
        <button
          type="button"
          className={`comp-tab ${activeTrack === "original" ? "active" : ""}`}
          onClick={() => toggleTrack("original")}
        >
          <div className="tab-name">Original Audio</div>
          <div className="tab-meta">{formatBytes(originalSize)} · ~{originalBitrate} kbps</div>
        </button>

        <div className="comp-arrow">
          <ArrowRight size={16} />
        </div>

        <button
          type="button"
          className={`comp-tab ${activeTrack === "compressed" ? "active" : ""}`}
          onClick={() => toggleTrack("compressed")}
        >
          <div className="tab-name">Compressed Audio</div>
          <div className="tab-meta text-success">{formatBytes(compressedSize)} · {compressedBitrate} kbps</div>
        </button>
      </div>

      <div className="compare-playback">
        <button
          type="button"
          className="play-btn-large"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <div className="compare-info">
          <div className="track-name">{title}</div>
          <div className="now-listening">
            Currently listening to: <strong>{activeTrack === "original" ? "Original Source" : "Compressed Result"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};
