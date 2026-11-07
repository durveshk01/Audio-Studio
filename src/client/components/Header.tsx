import React from "react";
import { Activity, Sun, Moon, Cpu, Menu } from "lucide-react";
import { EngineInfo } from "../services/audioEngine";

interface HeaderProps {
  engineInfo: EngineInfo | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  engineInfo,
  theme,
  onToggleTheme,
  onOpenMobileMenu
}) => {
  return (
    <header className="app-header">
      <div className="header-left">
        {onOpenMobileMenu && (
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={onOpenMobileMenu}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        )}
        <div className="brand">
          <span className="brand-mark">
            <Activity size={20} />
          </span>
          <span className="brand-title">
            Audio Studio<span className="brand-dot">.</span>
          </span>
        </div>
      </div>

      <div className="header-right">
        <div className="engine-badge" title="Audio processing power source">
          <span className="engine-pulse" />
          <Cpu size={14} className="engine-icon" />
          <span className="engine-text">
            {engineInfo?.isNativeDevicePowered
              ? engineInfo.platform === "android"
                ? "Phone CPU / DSP Hardware"
                : "Local Browser CPU"
              : "Local Engine"}
          </span>
        </div>

        <button
          type="button"
          className="theme-toggle-btn"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
};
