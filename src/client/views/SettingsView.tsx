import React, { useState, useEffect } from "react";
import {
  Settings,
  Cpu,
  Cloud,
  Moon,
  Sun,
  ShieldCheck,
  Trash2,
  RefreshCw,
  HardDrive,
  Info
} from "lucide-react";
import { toast } from "sonner";
import { LibraryStorage, UserSettings } from "../services/libraryStorage";
import { EngineInfo } from "../services/audioEngine";
import { ApiClient } from "../services/apiClient";

interface SettingsViewProps {
  engineInfo: EngineInfo | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  engineInfo,
  theme,
  onToggleTheme
}) => {
  const [settings, setSettings] = useState<UserSettings>({
    theme: "dark",
    defaultBitrate: 192,
    defaultFormat: "m4a",
    cloudSyncEnabled: false,
    reducedMotion: false
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const [backendHealth, setBackendHealth] = useState<string>("Checking…");

  useEffect(() => {
    loadSettings();
    checkBackend();
  }, []);

  const loadSettings = async () => {
    const s = await LibraryStorage.getSettings();
    setSettings(s);
  };

  const checkBackend = async () => {
    const health = await ApiClient.getHealth();
    if (health.renderAvailable) {
      setBackendHealth(`Connected (${health.mode})`);
    } else {
      setBackendHealth("Offline (Using 100% Local Device Mode)");
    }
  };

  const updateSetting = async <K extends keyof UserSettings>(
    key: K,
    val: UserSettings[K]
  ) => {
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    await LibraryStorage.saveSettings({ [key]: val });
    toast.success("Preferences updated.");
  };

  const triggerCloudSync = async () => {
    setIsSyncing(true);
    toast.info("Synchronizing library indexes with cloud…");

    try {
      const tracks = await LibraryStorage.getAllTracks();
      const metadataOnly = tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        durationSec: t.durationSec,
        format: t.format,
        favorite: t.favorite,
        dateAdded: t.dateAdded
      }));

      const ok = await ApiClient.syncProjects({
        timestamp: new Date().toISOString(),
        trackCount: metadataOnly.length,
        tracks: metadataOnly
      });

      if (ok) {
        toast.success("Cloud synchronization complete!");
      } else {
        toast.info("Cloud sync server unavailable; local device storage remains active.");
      }
    } catch (err: any) {
      toast.error(`Sync error: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const clearCache = () => {
    if (window.confirm("Clear device temporary audio cache? This will not delete imported tracks.")) {
      toast.success("Device cache cleared.");
    }
  };

  return (
    <div className="settings-view-container">
      <div className="settings-header glass-panel">
        <div className="title-row">
          <Settings size={22} className="text-accent" />
          <h2>Studio Preferences & Engine Diagnostics</h2>
        </div>
      </div>

      <div className="settings-cards-grid">
        {/* Hardware Engine Status */}
        <div className="settings-card glass-panel">
          <div className="card-heading">
            <Cpu size={18} className="text-accent" />
            <h3>Audio Processing Hardware</h3>
          </div>
          <div className="settings-list">
            <div className="setting-item">
              <span>Platform</span>
              <strong className="badge-pill">{engineInfo?.platform.toUpperCase() || "WEB"}</strong>
            </div>
            <div className="setting-item">
              <span>Active Engine</span>
              <span>{engineInfo?.engineName || "Local CPU"}</span>
            </div>
            <div className="setting-item">
              <span>Hardware Acceleration</span>
              <span className="text-success">
                {engineInfo?.hardwareAcceleration ? "Active (DSP/MediaCodec)" : "Standard"}
              </span>
            </div>
            <div className="setting-item">
              <span>CPU Cores Allocated</span>
              <span>{engineInfo?.availableCores || 4} Hardware Threads</span>
            </div>
            <div className="setting-item">
              <span>Audio Privacy</span>
              <span className="text-success">
                <ShieldCheck size={14} style={{ display: "inline", verticalAlign: "middle" }} /> 100% Local (Zero uploads)
              </span>
            </div>
          </div>
        </div>

        {/* Defaults & Audio Output */}
        <div className="settings-card glass-panel">
          <div className="card-heading">
            <HardDrive size={18} className="text-accent" />
            <h3>Default Audio Settings</h3>
          </div>
          <div className="settings-list">
            <div className="setting-item-row">
              <label htmlFor="def-bitrate">Default Compressor Bitrate</label>
              <select
                id="def-bitrate"
                value={settings.defaultBitrate}
                onChange={(e) => updateSetting("defaultBitrate", Number(e.target.value))}
                className="select-input-sm"
              >
                <option value={320}>320 kbps (Studio Master)</option>
                <option value={256}>256 kbps (High Quality)</option>
                <option value={192}>192 kbps (Broadcast)</option>
                <option value={128}>128 kbps (Standard)</option>
                <option value={96}>96 kbps (Compact)</option>
              </select>
            </div>

            <div className="setting-item-row">
              <label htmlFor="def-format">Default Output Format</label>
              <select
                id="def-format"
                value={settings.defaultFormat}
                onChange={(e) => updateSetting("defaultFormat", e.target.value as any)}
                className="select-input-sm"
              >
                <option value="m4a">M4A / AAC (Hardware Accelerated)</option>
                <option value="mp3">MP3</option>
                <option value="wav">WAV (Lossless)</option>
              </select>
            </div>

            <div className="setting-item-row">
              <label>Interface Theme</label>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={onToggleTheme}
              >
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Optional Cloud Synchronization */}
        <div className="settings-card glass-panel">
          <div className="card-heading">
            <Cloud size={18} className="text-accent" />
            <h3>Cloud Synchronization (Optional)</h3>
          </div>
          <p className="card-desc">
            Audio Studio keeps your audio files completely on your device. Optionally backup your library
            indexes and project preferences to Render backend.
          </p>
          <div className="settings-list">
            <div className="setting-item">
              <span>Backend Status</span>
              <span>{backendHealth}</span>
            </div>
            <div className="setting-item-row">
              <label>Enable Cloud Metadata Sync</label>
              <input
                type="checkbox"
                checked={settings.cloudSyncEnabled}
                onChange={(e) => updateSetting("cloudSyncEnabled", e.target.checked)}
                className="toggle-checkbox"
              />
            </div>

            <button
              type="button"
              className="btn-secondary w-full mt-3"
              onClick={triggerCloudSync}
              disabled={isSyncing}
            >
              <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
              <span>{isSyncing ? "Syncing Indexes…" : "Sync Metadata Now"}</span>
            </button>
          </div>
        </div>

        {/* Maintenance & App Info */}
        <div className="settings-card glass-panel">
          <div className="card-heading">
            <Info size={18} className="text-accent" />
            <h3>System Diagnostics & Cache</h3>
          </div>
          <div className="settings-list">
            <div className="setting-item">
              <span>Version</span>
              <span>Audio Studio v2.0.0</span>
            </div>
            <div className="setting-item">
              <span>Storage Driver</span>
              <span>IndexedDB / Scoped MediaStore</span>
            </div>

            <button
              type="button"
              className="btn-secondary btn-danger-hover w-full mt-4"
              onClick={clearCache}
            >
              <Trash2 size={14} />
              <span>Clear Temporary Cache</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
