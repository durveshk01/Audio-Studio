import React, { useState, useEffect, useRef, useCallback } from "react";
import { Library, Search, Heart, Play, Trash2, Download, Share2, Filter, Disc, Plus } from "lucide-react";
import { toast } from "sonner";
import { LibraryStorage, type LibraryTrack } from "../services/libraryStorage";
import { AudioEngine, assertAudioInput, safeFileName, type ProcessedAudioResult } from "../services/audioEngine";
import { AudioPlayer } from "../components/AudioPlayer";
import { formatBytes, formatTime } from "../services/format";
import { errorMessage, isCancelled } from "../services/errors";

function exportResult(track: LibraryTrack): ProcessedAudioResult {
  const originalName = track.blob instanceof File ? track.blob.name : undefined;
  const extension = /^(mp3|m4a|wav|aac|flac|ogg)$/i.test(track.format) ? track.format.toLowerCase() : "audio";
  return { blob: track.blob, nativePath: track.nativePath, fileName: safeFileName(originalName || `${track.title}.${extension}`),
    outputSize: track.fileSize, originalSize: track.originalSize || track.fileSize, durationSec: track.durationSec,
    bitrateKbps: track.bitrateKbps || 0, sampleRate: 0, channels: 0, savedPercent: track.savedPercent || 0, format: track.format };
}

export const LibraryView: React.FC = () => {
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "favorites" | "processed">("all");
  const [sortBy, setSortBy] = useState<"date" | "title" | "size">("date");
  const [activeTrack, setActiveTrack] = useState<LibraryTrack | null>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const importController = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshRequest = useRef(0);
  const alive = useRef(true);

  const loadTracks = useCallback(async () => {
    const request = ++refreshRequest.current;
    try {
      const list = await LibraryStorage.getAllTracks();
      if (!alive.current || request !== refreshRequest.current) return;
      setTracks(list); setLoadError("");
      setActiveTrack((current) => current ? list.find((track) => track.id === current.id) || null : null);
    } catch (error) { if (alive.current && request === refreshRequest.current) setLoadError(errorMessage(error)); }
    finally { if (alive.current && request === refreshRequest.current) setLoading(false); }
  }, []);

  useEffect(() => {
    alive.current = true; void loadTracks();
    const invalidateRefresh = () => { refreshRequest.current++; };
    const changed = () => { void loadTracks(); };
    window.addEventListener("audio-studio:library-changed", changed);
    return () => { alive.current = false; invalidateRefresh(); importController.current?.abort(); window.removeEventListener("audio-studio:library-changed", changed); };
  }, [loadTracks]);

  const importFiles = async (files: File[]) => {
    if (importController.current) return;
    const controller = new AbortController(); importController.current = controller;
    setIsImporting(true);
    let imported = 0, failed = 0, selectedBytes = 0;
    const selected = files.slice(0, 100);
    if (selected.length < files.length) toast.info("Import up to 100 tracks per batch.");
    try {
      for (let index = 0; index < selected.length; index++) {
        if (controller.signal.aborted) break;
        const file = selected[index];
        setImportStatus(`Importing ${index + 1}/${selected.length}: ${file.name}`);
        try {
          assertAudioInput(file);
          selectedBytes += file.size;
          if (selectedBytes > 200 * 1024 * 1024) { toast.info("This import reached the 200 MB batch limit. Import remaining tracks separately."); break; }
          const meta = await AudioEngine.readMetadata(file);
          if (controller.signal.aborted) break;
          await LibraryStorage.saveTrack({ id: crypto.randomUUID(), title: meta.title || file.name.replace(/\.[^/.]+$/, ""),
            artist: meta.artist || "Unknown Artist", album: meta.album || "Unknown Album", durationSec: meta.durationSec || 0,
            fileSize: file.size, format: file.name.split(".").pop()?.toLowerCase() || "audio", bitrateKbps: meta.bitrate,
            coverArtBase64: meta.coverArtBase64, favorite: false, dateAdded: new Date().toISOString(), blob: file, isProcessed: false });
          imported++;
        } catch (error) { failed++; toast.error(`${file.name}: ${errorMessage(error)}`); }
      }
      await loadTracks();
      if (controller.signal.aborted) toast.info(`Import cancelled; ${imported} saved track(s) remain in your library.`);
      else if (failed) toast.warning(`${imported} track(s) imported; ${failed} failed.`);
      else toast.success(`${imported} track(s) imported.`);
    } finally { importController.current = null; if (alive.current) { setIsImporting(false); setImportStatus(""); } }
  };

  const trackAction = async (track: LibraryTrack, action: "favorite" | "delete" | "save" | "share") => {
    if (busyRef.current.has(track.id)) return;
    busyRef.current.add(track.id); setBusyIds(new Set(busyRef.current));
    try {
      if (action === "favorite") {
        const favorite = await LibraryStorage.toggleFavorite(track.id);
        setTracks((previous) => previous.map((item) => item.id === track.id ? { ...item, favorite } : item));
      } else if (action === "delete") {
        await LibraryStorage.deleteTrack(track.id);
        setTracks((previous) => previous.filter((item) => item.id !== track.id));
        setActiveTrack((current) => current?.id === track.id ? null : current);
        toast.info("Track removed from the library.");
      } else {
        const result = exportResult(track);
        if (action === "share") await AudioEngine.shareAudio(result);
        else { await AudioEngine.saveProcessedFile(result); toast.success(AudioEngine.isNative() ? "Audio saved." : "Audio download started."); }
      }
    } catch (error) { if (!isCancelled(error)) toast.error(`Track action failed: ${errorMessage(error)}`); }
    finally { busyRef.current.delete(track.id); if (alive.current) setBusyIds(new Set(busyRef.current)); }
  };

  const selectTrack = (track: LibraryTrack) => { setActiveTrack(track); setPlayRequest((request) => request + 1); };
  const query = searchQuery.trim().toLocaleLowerCase();
  const filtered = tracks.filter((track) => (filterMode !== "favorites" || track.favorite) && (filterMode !== "processed" || track.isProcessed))
    .filter((track) => [track.title, track.artist, track.album].some((value) => value.toLocaleLowerCase().includes(query)))
    .sort((a, b) => sortBy === "title" ? a.title.localeCompare(b.title) : sortBy === "size" ? b.fileSize - a.fileSize : new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());

  return <div className={`library-view-container ${activeTrack ? "has-player" : ""}`}>
    <div className="library-header glass-panel">
      <div className="header-top"><div className="title-row"><Library size={22} className="text-accent" /><h2>Device Music Library</h2><span className="badge-pill">{tracks.length} Tracks</span></div>
        <button type="button" className="btn-primary" disabled={isImporting} onClick={() => inputRef.current?.click()}><Plus size={16} />Import Tracks</button>
        <input type="file" ref={inputRef} hidden multiple accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac" aria-label="Import audio tracks into library"
          onChange={(event) => { if (event.target.files?.length) void importFiles(Array.from(event.target.files)); event.target.value = ""; }} />
      </div>
      <div className="library-toolbar"><div className="search-wrap"><Search size={16} className="text-muted" /><input type="search" placeholder="Search title, artist, or album…" aria-label="Search library" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="search-input" /></div>
        <div className="filter-chips" aria-label="Library filters">{(["all", "favorites", "processed"] as const).map((mode) => <button key={mode} type="button" className={`chip ${filterMode === mode ? "active" : ""}`} aria-pressed={filterMode === mode} onClick={() => setFilterMode(mode)}>{mode === "all" ? "All" : mode === "favorites" ? "Favorites" : "Processed"}</button>)}</div>
        <div className="sort-wrap"><Filter size={14} className="text-muted" /><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className="select-input-sm" aria-label="Sort library"><option value="date">Recently Added</option><option value="title">Title A–Z</option><option value="size">File Size</option></select></div>
      </div>
      {isImporting && <div className="import-status" role="status"><p>{importStatus}</p><button type="button" className="btn-secondary btn-sm" onClick={() => importController.current?.abort()}>Cancel Import</button></div>}
    </div>
    {loading && <p className="recovery-panel glass-panel" role="status">Loading saved tracks…</p>}
    {loadError && <div className="recovery-panel glass-panel" role="alert"><p className="text-danger">Library could not be loaded: {loadError}</p><button type="button" className="btn-secondary" onClick={loadTracks}>Retry Loading</button></div>}
    {!loading && !loadError && <div className="library-tracks-grid">
      {!filtered.length ? <div className="empty-library glass-panel recovery-panel"><Disc size={40} className="text-muted" /><h3>No Tracks Found</h3><p className="text-muted">{searchQuery || filterMode !== "all" ? "Try a different search or filter." : "Import audio files or save a processed export to get started."}</p></div> : filtered.map((track) => <article key={track.id} className={`library-track-card glass-panel ${activeTrack?.id === track.id ? "active" : ""}`}>
        <div className="track-cover-slot"><div className="track-thumb-fallback"><Disc size={20} /></div>{track.coverArtBase64 && <img src={track.coverArtBase64} alt="" className="track-thumb" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}
          <button type="button" className="quick-play-overlay" onClick={() => selectTrack(track)} aria-label={`Play ${track.title}`}><Play size={16} /></button>
        </div>
        <div className="track-details"><button type="button" className="track-select" onClick={() => selectTrack(track)} aria-label={`Listen to ${track.title}`}><span className="track-title" title={track.title}>{track.title}</span><span className="track-artist">{track.artist} · {track.album}</span></button>
          <div className="track-meta-row"><span>{formatTime(track.durationSec)}</span><span>·</span><span>{formatBytes(track.fileSize)}</span><span className="format-badge">{track.format.toUpperCase()}</span>{track.isProcessed && <span className="processed-badge">PROCESSED</span>}</div>
        </div>
        <div className="track-action-buttons">
          <button type="button" className={`btn-icon ${track.favorite ? "text-danger" : "text-muted"}`} disabled={busyIds.has(track.id)} onClick={() => trackAction(track, "favorite")} aria-pressed={track.favorite} aria-label={`${track.favorite ? "Unfavorite" : "Favorite"} ${track.title}`} title={track.favorite ? "Unfavorite" : "Favorite"}><Heart size={16} fill={track.favorite ? "currentColor" : "none"} /></button>
          <button type="button" className="btn-icon" disabled={busyIds.has(track.id)} onClick={() => trackAction(track, "save")} aria-label={`Save ${track.title}`} title="Save audio"><Download size={16} /></button>
          <button type="button" className="btn-icon" disabled={busyIds.has(track.id)} onClick={() => trackAction(track, "share")} aria-label={`Share ${track.title}`} title="Share audio"><Share2 size={16} /></button>
          <button type="button" className="btn-icon" disabled={busyIds.has(track.id)} onClick={() => trackAction(track, "delete")} aria-label={`Remove ${track.title} from library`} title="Remove from library"><Trash2 size={16} /></button>
        </div>
      </article>)}
    </div>}
    {activeTrack && <div className="floating-player-bar"><AudioPlayer key={activeTrack.id} blob={activeTrack.blob} src={activeTrack.nativePath ? AudioEngine.nativeFileUrl(activeTrack.nativePath) : undefined} title={activeTrack.title} artist={activeTrack.artist} playRequest={playRequest} /></div>}
  </div>;
};
