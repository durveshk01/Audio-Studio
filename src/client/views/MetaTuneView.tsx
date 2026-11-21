import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Tag,
  Image as ImageIcon,
  Upload,
  Download,
  Trash2,
  CheckCircle,
  FileAudio,
  Disc,
  Wand2
} from "lucide-react";
import { toast } from "sonner";
import { AudioEngine, assertAudioInput, blobToDataUrl, safeFileName, type AudioMetadata, type ProcessedAudioResult } from "../services/audioEngine";
import { ApiClient, type BackendHealth } from "../services/apiClient";
import { LibraryStorage } from "../services/libraryStorage";
import { AudioPlayer } from "../components/AudioPlayer";
import { errorMessage, isCancelled } from "../services/errors";
import { designLocalCover, prepareArtwork } from "../services/artwork";
import { DEVICE_ONLY } from "../services/runtime";

const EMPTY_METADATA: AudioMetadata = { title: "", artist: "", album: "", albumArtist: "", genre: "", year: "", trackNumber: "", composer: "", lyrics: "" };

export const MetaTuneView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata>(EMPTY_METADATA);

  const [artworkBlob, setArtworkBlob] = useState<Blob | null | undefined>(undefined);
  const [artworkPreview, setArtworkPreview] = useState<string>("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStyle, setAiStyle] = useState("cinematic");
  const [aiMood, setAiMood] = useState("vibrant");
  const [isExporting, setIsExporting] = useState(false);
  const [exportedResult, setExportedResult] = useState<ProcessedAudioResult | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [libraryWarning, setLibraryWarning] = useState("");
  const [backend, setBackend] = useState<BackendHealth | null>(null);
  const [coverStyle, setCoverStyle] = useState<"gradient" | "vinyl" | "minimal">("gradient");
  const [coverColor, setCoverColor] = useState("#7c3aed");
  const [isDesigning, setIsDesigning] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef(0);
  const exportLock = useRef(false);
  const aiController = useRef<AbortController | null>(null);
  const busy = isReading || isExporting || isAiGenerating || isDesigning;

  useEffect(() => {
    let disposed = false;
    const invalidateSelection = () => { selectionRef.current++; };
    const refresh = () => { void ApiClient.getHealth().then((health) => { if (!disposed) setBackend(health); }); };
    refresh(); window.addEventListener("audio-studio:backend-changed", refresh);
    return () => { disposed = true; invalidateSelection(); aiController.current?.abort(); window.removeEventListener("audio-studio:backend-changed", refresh); };
  }, []);

  const invalidateExport = () => { setExportedResult(null); setLibraryWarning(""); };
  const updateMetadata = (field: keyof AudioMetadata, value: string) => {
    setMetadata((previous) => ({ ...previous, [field]: value })); invalidateExport();
  };

  const handleAudioSelect = async (file: File) => {
    if (exportLock.current) return;
    if (!/\.(mp3|m4a)$/i.test(file.name)) { toast.error("Metadata editing supports MP3 and M4A files."); return; }
    try { assertAudioInput(file); }
    catch (error) { toast.error(errorMessage(error)); return; }
    const selection = ++selectionRef.current;
    aiController.current?.abort();
    setSelectedFile(file);
    invalidateExport(); setMetadata(EMPTY_METADATA); setArtworkBlob(undefined); setArtworkPreview("");
    setReadError(""); setIsReading(true);

    try {
      const readMeta = await AudioEngine.readMetadata(file);
      if (selection !== selectionRef.current) return;
      setMetadata({
        ...readMeta,
        title: readMeta.title || "",
        artist: readMeta.artist || "",
        album: readMeta.album || "",
        albumArtist: readMeta.albumArtist || "",
        genre: readMeta.genre || "",
        year: readMeta.year || "",
        trackNumber: readMeta.trackNumber || "",
        composer: readMeta.composer || "",
        lyrics: readMeta.lyrics || "",
        durationSec: readMeta.durationSec
      });

      setArtworkPreview(readMeta.coverArtBase64 || "");
    } catch (error) {
      if (selection === selectionRef.current) { setReadError(errorMessage(error)); toast.error(`Could not read metadata: ${errorMessage(error)}`); }
    } finally { if (selection === selectionRef.current) setIsReading(false); }
  };

  const applyArtwork = async (input: Blob, selection = selectionRef.current) => {
    const blob = await prepareArtwork(input);
    const preview = await blobToDataUrl(blob);
    if (selection !== selectionRef.current) return;
    setArtworkBlob(blob); setArtworkPreview(preview); invalidateExport();
  };

  const handleImageSelect = async (file: File) => {
    setIsDesigning(true);
    try { await applyArtwork(file); toast.success("Cover artwork updated."); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setIsDesigning(false); }
  };

  const removeArtwork = () => {
    setArtworkBlob(null);
    setArtworkPreview("");
    invalidateExport();
  };

  const createLocalCover = async () => {
    setIsDesigning(true);
    try { await applyArtwork(await designLocalCover(metadata, coverStyle, coverColor)); toast.success("Local cover created; export to embed it."); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setIsDesigning(false); }
  };

  const generateAiCover = async () => {
    if (!backend?.coverGenerationAvailable || !ApiClient.hasAccessToken()) { toast.info("Configure an authorized artwork backend in Settings first."); return; }
    const selection = selectionRef.current;
    const controller = new AbortController(); aiController.current = controller;
    const promptText = aiPrompt.trim() || `${metadata.title || "Song"} by ${metadata.artist || "Artist"} album cover`;
    setIsAiGenerating(true);
    toast.info("Generating AI cover artwork…");

    try {
      const blob = await ApiClient.generateCoverArt(promptText, aiStyle, aiMood, controller.signal);
      if (controller.signal.aborted) return;
      await applyArtwork(blob, selection);
      if (selection === selectionRef.current) toast.success("AI cover received; export to embed it.");
    } catch (error) {
      if (!isCancelled(error)) toast.error(`AI artwork failed: ${errorMessage(error)}`);
    } finally {
      setIsAiGenerating(false);
      aiController.current = null;
    }
  };

  const saveAndExport = async () => {
    if (!selectedFile) {
      toast.error("Please choose an audio file first.");
      return;
    }
    if (busy || readError || exportLock.current) return;

    exportLock.current = true; setIsExporting(true); setLibraryWarning("");
    toast.info("Embedding metadata and cover artwork locally…");

    try {
      const finalBlob = await AudioEngine.writeMetadata(selectedFile, metadata, artworkBlob);
      const actual = await AudioEngine.readMetadata(finalBlob);
      const format = /\.mp3$/i.test(selectedFile.name) ? "mp3" : "m4a";
      const outName = `${safeFileName(`${metadata.artist ? `${metadata.artist} - ` : ""}${metadata.title || selectedFile.name.replace(/\.[^/.]+$/, "")}`)}.${format}`;
      const processedResult: ProcessedAudioResult = { blob: finalBlob, fileName: outName, outputSize: finalBlob.size, originalSize: selectedFile.size,
        durationSec: actual.durationSec || 0, bitrateKbps: actual.bitrate || 0, sampleRate: actual.sampleRate || 0, channels: actual.channels || 0,
        savedPercent: Math.round((selectedFile.size - finalBlob.size) / selectedFile.size * 100), format, metadata: actual };
      setExportedResult(processedResult);

      // Save to device library
      try { await LibraryStorage.saveTrack({
        id: crypto.randomUUID(),
        title: metadata.title || selectedFile.name,
        artist: metadata.artist || "Unknown Artist",
        album: metadata.album || "Unknown Album",
        durationSec: processedResult.durationSec,
        fileSize: finalBlob.size,
        format,
        bitrateKbps: actual.bitrate,
        coverArtBase64: actual.coverArtBase64,
        favorite: false,
        dateAdded: new Date().toISOString(),
        blob: finalBlob,
        isProcessed: true
      }); } catch (error) { setLibraryWarning(errorMessage(error)); toast.warning(`Export ready, but library save failed: ${errorMessage(error)}`); }

      await AudioEngine.saveProcessedFile(processedResult, outName);
      toast.success(AudioEngine.isNative() ? "Tagged audio saved." : "Tagged audio download started.");
    } catch (error) {
      if (isCancelled(error)) toast.info("Save cancelled; the prepared export remains available.");
      else toast.error(`Export failed: ${errorMessage(error)}`);
    } finally {
      setIsExporting(false); exportLock.current = false;
    }
  };

  return (
    <div className="metatune-view-container">
      <input type="file" accept=".mp3,.m4a,audio/mpeg,audio/mp4" ref={audioInputRef} hidden aria-label="Audio file for metadata editing"
        onChange={(event) => { if (event.target.files?.[0]) void handleAudioSelect(event.target.files[0]); event.target.value = ""; }} />
      {selectedFile && <div className="workspace-toolbar glass-panel">
        <span className="file-name">{selectedFile.name}</span>
        <button type="button" className="btn-secondary btn-sm" disabled={isExporting || isAiGenerating || isDesigning} onClick={() => audioInputRef.current?.click()}>Change File</button>
      </div>}
      {isReading && <p className="glass-panel recovery-panel" role="status">Reading local audio tags…</p>}
      {readError && <p className="glass-panel recovery-panel text-danger" role="alert">Could not load this track: {readError}. Choose another MP3 or M4A file.</p>}
      {/* Top File Selector */}
      {!selectedFile && (
        <section
          className="dropzone-modern glass-panel"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files[0]) void handleAudioSelect(event.dataTransfer.files[0]); }}
        >
          <div className="dropzone-icon-ring">
            <Tag size={36} className="text-accent" />
          </div>
          <h2>Select Audio File for MetaTune</h2>
          <p>Edit MP3 ID3 tags or standard M4A tags and embed cover artwork locally. Up to 100 MB.</p>
          <button type="button" className="btn-primary" onClick={() => audioInputRef.current?.click()}>
            <Upload size={18} />
            <span>Choose Track</span>
          </button>
        </section>
      )}

      {selectedFile && (
        <div className="metatune-grid">
          {/* Left: Metadata Form */}
          <fieldset className="metadata-form-panel glass-panel" disabled={busy || Boolean(readError)}>
            <legend className="sr-only">Track metadata</legend>
            <div className="panel-header">
              <div className="title-row">
                <FileAudio size={18} className="text-accent" />
                <h3>Track Metadata</h3>
              </div>
              <span className="badge-pill">{selectedFile.name.split(".").pop()?.toUpperCase()}</span>
            </div>

            <div className="form-fields">
              <div className="form-group">
                <label htmlFor="meta-title">Track Title</label>
                <input
                  id="meta-title"
                  type="text"
                  value={metadata.title || ""}
                  onChange={(e) => updateMetadata("title", e.target.value)}
                  maxLength={500}
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
                    onChange={(e) => updateMetadata("artist", e.target.value)}
                    maxLength={500}
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
                    onChange={(e) => updateMetadata("album", e.target.value)}
                    maxLength={500}
                    className="text-input"
                    placeholder="e.g. Horizons EP"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="meta-album-artist">Album Artist</label>
                <input id="meta-album-artist" className="text-input" value={metadata.albumArtist || ""} maxLength={500} onChange={(event) => updateMetadata("albumArtist", event.target.value)} />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="meta-genre">Genre</label>
                  <input
                    id="meta-genre"
                    type="text"
                    value={metadata.genre || ""}
                    onChange={(e) => updateMetadata("genre", e.target.value)}
                    maxLength={200}
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
                    onChange={(e) => updateMetadata("year", e.target.value)}
                    maxLength={10}
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
                    onChange={(e) => updateMetadata("trackNumber", e.target.value)}
                    maxLength={20}
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
                  onChange={(e) => updateMetadata("composer", e.target.value)}
                  maxLength={500}
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
                  onChange={(e) => updateMetadata("lyrics", e.target.value)}
                  maxLength={100000}
                  className="text-input"
                  placeholder="Embed plain, unsynchronized song lyrics"
                />
              </div>
            </div>

            <div className="export-action-box">
              <p className="card-desc">Empty fields remove those tags. Existing artwork is preserved until replaced or removed. Audio is not re-encoded.</p>
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
          </fieldset>

          {/* Right: Cover Artwork & AI Generator */}
          <fieldset className="artwork-panel glass-panel" disabled={busy || Boolean(readError)}>
            <legend className="sr-only">Cover artwork</legend>
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
                    aria-label="Remove artwork from export"
                    title="Remove Artwork"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : (
                <button type="button"
                  className="artwork-placeholder"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <Disc size={48} className="text-muted" />
                  <span>No Artwork Attached</span>
                  <small>Click to upload JPG or PNG</small>
                </button>
              )}

              <input
                type="file"
                accept="image/jpeg,image/png"
                ref={imageInputRef}
                aria-label="Cover artwork image"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleImageSelect(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="ai-generator-box">
              <div className="ai-title"><ImageIcon size={16} className="text-accent" /><span>Local Cover Designer</span></div>
              <p className="card-desc">Create a 1024 × 1024 PNG from your title, artist, style, and color. Works offline.</p>
              <div className="form-row mt-3">
                <div className="form-group"><label htmlFor="cover-style">Cover style</label>
                  <select id="cover-style" className="select-input" value={coverStyle} onChange={(event) => setCoverStyle(event.target.value as typeof coverStyle)}>
                    <option value="gradient">Gradient</option><option value="vinyl">Vinyl</option><option value="minimal">Minimal</option>
                  </select>
                </div>
                <div className="form-group"><label htmlFor="cover-color">Accent color</label><input id="cover-color" type="color" value={coverColor} onChange={(event) => setCoverColor(event.target.value)} /></div>
              </div>
              <button type="button" className="btn-secondary w-full mt-3" onClick={createLocalCover}>{isDesigning ? "Rendering Cover…" : "Create Local Cover"}</button>
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
            {!DEVICE_ONLY && <div className="ai-generator-box">
              <div className="ai-title">
                <Wand2 size={16} className="text-accent" />
                <span>AI Artwork Generator</span>
              </div>
              <p className="card-desc">{backend?.coverGenerationAvailable && ApiClient.hasAccessToken() ? "Online provider available. Only your prompt is sent when you generate." : "Requires a configured, authorized artwork backend in Settings. Local cover design is available above."}</p>
              <label className="sr-only" htmlFor="ai-cover-prompt">AI cover prompt</label>
              <input
                id="ai-cover-prompt"
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe cover art (e.g. Cyberpunk neon city, watercolor synthwave)"
                className="text-input"
                maxLength={1000}
              />
              <div className="form-row mt-2">
                <select
                  value={aiStyle}
                  onChange={(e) => setAiStyle(e.target.value)}
                  className="select-input"
                  aria-label="AI artwork style"
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
                  aria-label="AI artwork mood"
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
                disabled={isAiGenerating || !backend?.coverGenerationAvailable || !ApiClient.hasAccessToken()}
              >
                <Sparkles size={16} />
                <span>{isAiGenerating ? "Generating Artwork…" : "Generate AI Cover Art"}</span>
              </button>
            </div>}
          </fieldset>
        </div>
      )}

      {isAiGenerating && <button type="button" className="btn-secondary mt-3" onClick={() => aiController.current?.abort()}>Cancel AI Request</button>}
      {exportedResult && <section className="glass-panel recovery-panel mt-6" aria-label="Prepared metadata export">
        <p>Export ready: <strong>{exportedResult.fileName}</strong></p>
        {libraryWarning && <p className="text-warning" role="status">Library save failed: {libraryWarning}. The export is still available.</p>}
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => { void AudioEngine.saveProcessedFile(exportedResult).catch((error: unknown) => { if (!isCancelled(error)) toast.error(errorMessage(error)); }); }}><Download size={16} />Save Prepared Export</button>
      </section>}
      {/* Audio Player for Selected or Exported Track */}
      {selectedFile && (
        <section className="mt-6">
          <AudioPlayer
            blob={exportedResult?.blob || selectedFile}
            title={metadata.title || selectedFile.name}
            artist={metadata.artist || "Audio Studio"}
          />
        </section>
      )}
    </div>
  );
};
