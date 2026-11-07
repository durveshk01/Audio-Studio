import React, { useState, useEffect } from "react";
import {
  Library,
  Search,
  Heart,
  Play,
  Trash2,
  Download,
  Share2,
  Filter,
  Disc,
  Plus
} from "lucide-react";
import { toast } from "sonner";
import { LibraryStorage, LibraryTrack } from "../services/libraryStorage";
import { AudioEngine } from "../services/audioEngine";
import { AudioPlayer } from "../components/AudioPlayer";

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

export const LibraryView: React.FC = () => {
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "favorites" | "processed">("all");
  const [sortBy, setSortBy] = useState<"date" | "title" | "size">("date");
  const [activeTrack, setActiveTrack] = useState<LibraryTrack | null>(null);

  useEffect(() => {
    loadTracks();
  }, []);

  const loadTracks = async () => {
    const list = await LibraryStorage.getAllTracks();
    setTracks(list);
    if (list.length > 0 && !activeTrack) {
      setActiveTrack(list[0]);
    }
  };

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const files = Array.from(e.target.files);
    toast.info(`Importing ${files.length} track(s) to device library…`);

    for (const file of files) {
      const meta = await AudioEngine.readMetadata(file);
      const newTrack: LibraryTrack = {
        id: `lib-${Date.now()}-${Math.random()}`,
        title: meta.title || file.name.replace(/\.[^/.]+$/, ""),
        artist: meta.artist || "Unknown Artist",
        album: meta.album || "Unknown Album",
        durationSec: meta.durationSec || 0,
        fileSize: file.size,
        format: file.name.split(".").pop()?.toLowerCase() || "audio",
        favorite: false,
        dateAdded: new Date().toISOString(),
        blob: file,
        isProcessed: false
      };
      await LibraryStorage.saveTrack(newTrack);
    }

    await loadTracks();
    toast.success("Tracks imported to library!");
    e.target.value = "";
  };

  const toggleFavorite = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isFav = await LibraryStorage.toggleFavorite(id);
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, favorite: isFav } : t))
    );
  };

  const deleteTrack = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await LibraryStorage.deleteTrack(id);
    setTracks((prev) => prev.filter((t) => t.id !== id));
    if (activeTrack?.id === id) {
      setActiveTrack(null);
    }
    toast.info("Track removed from library.");
  };

  const filtered = tracks
    .filter((t) => {
      if (filterMode === "favorites") return t.favorite;
      if (filterMode === "processed") return t.isProcessed;
      return true;
    })
    .filter((t) => {
      const q = searchQuery.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "size") return b.fileSize - a.fileSize;
      return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
    });

  return (
    <div className="library-view-container">
      {/* Header Bar */}
      <div className="library-header glass-panel">
        <div className="header-top">
          <div className="title-row">
            <Library size={22} className="text-accent" />
            <h2>Device Music Library</h2>
            <span className="badge-pill">{tracks.length} Tracks</span>
          </div>

          <label className="btn-primary import-label">
            <Plus size={16} />
            <span>Import Tracks</span>
            <input
              type="file"
              multiple
              accept="audio/*,.mp3,.m4a,.wav,.flac"
              onChange={handleImportFiles}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="library-toolbar">
          <div className="search-wrap">
            <Search size={16} className="text-muted" />
            <input
              type="text"
              placeholder="Search by title, artist, or album…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="filter-chips">
            <button
              type="button"
              className={`chip ${filterMode === "all" ? "active" : ""}`}
              onClick={() => setFilterMode("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`chip ${filterMode === "favorites" ? "active" : ""}`}
              onClick={() => setFilterMode("favorites")}
            >
              Favorites
            </button>
            <button
              type="button"
              className={`chip ${filterMode === "processed" ? "active" : ""}`}
              onClick={() => setFilterMode("processed")}
            >
              Processed
            </button>
          </div>

          <div className="sort-wrap">
            <Filter size={14} className="text-muted" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="select-input-sm"
            >
              <option value="date">Recently Added</option>
              <option value="title">Title A-Z</option>
              <option value="size">File Size</option>
            </select>
          </div>
        </div>
      </div>

      {/* Track List */}
      <div className="library-tracks-grid">
        {filtered.length === 0 ? (
          <div className="empty-library glass-panel text-center">
            <Disc size={40} className="text-muted mx-auto" />
            <h3 className="mt-3">No Tracks Found</h3>
            <p className="text-muted">
              {searchQuery ? "Try a different search query." : "Import your favorite audio files to get started."}
            </p>
          </div>
        ) : (
          filtered.map((track) => {
            const isPlayingThis = activeTrack?.id === track.id;
            return (
              <div
                key={track.id}
                className={`library-track-card glass-panel ${isPlayingThis ? "active" : ""}`}
                onClick={() => setActiveTrack(track)}
              >
                <div className="track-cover-slot">
                  {track.coverArtBase64 ? (
                    <img src={track.coverArtBase64} alt={track.title} className="track-thumb" />
                  ) : (
                    <div className="track-thumb-fallback">
                      <Disc size={20} />
                    </div>
                  )}
                  <button
                    type="button"
                    className="quick-play-overlay"
                    onClick={() => setActiveTrack(track)}
                    aria-label="Play track"
                  >
                    <Play size={16} />
                  </button>
                </div>

                <div className="track-details">
                  <div className="track-title" title={track.title}>{track.title}</div>
                  <div className="track-artist">{track.artist} · {track.album}</div>
                  <div className="track-meta-row">
                    <span>{formatTime(track.durationSec)}</span>
                    <span>·</span>
                    <span>{formatBytes(track.fileSize)}</span>
                    <span>·</span>
                    <span className="format-badge">{track.format.toUpperCase()}</span>
                    {track.isProcessed && (
                      <span className="processed-badge">PROCESSED</span>
                    )}
                  </div>
                </div>

                <div className="track-action-buttons">
                  <button
                    type="button"
                    className={`btn-icon ${track.favorite ? "text-danger" : "text-muted"}`}
                    onClick={(e) => toggleFavorite(track.id, e)}
                    title={track.favorite ? "Unfavorite" : "Favorite"}
                  >
                    <Heart size={16} fill={track.favorite ? "currentColor" : "none"} />
                  </button>

                  <button
                    type="button"
                    className="btn-icon text-muted"
                    onClick={(e) => deleteTrack(track.id, e)}
                    title="Delete track"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Bottom Audio Player when a track is selected */}
      {activeTrack && (
        <div className="floating-player-bar">
          <AudioPlayer
            blob={activeTrack.blob}
            title={activeTrack.title}
            artist={activeTrack.artist}
            duration={activeTrack.durationSec}
          />
        </div>
      )}
    </div>
  );
};
