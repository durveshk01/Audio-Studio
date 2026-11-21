import React from "react";
import {
  Sparkles,
  Music2,
  ShieldCheck,
  Cpu,
  Download,
  Smartphone,
  Zap,
  Tag,
  BarChart3,
  CheckCircle,
  ArrowRight,
  Layers
} from "lucide-react";
import { NavTab } from "../components/Sidebar";
import { APP_VERSION } from "../../shared/version";

interface LandingViewProps {
  onNavigate: (tab: NavTab) => void;
  isNative: boolean;
}

export const LandingView: React.FC<LandingViewProps> = ({
  onNavigate,
  isNative
}) => {
  return (
    <div className="landing-container">
      {/* Hero Section */}
      <section className="landing-hero glass-panel">
        <div className="hero-badge">
          <Cpu size={14} className="text-accent" />
          <span>Device-Powered Audio Architecture</span>
        </div>
        <h1 className="hero-title">
          Big Sound.<br />
          <span className="gradient-text">Zero Cloud Uploads.</span>
        </h1>
        <p className="hero-description">
          Audio Studio transforms your phone and desktop into a professional audio workstation.
          Compress files, edit metadata, generate album art, and analyze loudness locally using your
           device's CPU and available audio encoders.
        </p>

        <div className="hero-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => onNavigate("compressor")}
          >
            <Music2 size={18} />
            <span>Launch Compressor</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => onNavigate("metatune")}
          >
            <Sparkles size={18} />
            <span>Open MetaTune Editor</span>
          </button>
        </div>

        <div className="hero-features-ribbon">
          <div className="ribbon-item">
            <CheckCircle size={14} className="text-success" />
            <span>100% Local Phone Processing</span>
          </div>
          <div className="ribbon-item">
            <CheckCircle size={14} className="text-success" />
            <span>Works Completely Offline</span>
          </div>
          <div className="ribbon-item">
            <CheckCircle size={14} className="text-success" />
            <span>Local CPU & Native AAC</span>
          </div>
          <div className="ribbon-item">
            <CheckCircle size={14} className="text-success" />
            <span>Lossless Metadata Tagging</span>
          </div>
        </div>
      </section>

      {/* Interactive Demonstration Section */}
      <section className="demo-section">
        <div className="section-header">
          <h2>Engineered for Studio Precision</h2>
          <p>Explore what makes Audio Studio the modern audio editing standard.</p>
        </div>

        <div className="demo-grid">
          <button type="button" className="demo-card glass-panel" onClick={() => onNavigate("compressor")}>
            <div className="card-top">
              <div className="icon-wrapper">
                <Music2 size={24} className="text-accent" />
              </div>
              <span className="badge-pill">MP3, M4A & PCM WAV</span>
            </div>
            <h3>Smart Batch Compression</h3>
            <p>
              Choose the output format, bitrate, sample rate, and channels. Compare the actual output size
              and sound; compressed sources may grow when converted at a higher bitrate.
            </p>
            <div className="card-footer-action">
              <span>Try Compressor</span>
              <ArrowRight size={16} />
            </div>
          </button>

          <button type="button" className="demo-card glass-panel" onClick={() => onNavigate("metatune")}>
            <div className="card-top">
              <div className="icon-wrapper">
                <Tag size={24} className="text-accent" />
              </div>
              <span className="badge-pill">ID3v2 & MP4 Atoms</span>
            </div>
            <h3>MetaTune Tags & Cover Design</h3>
            <p>
              Modify tags without re-encoding the audio. Upload cover artwork or create a 1024 × 1024
              cover locally, then embed it into MP3 or standard M4A files.
            </p>
            <div className="card-footer-action">
              <span>Open MetaTune</span>
              <ArrowRight size={16} />
            </div>
          </button>

          <button type="button" className="demo-card glass-panel" onClick={() => onNavigate("tools")}>
            <div className="card-top">
              <div className="icon-wrapper">
                <BarChart3 size={24} className="text-accent" />
              </div>
              <span className="badge-pill">Gated LUFS & FFT Energy</span>
            </div>
            <h3>Deep Audio Analysis</h3>
            <p>
              Measure gated loudness, RMS, sample peaks, estimated intersample peaks, and silence intervals.
              Inspect the measured waveform and export a trimmed region.
            </p>
            <div className="card-footer-action">
              <span>Analyze Track</span>
              <ArrowRight size={16} />
            </div>
          </button>
        </div>
      </section>

      {/* Architecture & Privacy Section */}
      <section className="privacy-section glass-panel">
        <div className="privacy-content">
          <div className="privacy-icon-box">
            <ShieldCheck size={36} className="text-success" />
          </div>
          <div>
            <h2>Your Audio Never Leaves Your Device</h2>
            <p>
              Traditional web compressors force you to upload large audio files to remote servers,
              risking your privacy, chewing mobile data, and stalling on slow connections. Audio Studio executes
              encoding pipelines on your phone's native CPU or desktop browser engine.
            </p>
            <div className="arch-badges">
              <span className="arch-badge"><Cpu size={14} /> Android MediaCodec</span>
              <span className="arch-badge"><Zap size={14} /> Device-Local Encoders</span>
              <span className="arch-badge"><Layers size={14} /> Scoped Storage Compliant</span>
            </div>
          </div>
        </div>
      </section>

      {/* Android App Section */}
      {!isNative && (
        <section className="mobile-download-section glass-panel">
          <div className="download-left">
            <Smartphone size={40} className="text-accent" />
            <div>
              <h3>Get Audio Studio for Android</h3>
              <p>Offline audio processing and system file exports. Android 7.0 or newer.</p>
            </div>
          </div>
          <div className="download-right">
            <a
              href={`https://github.com/durveshk01/Audio-Studio/releases/download/v${APP_VERSION}/Audio-Studio-Release.apk`}
              className="btn-primary"
            >
              <Download size={18} />
              <span>Download Android APK</span>
            </a>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="landing-footer">
        <div>Audio Studio v{APP_VERSION} · Local Device Audio Workstation</div>
        <div className="footer-links">
          <button type="button" onClick={() => onNavigate("compressor")}>Compressor</button>
          <button type="button" onClick={() => onNavigate("metatune")}>MetaTune</button>
          <button type="button" onClick={() => onNavigate("library")}>Library</button>
          <button type="button" onClick={() => onNavigate("tools")}>Tools</button>
        </div>
      </footer>
    </div>
  );
};
