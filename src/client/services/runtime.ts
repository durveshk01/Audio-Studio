import { Capacitor } from "@capacitor/core";

/** Android is deliberately device-only, even if an old backend preference is saved. */
export const DEVICE_ONLY = Capacitor.isNativePlatform() || import.meta.env?.VITE_DEVICE_ONLY === "true";
