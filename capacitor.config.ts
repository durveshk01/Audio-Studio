import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.audiostudio.mobile",
  appName: "Audio Studio",
  webDir: "dist/client",
  server: { hostname: "localhost", androidScheme: "https", errorPath: "startup-help.html" },
  android: { allowMixedContent: false, minWebViewVersion: 99 }
};

export default config;
