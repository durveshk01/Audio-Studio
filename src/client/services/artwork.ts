import type { AudioMetadata } from "./audioEngine";

function imageDimensions(bytes: Uint8Array): { width: number; height: number; type: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes.slice(0, 8).join() === "137,80,78,71,13,10,26,10") {
    return { width: view.getUint32(16), height: view.getUint32(20), type: "image/png" };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3), type: "image/jpeg" };
      }
      offset += length;
    }
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16), type: "image/webp" };
    if (chunk === "VP8L" && bytes[20] === 47) {
      const dimensions = view.getUint32(21, true);
      return { width: (dimensions & 16383) + 1, height: ((dimensions >>> 14) & 16383) + 1, type: "image/webp" };
    }
    if (chunk === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383, type: "image/webp" };
  }
  throw new Error("Choose a valid JPEG or PNG image; generated WebP artwork is converted to PNG.");
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not render the cover image.")), "image/png"));
}

export async function prepareArtwork(input: Blob): Promise<Blob> {
  if (!input.size || input.size > 8 * 1024 * 1024) throw new Error("Choose artwork up to 8 MB.");
  const bytes = new Uint8Array(await input.arrayBuffer());
  const dimensions = imageDimensions(bytes);
  if (!dimensions.width || !dimensions.height || dimensions.width > 4096 || dimensions.height > 4096) throw new Error("Artwork must be at most 4096 × 4096 pixels.");
  const blob = new Blob([bytes], { type: dimensions.type });
  const bitmap = await createImageBitmap(blob);
  try {
    if (dimensions.type !== "image/webp") return blob;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cover image rendering is unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = await canvasBlob(canvas);
    if (png.size > 8 * 1024 * 1024) throw new Error("Converted cover exceeds the 8 MB limit.");
    return png;
  } finally { bitmap.close(); }
}

export async function designLocalCover(metadata: AudioMetadata, style: "gradient" | "vinyl" | "minimal", accent: string): Promise<Blob> {
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new Error("Choose a valid cover color.");
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cover image rendering is unavailable.");
  const gradient = context.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, accent); gradient.addColorStop(1, "#101526");
  context.fillStyle = style === "minimal" ? "#111827" : gradient; context.fillRect(0, 0, 1024, 1024);
  context.fillStyle = "rgba(0,0,0,0.3)"; context.fillRect(0, 0, 1024, 1024);
  if (style === "vinyl") {
    context.fillStyle = "#080b12"; context.beginPath(); context.arc(700, 340, 280, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#293043"; context.lineWidth = 2;
    for (let radius = 85; radius < 270; radius += 14) { context.beginPath(); context.arc(700, 340, radius, 0, Math.PI * 2); context.stroke(); }
    context.fillStyle = accent; context.beginPath(); context.arc(700, 340, 68, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#111827"; context.beginPath(); context.arc(700, 340, 10, 0, Math.PI * 2); context.fill();
  } else {
    context.strokeStyle = accent; context.lineWidth = style === "minimal" ? 12 : 4;
    for (let i = 0; i < 5; i++) { context.beginPath(); context.arc(820, 180, 100 + i * 55, 0, Math.PI * 2); context.stroke(); }
  }
  context.fillStyle = "#ffffff"; context.textBaseline = "top";
  context.font = "700 76px system-ui, sans-serif";
  const words = (metadata.title || "Untitled").slice(0, 300).split(/\s+/);
  const lines: string[] = []; let line = "";
  for (const word of words) {
    if (line && context.measureText(`${line} ${word}`).width > 840) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((text, index) => context.fillText(text, 80, 620 + index * 86, 840));
  context.font = "400 36px system-ui, sans-serif";
  context.fillStyle = "#e2e8f0"; context.fillText((metadata.artist || "Independent artist").slice(0, 200), 80, 920, 840);
  return canvasBlob(canvas);
}
