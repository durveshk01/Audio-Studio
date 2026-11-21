import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, RotateCcw, Repeat } from "lucide-react";
import { useAudioSource } from "./useAudioSource";
import { formatTime } from "../services/format";
import { errorMessage } from "../services/errors";

interface AudioPlayerProps {
  src?: string;
  blob?: Blob;
  title?: string;
  artist?: string;
  duration?: number;
  playRequest?: number;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, blob, title = "Audio Track", artist = "Audio Studio", playRequest = 0 }) => {
  const objectUrl = useAudioSource(blob, src);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const audio = audioRef.current;
    audio?.pause();
    setIsPlaying(false); setCurrentTime(0); setDuration(0); setError("");
    return () => { audio?.pause(); };
  }, [objectUrl]);

  useEffect(() => {
    const pause = () => audioRef.current?.pause();
    window.addEventListener("audio-studio:navigate", pause);
    return () => window.removeEventListener("audio-studio:navigate", pause);
  }, []);

  useEffect(() => {
    if (objectUrl && playRequest > 0) {
      const audio = audioRef.current;
      void audio?.play().catch((cause: unknown) => {
        if (audio?.currentSrc === objectUrl || audio?.src === objectUrl) setError(`Playback failed: ${errorMessage(cause)}`);
      });
    }
  }, [playRequest, objectUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
      audioRef.current.playbackRate = playbackRate;
    }
  }, [volume, isMuted, playbackRate, objectUrl]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !objectUrl) return;
    if (!audio.paused) { audio.pause(); return; }
    setError("");
    try { await audio.play(); }
    catch (cause) { setError(`Playback failed: ${errorMessage(cause)}`); }
  };

  const updateTime = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
  };

  const seek = (time: number) => {
    if (!audioRef.current || !duration) return;
    audioRef.current.currentTime = Math.min(duration, Math.max(0, time));
    updateTime();
  };

  return <div className="audio-player-widget glass-panel">
    <audio ref={audioRef} src={objectUrl || undefined} preload="metadata" loop={loop}
      onTimeUpdate={updateTime} onLoadedMetadata={updateTime} onDurationChange={updateTime}
      onPlay={() => { setIsPlaying(true); setError(""); }} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)}
      onError={() => { setIsPlaying(false); setError("This audio cannot be played here, or its saved file is no longer available."); }} />
    <div className="player-track-meta"><div className="player-title">{title}</div><div className="player-sub">{artist}</div></div>
    <div className="player-timeline">
      <span className="time-display">{formatTime(currentTime)}</span>
      <input type="range" min={0} max={duration || 0} step={0.01} value={Math.min(currentTime, duration)} disabled={!duration}
        onChange={(event) => seek(Number(event.target.value))} className="timeline-slider" aria-label={`Seek in ${title}`} />
      <span className="time-display">{formatTime(duration)}</span>
    </div>
    <div className="player-controls">
      <button type="button" className="play-btn" onClick={togglePlay} disabled={!objectUrl} aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}>
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <button type="button" className="ctrl-btn btn-icon" onClick={() => seek(0)} disabled={!duration} aria-label="Restart track" title="Restart"><RotateCcw size={16} /></button>
      <button type="button" className={`ctrl-btn btn-icon ${loop ? "text-accent" : ""}`} onClick={() => setLoop(!loop)} aria-pressed={loop} aria-label="Loop track" title="Loop"><Repeat size={16} /></button>
      <button type="button" className="speed-badge" onClick={() => {
        const speeds = [1, 1.25, 1.5, 2, 0.75]; setPlaybackRate(speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length]);
      }} aria-label={`Playback speed ${playbackRate} times; change speed`} title="Playback speed">{playbackRate}x</button>
      <div className="volume-control">
        <button type="button" className="ctrl-btn btn-icon" onClick={() => setIsMuted(!isMuted)} aria-label={isMuted ? "Unmute" : "Mute"}>
          {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input type="range" min={0} max={1} step={0.05} value={isMuted ? 0 : volume} onChange={(event) => {
          setVolume(Number(event.target.value)); setIsMuted(false);
        }} className="volume-slider" aria-label="Volume" />
      </div>
    </div>
    {error && <p className="player-error text-danger" role="alert">{error}</p>}
  </div>;
};
