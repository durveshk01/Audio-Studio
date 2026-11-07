import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true
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
