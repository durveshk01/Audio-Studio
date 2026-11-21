import React, { useState, useEffect, useRef } from "react";
import { Settings, Cpu, Cloud, Moon, Sun, ShieldCheck, Trash2, RefreshCw, HardDrive, Info } from "lucide-react";
import { toast } from "sonner";
import { LibraryStorage, DEFAULT_SETTINGS, type UserSettings } from "../services/libraryStorage";
import { AudioEngine, type EngineInfo } from "../services/audioEngine";
import { MP3_BITRATES } from "../services/audioEncoding";
import { ApiClient, normalizeBackendUrl, type BackendHealth } from "../services/apiClient";
import { errorMessage } from "../services/errors";
import { formatBytes } from "../services/format";
import { APP_VERSION } from "../../shared/version";
import type { ProjectIndex } from "../../server/projectStore";
import { DEVICE_ONLY } from "../services/runtime";

interface SettingsViewProps {
  engineInfo: EngineInfo | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ engineInfo, theme, onToggleTheme }) => {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [backend, setBackend] = useState<BackendHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [backendDraft, setBackendDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [hasToken, setHasToken] = useState(ApiClient.hasAccessToken());
  const [lastSync, setLastSync] = useState("");
  const [remoteIndex, setRemoteIndex] = useState<ProjectIndex | null>(null);
  const savingRef = useRef(false);
  const healthRequest = useRef(0);
  const alive = useRef(true);

  const checkBackend = async () => {
    const request = ++healthRequest.current;
    setChecking(true);
    const health = await ApiClient.getHealth();
    if (alive.current && request === healthRequest.current) { setBackend(health); setChecking(false); setHasToken(ApiClient.hasAccessToken()); }
  };

  const loadSettings = async () => {
    setLoading(true); setLoadError("");
    try {
      const value = await LibraryStorage.getSettings();
      if (alive.current) { setSettings(value); setBackendDraft(value.backendUrl); }
    } catch (error) { if (alive.current) setLoadError(errorMessage(error)); }
    finally { if (alive.current) setLoading(false); }
  };

  useEffect(() => {
    alive.current = true;
    const invalidateHealth = () => { healthRequest.current++; };
    void loadSettings(); void checkBackend();
    const changed = (event: Event) => setSettings((event as CustomEvent<UserSettings>).detail);
    const backendChanged = () => { setRemoteIndex(null); setLastSync(""); void checkBackend(); };
    window.addEventListener("audio-studio:settings-changed", changed);
    window.addEventListener("audio-studio:backend-changed", backendChanged);
    return () => { alive.current = false; invalidateHealth(); window.removeEventListener("audio-studio:settings-changed", changed); window.removeEventListener("audio-studio:backend-changed", backendChanged); };
  }, []);

  const updateSetting = async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try { await LibraryStorage.saveSettings({ [key]: value }); toast.success("Preference saved."); }
    catch (error) { toast.error(`Preference was not saved: ${errorMessage(error)}`); }
    finally { savingRef.current = false; if (alive.current) setSaving(false); }
  };

  const saveConnection = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const url = normalizeBackendUrl(backendDraft);
      const token = tokenDraft.trim();
      if (token && (token.length < 32 || token.length > 256 || /\s/.test(token))) throw new Error("Use the backend owner token (32–256 characters, without whitespace).");
      await LibraryStorage.saveSettings({ backendUrl: url });
      ApiClient.setBaseUrl(url);
      if (token) ApiClient.setAccessToken(token);
      setBackendDraft(url); setTokenDraft(""); setHasToken(ApiClient.hasAccessToken());
      await checkBackend(); toast.success("Backend preferences saved. Access tokens stay in this session only.");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { savingRef.current = false; if (alive.current) setSaving(false); }
  };

  const syncIndex = async (read = false) => {
    if (isSyncing || !backend?.syncAvailable || !hasToken || (!read && !settings.cloudSyncEnabled)) return;
    setIsSyncing(true);
    try {
      if (read) setRemoteIndex(await ApiClient.getProjectIndex());
      else {
        const tracks = await LibraryStorage.getAllTracks();
        const saved = await ApiClient.syncProjects(tracks.map(({ id, title, artist, album, durationSec, fileSize, format, favorite, dateAdded }) => ({ id, title, artist, album, durationSec, fileSize, format, favorite, dateAdded })));
        setLastSync(saved.syncedAt); toast.success(`Saved an index of ${saved.trackCount} tracks to your authorized backend.`);
      }
    } catch (error) { toast.error(`Index request failed: ${errorMessage(error)}`); }
    finally { if (alive.current) setIsSyncing(false); }
  };

  const clearCache = async () => {
    if (clearing) return;
    setClearing(true);
    try { const removed = await AudioEngine.clearTemporaryCache(); toast.success(`Temporary cache cleared: ${formatBytes(removed)} removed.`); }
    catch (error) { toast.error(`Cache was not cleared: ${errorMessage(error)}`); }
    finally { if (alive.current) setClearing(false); }
  };

  return <div className="settings-view-container">
    <div className="settings-header glass-panel"><div className="title-row"><Settings size={22} className="text-accent" /><h2>Studio Preferences & Diagnostics</h2></div></div>
    {loading && <p role="status" className="recovery-panel glass-panel">Loading preferences…</p>}
    {loadError && <div role="alert" className="recovery-panel glass-panel"><p className="text-danger">Preferences could not be loaded: {loadError}</p><button type="button" className="btn-secondary" onClick={loadSettings}>Retry Loading</button></div>}
    <div className="settings-cards-grid">
      <section className="settings-card glass-panel">
        <div className="card-heading"><Cpu size={18} className="text-accent" /><h3>Local Audio Engine</h3></div>
        <div className="settings-list">
          <div className="setting-item"><span>Platform</span><strong className="badge-pill">{engineInfo?.platform.toUpperCase() || "Checking…"}</strong></div>
          <div className="setting-item"><span>Engine</span><span>{engineInfo?.engineName || "Initializing…"}</span></div>
          <div className="setting-item"><span>Hardware AAC encoder</span><span>{engineInfo ? engineInfo.hardwareAcceleration ? "Available" : "Not reported; software encoders available" : "Checking…"}</span></div>
          <div className="setting-item"><span>Reported CPU threads</span><span>{engineInfo?.availableCores ?? "Not reported"}</span></div>
          <div className="setting-item"><span>Output formats</span><span>{engineInfo?.outputFormats.map((format) => format.toUpperCase()).join(", ") || "Checking…"}</span></div>
        </div>
        <p className="card-desc"><ShieldCheck size={14} className="text-success" />{DEVICE_ONLY ? "All audio processing, metadata, analysis, and cover design run on your device. This APK has no Internet permission." : "Core audio processing stays on your device. Optional index uploads and AI prompts use the backend you configure."}</p>
      </section>

      <fieldset className="settings-card glass-panel" disabled={loading || saving}>
        <legend className="sr-only">Default audio and interface settings</legend>
        <div className="card-heading"><HardDrive size={18} className="text-accent" /><h3>Audio & Interface Defaults</h3></div>
        <div className="settings-list">
          <div className="setting-item-row"><label htmlFor="def-bitrate">Compressed bitrate</label><select id="def-bitrate" value={settings.defaultBitrate} className="select-input-sm" onChange={(event) => updateSetting("defaultBitrate", Number(event.target.value))}>{MP3_BITRATES.map((bitrate) => <option key={bitrate} value={bitrate}>{bitrate} kbps</option>)}</select></div>
          <div className="setting-item-row"><label htmlFor="def-format">Output format</label><select id="def-format" value={settings.defaultFormat} className="select-input-sm" onChange={(event) => updateSetting("defaultFormat", event.target.value as UserSettings["defaultFormat"])}>
            <option value="mp3">MP3</option><option value="m4a" disabled={!engineInfo?.outputFormats.includes("m4a")}>M4A / AAC{engineInfo && !engineInfo.outputFormats.includes("m4a") ? " (unavailable here)" : ""}</option><option value="wav">WAV (16-bit PCM)</option>
          </select></div>
          <p className="card-desc">WAV bitrate follows its sample rate and channels. If a saved encoder is unavailable on this device, the compressor uses MP3.</p>
          <div className="setting-item-row"><span>Interface theme</span><button type="button" className="btn-secondary btn-sm" onClick={onToggleTheme}>{theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}<span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span></button></div>
          <div className="setting-item-row"><label htmlFor="reduced-motion">Reduce interface motion</label><input id="reduced-motion" type="checkbox" checked={settings.reducedMotion} onChange={(event) => updateSetting("reducedMotion", event.target.checked)} /></div>
          <p className="card-desc">Your system's reduced-motion preference is also respected.</p>
        </div>
      </fieldset>

      {!DEVICE_ONLY && <section className="settings-card glass-panel">
        <div className="card-heading"><Cloud size={18} className="text-accent" /><h3>Optional Backend & Library Index</h3></div>
        <p className="card-desc">Sync titles, artists, formats, sizes, and favorites to your private backend index. This does not upload or restore audio files, artwork, or preferences.</p>
        <fieldset className="form-fields" disabled={loading || saving || isSyncing}>
          <legend className="sr-only">Backend connection</legend>
          <div className="form-group"><label htmlFor="backend-url">Backend URL (HTTPS)</label><input id="backend-url" type="url" className="text-input" placeholder="https://your-backend.example" value={backendDraft} onChange={(event) => setBackendDraft(event.target.value)} autoComplete="off" /></div>
          <div className="form-group"><label htmlFor="backend-token">Owner access token (this session only)</label><input id="backend-token" type="password" className="text-input" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} autoComplete="off" maxLength={256} placeholder={hasToken ? "Session token is set" : "Token from your backend administrator"} /></div>
          <button type="button" className="btn-secondary" onClick={saveConnection}>{saving ? "Saving…" : "Save Backend Connection"}</button>
          {hasToken && <button type="button" className="btn-secondary btn-sm" onClick={() => { ApiClient.setAccessToken(""); setHasToken(false); setTokenDraft(""); }}>Clear Session Token</button>}
        </fieldset>
        <div className="setting-item"><span>Backend status</span><span role="status">{checking ? "Checking…" : backend?.ok ? `Connected (${backend.mode}, v${backend.version})` : ApiClient.isConfigured() ? "Unavailable; local processing remains available" : "Not configured; local-only mode"}</span></div>
        <button type="button" className="btn-secondary btn-sm" disabled={checking} onClick={checkBackend}><RefreshCw size={14} />Check Connection</button>
        <div className="setting-item-row"><label htmlFor="enable-index-sync">Allow metadata index upload</label><input id="enable-index-sync" type="checkbox" checked={settings.cloudSyncEnabled} disabled={loading || saving || isSyncing} onChange={(event) => updateSetting("cloudSyncEnabled", event.target.checked)} /></div>
        <div className="header-actions">
          <button type="button" className="btn-secondary" disabled={isSyncing || !settings.cloudSyncEnabled || !backend?.syncAvailable || !hasToken} onClick={() => syncIndex()}><RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />{isSyncing ? "Requesting…" : "Sync Metadata Now"}</button>
          <button type="button" className="btn-secondary" disabled={isSyncing || !backend?.syncAvailable || !hasToken} onClick={() => syncIndex(true)}>View Remote Index</button>
        </div>
        {(!backend?.syncAvailable || !hasToken) && <p className="card-desc">Index operations require an authorized backend with persistent index storage enabled.</p>}
        {lastSync && <p className="card-desc">Last confirmed save: {new Date(lastSync).toLocaleString()}</p>}
        {remoteIndex && <div className="remote-index" role="status"><p>{remoteIndex.tracks.length} remote track(s). Audio files stay on their originating device.</p><ul>{remoteIndex.tracks.slice(0, 20).map((track) => <li key={track.id}>{track.title || "Untitled"} · {track.artist || "Unknown Artist"} · {track.format}</li>)}</ul>{remoteIndex.tracks.length > 20 && <p>Showing the first 20 entries.</p>}</div>}
      </section>}

      <section className="settings-card glass-panel">
        <div className="card-heading"><Info size={18} className="text-accent" /><h3>Storage & Maintenance</h3></div>
        <div className="settings-list"><div className="setting-item"><span>Version</span><span>Audio Studio v{APP_VERSION}</span></div><div className="setting-item"><span>Library storage</span><span>IndexedDB{AudioEngine.isNative() ? " + private native exports" : ""}</span></div></div>
        <p className="card-desc">Clear temporary native staging files and runtime caches. Imported library tracks, persistent exports, preferences, and the offline app shell are retained.</p>
        <button type="button" className="btn-secondary" disabled={clearing} onClick={clearCache}><Trash2 size={14} />{clearing ? "Clearing…" : "Clear Temporary Cache"}</button>
      </section>
    </div>
  </div>;
};
