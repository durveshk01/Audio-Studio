import React from "react";
import { Home, Music2, Sparkles, Library, Sliders } from "lucide-react";
import { NavTab } from "./Sidebar";

interface MobileNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  activeTab,
  onSelectTab
}) => {
  const items = [
    { id: "home" as NavTab, label: "Home", icon: Home },
    { id: "compressor" as NavTab, label: "Compress", icon: Music2 },
    { id: "metatune" as NavTab, label: "MetaTune", icon: Sparkles },
    { id: "library" as NavTab, label: "Library", icon: Library },
    { id: "tools" as NavTab, label: "Tools", icon: Sliders }
  ];

  return (
    <nav className="mobile-bottom-nav">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`mobile-nav-item ${isActive ? "active" : ""}`}
            onClick={() => onSelectTab(item.id)}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
