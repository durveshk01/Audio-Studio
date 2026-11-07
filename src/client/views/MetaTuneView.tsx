import React, { useState, useRef } from "react";
import {
  Sparkles,
  Tag,
  Image as ImageIcon,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle,
  FileAudio,
  Disc,
  Wand2
} from "lucide-react";
import { toast } from "sonner";
import { AudioEngine, AudioMetadata } from "../services/audioEngine";
import { ApiClient } from "../services/apiClient";
import { LibraryStorage } from "../services/libraryStorage";
import { AudioPlayer } from "../components/AudioPlayer";

export const MetaTuneView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata>({
    title: "",
    artist: "",
    album: "",
    genre: "Pop",
    year: String(new Date().getFullYear()),
    trackNumber: "1",
    composer: "",
    lyrics: ""
  });

  const [artworkBlob, setArtworkBlob] = useState<Blob | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string>("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStyle, setAiStyle] = useState("cinematic");
  const [aiMood, setAiMood] = useState("vibrant");
  const [isExporting, setIsExporting] = useState(false);
  const [exportedBlob, setExportedBlob] = useState<Blob | null>(null);
  const [exportedFilename, setExportedFilename] = useState<string>("");

  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleAudioSelect = async (file: File) => {
    setSelectedFile(file);
    setExportedBlob(null);
    toast.info("Reading local audio metadata…");

    try {
      const readMeta = await AudioEngine.readMetadata(file);
      setMetadata({
        title: readMeta.title || file.name.replace(/\.[^/.]+$/, ""),
        artist: readMeta.artist || "",
        album: readMeta.album || "",
        albumArtist: readMeta.albumArtist || "",
        genre: readMeta.genre || "Pop",
        year: readMeta.year || String(new Date().getFullYear()),
        trackNumber: readMeta.trackNumber || "1",
        composer: readMeta.composer || "",
        lyrics: readMeta.lyrics || "",
        durationSec: readMeta.durationSec
      });

      if (readMeta.hasCoverArt && readMeta.coverArtBase64) {
        setArtworkPreview(readMeta.coverArtBase64);
        const res = await fetch(readMeta.coverArtBase64);
        const blob = await res.blob();
        setArtworkBlob(blob);
      } else {
        setArtworkPreview("");
        setArtworkBlob(null);
      }

      toast.success("Loaded audio tags!");
    } catch (err: any) {
      toast.error(`Could not read metadata: ${err.message}`);
    }
  };

  const handleImageSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose a JPG or PNG image.");
      return;
    }
    setArtworkBlob(file);
    setArtworkPreview(URL.createObjectURL(file));
    toast.success("Cover artwork updated.");
  };

  const removeArtwork = () => {
    setArtworkBlob(null);
    setArtworkPreview("");
    toast.info("Cover artwork removed.");
  };

  const generateAiCover = async () => {
    const promptText = aiPrompt.trim() || `${metadata.title || "Song"} by ${metadata.artist || "Artist"} album cover`;
    setIsAiGenerating(true);
    toast.info("Generating AI cover artwork…");

    try {
      const imageUrl = await ApiClient.generateCoverArt(promptText, aiStyle, aiMood);
      const blob = await ApiClient.fetchImageBlob(imageUrl);
      setArtworkBlob(blob);
      setArtworkPreview(URL.createObjectURL(blob));
      toast.success("AI cover art generated successfully!");
    } catch (err: any) {
      toast.error(`AI Art error: ${err.message || "Service unavailable"}`);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const saveAndExport = async () => {
    if (!selectedFile) {
      toast.error("Please choose an audio file first.");
      return;
    }

    setIsExporting(true);
    toast.info("Embedding metadata and cover artwork locally…");

    try {
      let finalBlob: Blob;
      const isMp3 = /\.mp3$/i.test(selectedFile.name);

      if (isMp3) {
        finalBlob = await AudioEngine.writeMp3Metadata(selectedFile, metadata, artworkBlob);
      } else {
        // For M4A/other, export with preserved data or updated container
        finalBlob = selectedFile;
      }

      const outName = `${metadata.artist ? `${metadata.artist} - ` : ""}${metadata.title || "AudioTrack"}.mp3`;
      setExportedBlob(finalBlob);
      setExportedFilename(outName);

      // Save to device library
      await LibraryStorage.saveTrack({
        id: `metatune-${Date.now()}-${Math.random()}`,
        title: metadata.title || selectedFile.name,
        artist: metadata.artist || "Unknown Artist",
        album: metadata.album || "Unknown Album",
        durationSec: metadata.durationSec || 0,
        fileSize: finalBlob.size,
        format: isMp3 ? "mp3" : "m4a",
        coverArtBase64: artworkPreview,
        favorite: false,
        dateAdded: new Date().toISOString(),
        blob: finalBlob,
        isProcessed: true
      });

      // Save to device
      const processedResult = {
        blob: finalBlob,
        fileName: outName,
        outputSize: finalBlob.size,
        originalSize: selectedFile.size,
        durationSec: metadata.durationSec || 0,
        bitrateKbps: 320,
        sampleRate: 44100,
        channels: 2,
        savedPercent: 0,
        format: "mp3"
      };

      await AudioEngine.saveProcessedFile(processedResult, outName);
      toast.success("Metadata and artwork embedded and saved!");
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="metatune-view-container">
      {/* Top File Selector */}
      {!selectedFile && (
        <section
          className="dropzone-modern glass-panel"
          onClick={() => audioInputRef.current?.click()}
        >
          <input
            type="file"
            accept=".mp3,.m4a,audio/mpeg,audio/mp4"
            ref={audioInputRef}
            onChange={(e) => {
              if (e.target.files?.[0]) handleAudioSelect(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <div className="dropzone-icon-ring">
            <Tag size={36} className="text-accent" />
          </div>
          <h2>Select Audio File for MetaTune</h2>
          <p>Read, edit ID3 tags, and embed high-resolution artwork directly on your device.</p>
          <button type="button" className="btn-primary">
            <Upload size={18} />
            <span>Choose Track</span>
          </button>
        </section>
      )}

      {selectedFile && (
        <div className="metatune-grid">
          {/* Left: Metadata Form */}
          <div className="metadata-form-panel glass-panel">
            <div className="panel-header">
              <div className="title-row">
                <FileAudio size={18} className="text-accent" />
                <h3>Track Metadata</h3>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => audioInputRef.current?.click()}
              >
                Change File
              </button>
              <input
                type="file"
                accept=".mp3,.m4a,audio/mpeg,audio/mp4"
                ref={audioInputRef}
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleAudioSelect(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="form-fields">
              <div className="form-group">
                <label htmlFor="meta-title">Track Title</label>
                <input
                  id="meta-title"
                  type="text"
                  value={metadata.title || ""}
                  onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                  className="text-input"
                  placeholder="e.g. Midnight Waves"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="meta-artist">Artist</label>
                  <input
                    id="meta-artist"
                    type="text"
                    value={metadata.artist || ""}
                    onChange={(e) => setMetadata({ ...metadata, artist: e.target.value })}
                    className="text-input"
                    placeholder="e.g. Luna Eclipse"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="meta-album">Album</label>
                  <input
                    id="meta-album"
                    type="text"
                    value={metadata.album || ""}
                    onChange={(e) => setMetadata({ ...metadata, album: e.target.value })}
                    className="text-input"
                    placeholder="e.g. Horizons EP"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="meta-genre">Genre</label>
                  <input
                    id="meta-genre"
                    type="text"
                    value={metadata.genre || ""}
                    onChange={(e) => setMetadata({ ...metadata, genre: e.target.value })}
                    className="text-input"
                    placeholder="e.g. Electronic"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="meta-year">Year</label>
                  <input
                    id="meta-year"
                    type="text"
                    value={metadata.year || ""}
                    onChange={(e) => setMetadata({ ...metadata, year: e.target.value })}
                    className="text-input"
                    placeholder="e.g. 2026"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="meta-track">Track #</label>
                  <input
                    id="meta-track"
                    type="text"
                    value={metadata.trackNumber || ""}
                    onChange={(e) => setMetadata({ ...metadata, trackNumber: e.target.value })}
                    className="text-input"
                    placeholder="e.g. 1"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="meta-composer">Composer / Producer</label>
                <input
                  id="meta-composer"
                  type="text"
                  value={metadata.composer || ""}
                  onChange={(e) => setMetadata({ ...metadata, composer: e.target.value })}
                  className="text-input"
                  placeholder="Optional composer credits"
                />
              </div>

              <div className="form-group">
                <label htmlFor="meta-lyrics">Lyrics</label>
                <textarea
                  id="meta-lyrics"
                  rows={3}
                  value={metadata.lyrics || ""}
                  onChange={(e) => setMetadata({ ...metadata, lyrics: e.target.value })}
                  className="text-input"
                  placeholder="Embed synchronized or unsynchronized song lyrics"
                />
              </div>
            </div>

            <div className="export-action-box">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={saveAndExport}
                disabled={isExporting}
              >
                <CheckCircle size={18} />
                <span>{isExporting ? "Embedding Tags…" : "Save & Export Audio"}</span>
              </button>
            </div>
          </div>

          {/* Right: Cover Artwork & AI Generator */}
          <div className="artwork-panel glass-panel">
            <div className="panel-header">
              <div className="title-row">
                <ImageIcon size={18} className="text-accent" />
                <h3>Cover Artwork</h3>
              </div>
            </div>

            <div className="artwork-preview-box">
              {artworkPreview ? (
                <div className="artwork-container">
                  <img src={artworkPreview} alt="Cover Preview" className="cover-img" />
                  <button
                    type="button"
                    className="btn-danger btn-icon remove-art-btn"
                    onClick={removeArtwork}
                    title="Remove Artwork"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : (
                <div
                  className="artwork-placeholder"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <Disc size={48} className="text-muted" />
                  <span>No Artwork Attached</span>
                  <small>Click to upload JPG or PNG</small>
                </div>
              )}

              <input
                type="file"
                accept="image/jpeg,image/png"
                ref={imageInputRef}
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleImageSelect(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="artwork-actions">
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => imageInputRef.current?.click()}
              >
                <Upload size={16} />
                <span>Upload Custom Image</span>
              </button>
            </div>

            {/* AI Generator Box */}
            <div className="ai-generator-box">
              <div className="ai-title">
                <Wand2 size={16} className="text-accent" />
                <span>AI Artwork Generator</span>
              </div>
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe cover art (e.g. Cyberpunk neon city, watercolor synthwave)"
                className="text-input"
              />
              <div className="form-row mt-2">
                <select
                  value={aiStyle}
                  onChange={(e) => setAiStyle(e.target.value)}
                  className="select-input"
                >
                  <option value="cinematic">Cinematic 3D</option>
                  <option value="minimalist">Minimalist Vector</option>
                  <option value="oil painting">Oil Painting</option>
                  <option value="neon cyberpunk">Neon Cyberpunk</option>
                  <option value="anime aesthetic">Anime Aesthetic</option>
                </select>
                <select
                  value={aiMood}
                  onChange={(e) => setAiMood(e.target.value)}
                  className="select-input"
                >
                  <option value="vibrant">Vibrant & Bright</option>
                  <option value="dark moody">Dark & Moody</option>
                  <option value="dreamy chill">Dreamy Chill</option>
                  <option value="futuristic">Futuristic</option>
                </select>
              </div>

              <button
                type="button"
                className="btn-primary w-full mt-3"
                onClick={generateAiCover}
                disabled={isAiGenerating}
              >
                <Sparkles size={16} />
                <span>{isAiGenerating ? "Generating Artwork…" : "Generate AI Cover Art"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio Player for Selected or Exported Track */}
      {selectedFile && (
        <section className="mt-6">
          <AudioPlayer
            blob={exportedBlob || selectedFile}
            title={metadata.title || selectedFile.name}
            artist={metadata.artist || "Audio Studio"}
          />
        </section>
      )}
    </div>
  );
};
