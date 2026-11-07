import React from "react";
import {
  Home,
  Music2,
  Sparkles,
  Library,
  Sliders,
  Settings,
  ShieldCheck,
  Smartphone
} from "lucide-react";

export type NavTab =
  | "home"
  | "compressor"
  | "metatune"
  | "library"
  | "tools"
  | "settings";

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isNative: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isNative
}) => {
  const navItems = [
    { id: "home" as NavTab, label: "Studio Hub", icon: Home },
    { id: "compressor" as NavTab, label: "Compressor", icon: Music2 },
    { id: "metatune" as NavTab, label: "MetaTune", icon: Sparkles },
    { id: "library" as NavTab, label: "Music Library", icon: Library },
    { id: "tools" as NavTab, label: "Audio Tools", icon: Sliders },
    { id: "settings" as NavTab, label: "Settings", icon: Settings }
  ];

  return (
    <aside className="app-sidebar">
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-link ${isActive ? "active" : ""}`}
              onClick={() => onSelectTab(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {isActive && <div className="active-indicator" />}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="privacy-pill">
          <ShieldCheck size={16} className="text-success" />
          <div>
            <strong>100% Private</strong>
            <small>Audio stays on your device</small>
          </div>
        </div>

        {isNative ? (
          <div className="device-spec-box">
            <Smartphone size={14} />
            <span>Android Hardware Mode</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
};
