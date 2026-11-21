import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AudioEngine } from "./services/audioEngine";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}

if (import.meta.env.PROD && !AudioEngine.isNative() && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => console.warn("Offline app shell registration failed:", error));
  }, { once: true });
}
