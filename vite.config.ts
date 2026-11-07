import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("lucide-react")) return "icons";
            if (id.includes("react") || id.includes("react-dom")) return "vendor";
            if (id.includes("jszip") || id.includes("browser-id3-writer")) return "audio-libs";
          }
        }
      }
    }
  },
  server: {
    proxy: {
      "/api": "http://localhost:10000",
      "/health": "http://localhost:10000",
      "/metatune": "http://localhost:10000",
      "/static": "http://localhost:10000",
      "/generate": "http://localhost:10000",
      "/download": "http://localhost:10000"
    }
  }
});
