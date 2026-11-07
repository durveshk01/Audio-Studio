import "dotenv/config";
import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.audiostudio.mobile",
  appName: "Audio Studio",
  webDir: "dist/client",
  server: serverUrl ? {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    errorPath: "network-error.html"
  } : undefined
};

export default config;
