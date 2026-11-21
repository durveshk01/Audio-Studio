import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Toaster, toast } from "sonner";
import { Header } from "./components/Header";
import { Sidebar, type NavTab } from "./components/Sidebar";
import { MobileNav } from "./components/MobileNav";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LandingView } from "./views/LandingView";
import { AudioEngine, type EngineInfo } from "./services/audioEngine";
import { LibraryStorage, type UserSettings } from "./services/libraryStorage";
import { ApiClient } from "./services/apiClient";
import { errorMessage } from "./services/errors";

const CompressorView = lazy(() => import("./views/CompressorView").then((m) => ({ default: m.CompressorView })));
const MetaTuneView = lazy(() => import("./views/MetaTuneView").then((m) => ({ default: m.MetaTuneView })));
const LibraryView = lazy(() => import("./views/LibraryView").then((m) => ({ default: m.LibraryView })));
const AudioToolsView = lazy(() => import("./views/AudioToolsView").then((m) => ({ default: m.AudioToolsView })));
const SettingsView = lazy(() => import("./views/SettingsView").then((m) => ({ default: m.SettingsView })));
const retainedTabs: NavTab[] = ["compressor", "metatune", "tools"];
const routeTabs: NavTab[] = ["home", ...retainedTabs, "library", "settings"];

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [visited, setVisited] = useState<NavTab[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const activeRef = useRef(activeTab); activeRef.current = activeTab;

  useEffect(() => { window.dispatchEvent(new Event("audio-studio:navigate")); }, [activeTab]);

  useEffect(() => {
    let disposed = false;
    AudioEngine.getEngineInfo().then((info) => { if (!disposed) setEngineInfo(info); })
      .catch((error: unknown) => toast.error(`Audio engine initialization failed: ${errorMessage(error)}`));
    const applySettings = (settings: UserSettings) => {
      setTheme(settings.theme);
      document.documentElement.dataset.theme = settings.theme;
      document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
      ApiClient.setBaseUrl(settings.backendUrl);
    };
    LibraryStorage.getSettings().then((settings) => { if (!disposed) applySettings(settings); })
      .catch((error: unknown) => toast.warning(`Preferences could not be loaded: ${errorMessage(error)}`));
    const changed = (event: Event) => applySettings((event as CustomEvent<UserSettings>).detail);
    const syncRoute = () => {
      const target = window.location.hash.replace(/^#\/?/, "") || window.location.pathname.replace(/^\//, "");
      const tab = routeTabs.includes(target as NavTab) ? target as NavTab : "home";
      setActiveTab(tab);
      if (retainedTabs.includes(tab)) setVisited((tabs) => tabs.includes(tab) ? tabs : [...tabs, tab]);
    };
    syncRoute();
    window.addEventListener("audio-studio:settings-changed", changed);
    window.addEventListener("popstate", syncRoute); window.addEventListener("hashchange", syncRoute);
    return () => {
      disposed = true;
      window.removeEventListener("audio-studio:settings-changed", changed);
      window.removeEventListener("popstate", syncRoute); window.removeEventListener("hashchange", syncRoute);
    };
  }, []);

  useEffect(() => {
    if (!AudioEngine.isNative()) return;
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    void import("@capacitor/app").then(async ({ App: NativeApp }) => {
      const listener = await NativeApp.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack && activeRef.current !== "home") window.history.back();
        else if (activeRef.current !== "home") window.location.hash = "/home";
        else if (AudioEngine.isProcessing()) toast.info("Finish or cancel the current audio operation before closing.");
        else void NativeApp.exitApp();
      });
      if (disposed) await listener.remove(); else remove = () => listener.remove();
    });
    return () => { disposed = true; void remove?.(); };
  }, []);

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    if (retainedTabs.includes(tab)) setVisited((tabs) => tabs.includes(tab) ? tabs : [...tabs, tab]);
    window.location.hash = tab === "home" ? "/home" : `/${tab}`;
    const reduce = document.documentElement.dataset.reducedMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const toggleTheme = async () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme); document.documentElement.dataset.theme = nextTheme;
    try { await LibraryStorage.saveSettings({ theme: nextTheme }); }
    catch (error) { toast.warning(`Theme changed for this session; preferences were not saved: ${errorMessage(error)}`); }
  };

  return <div className={`audio-studio-app theme-${theme}`}>
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to workspace</a>
    <Toaster theme={theme} position="top-center" richColors />
    <Header engineInfo={engineInfo} theme={theme} onToggleTheme={toggleTheme} />
    <div className="app-shell-body">
      <Sidebar activeTab={activeTab} onSelectTab={handleSelectTab} isNative={AudioEngine.isNative()} />
      <main id="main-content" className="app-main-content" tabIndex={-1}>
        <ErrorBoundary><Suspense fallback={<div className="glass-panel recovery-panel" role="status">Loading workspace…</div>}>
          {activeTab === "home" && <LandingView onNavigate={handleSelectTab} isNative={AudioEngine.isNative()} />}
          {visited.map((tab) => <section key={tab} className="studio-view" hidden={activeTab !== tab} aria-label={`${tab} workspace`}>
            {tab === "compressor" && <CompressorView />}
            {tab === "metatune" && <MetaTuneView />}
            {tab === "tools" && <AudioToolsView />}
          </section>)}
          {activeTab === "library" && <LibraryView />}
          {activeTab === "settings" && <SettingsView engineInfo={engineInfo} theme={theme} onToggleTheme={toggleTheme} />}
        </Suspense></ErrorBoundary>
      </main>
    </div>
    <MobileNav activeTab={activeTab} onSelectTab={handleSelectTab} />
  </div>;
};
