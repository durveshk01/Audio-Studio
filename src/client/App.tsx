import React, { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { Header } from "./components/Header";
import { Sidebar, NavTab } from "./components/Sidebar";
import { MobileNav } from "./components/MobileNav";
import { LandingView } from "./views/LandingView";
import { CompressorView } from "./views/CompressorView";
import { MetaTuneView } from "./views/MetaTuneView";
import { LibraryView } from "./views/LibraryView";
import { AudioToolsView } from "./views/AudioToolsView";
import { SettingsView } from "./views/SettingsView";
import { AudioEngine, EngineInfo } from "./services/audioEngine";
import { LibraryStorage } from "./services/libraryStorage";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);

  useEffect(() => {
    // 1. Initialize Engine Info
    AudioEngine.getEngineInfo().then((info) => setEngineInfo(info));

    // 2. Load stored theme
    LibraryStorage.getSettings().then((s) => {
      setTheme(s.theme || "dark");
      document.documentElement.setAttribute("data-theme", s.theme || "dark");
    });

    // 3. Sync routing with location hash or path
    const syncRoute = () => {
      const hash = window.location.hash.replace(/^#\/?/, "");
      const path = window.location.pathname.replace(/^\//, "");
      const target = hash || path;

      if (target === "compressor") setActiveTab("compressor");
      else if (target === "metatune") setActiveTab("metatune");
      else if (target === "library") setActiveTab("library");
      else if (target === "tools") setActiveTab("tools");
      else if (target === "settings") setActiveTab("settings");
      else setActiveTab("home");
    };

    syncRoute();
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("hashchange", syncRoute);
    };
  }, []);

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    window.location.hash = tab === "home" ? "" : `/${tab}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    LibraryStorage.saveSettings({ theme: nextTheme });
  };

  const isNative = AudioEngine.isNative();

  return (
    <div className={`audio-studio-app theme-${theme}`}>
      <Toaster theme={theme} position="top-center" richColors />

      <Header
        engineInfo={engineInfo}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="app-shell-body">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          isNative={isNative}
        />

        <main className="app-main-content">
          {activeTab === "home" && (
            <LandingView onNavigate={handleSelectTab} isNative={isNative} />
          )}
          {activeTab === "compressor" && <CompressorView />}
          {activeTab === "metatune" && <MetaTuneView />}
          {activeTab === "library" && <LibraryView />}
          {activeTab === "tools" && <AudioToolsView />}
          {activeTab === "settings" && (
            <SettingsView
              engineInfo={engineInfo}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          )}
        </main>
      </div>

      <MobileNav activeTab={activeTab} onSelectTab={handleSelectTab} />
    </div>
  );
};
