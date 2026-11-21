import type { AudioMetadata } from "./audioEngine";
import { boxes, box, concat, u32, u16, fourCC, zeros, type Mp4Box } from "./mp4";
import { validateMetadata } from "./metadataValidation";

function raw(bytes: Uint8Array, item: Mp4Box): Uint8Array {
  return bytes.subarray(item.start, item.start + item.size);
}

function replaceChild(parent: Uint8Array, type: string, replacement: Uint8Array | null, prefix = 0): Uint8Array<ArrayBuffer> {
  const header = boxes(parent)[0];
  const children = boxes(parent, header.header + prefix);
  const result: Uint8Array[] = [];
  let found = false;
  for (const child of children) {
    if (child.type === type) {
      if (!found && replacement) result.push(replacement);
      found = true;
    } else result.push(raw(parent, child));
  }
  if (!found && replacement) result.push(replacement);
  return box(header.type, parent.subarray(header.header, header.header + prefix), ...result);
}

function data(type: number, value: Uint8Array): Uint8Array<ArrayBuffer> {
  return box("data", u32(type, 0), value);
}

function patchChunkOffsets(moov: Uint8Array, originalMoovEnd: number, delta: number): void {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  function walk(start: number, end: number) {
    for (const item of boxes(moov, start, end)) {
      const content = item.start + item.header;
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(item.type)) walk(content, item.start + item.size);
      else if (item.type === "stco" || item.type === "co64") {
        if (item.size < item.header + 8) throw new Error("Invalid MP4 sample table.");
        const count = view.getUint32(content + 4);
        const stride = item.type === "stco" ? 4 : 8;
        if (content + 8 + count * stride > item.start + item.size) throw new Error("Invalid MP4 chunk offsets.");
        for (let i = 0; i < count; i++) {
          const offset = content + 8 + i * stride;
          if (stride === 4) {
            const old = view.getUint32(offset);
            if (old >= originalMoovEnd) {
              if (old + delta > 0xffffffff || old + delta < 0) throw new Error("MP4 chunk offset exceeds the supported size.");
              view.setUint32(offset, old + delta);
            }
          } else {
            const old = view.getBigUint64(offset);
            if (old >= BigInt(originalMoovEnd)) view.setBigUint64(offset, old + BigInt(delta));
          }
        }
      }
    }
  }
  walk(0, moov.length);
}

/** Rewrites native iTunes tags while preserving other atoms and all encoded media bytes. */
export async function writeM4aMetadata(input: Blob, metadata: AudioMetadata, artwork?: Blob | null): Promise<Blob> {
  validateMetadata(metadata, artwork);
  const bytes = new Uint8Array(await input.arrayBuffer());
  const top = boxes(bytes);
  const originalMoov = top.find((item) => item.type === "moov");
  if (!top.some((item) => item.type === "ftyp") || !originalMoov || !top.some((item) => item.type === "mdat")) throw new Error("The file is not a valid M4A container.");
  if (top.some((item) => ["moof", "sidx", "mfra"].includes(item.type))) throw new Error("Fragmented M4A metadata editing is not supported. Export a standard M4A file first.");
  let moov = raw(bytes, originalMoov);
  const udtaBox = boxes(moov, boxes(moov)[0].header).find((item) => item.type === "udta");
  let udta = udtaBox ? raw(moov, udtaBox) : box("udta");
  const metaBox = boxes(udta, boxes(udta)[0].header).find((item) => item.type === "meta");
  let meta = metaBox ? raw(udta, metaBox) : box("meta", u32(0), box("hdlr", u32(0, 0), fourCC("mdir"), fourCC("appl"), zeros(9)));
  const metaHeader = boxes(meta)[0].header;
  const children = boxes(meta, metaHeader + 4);
  const handler = children.find((item) => item.type === "hdlr");
  if (handler && String.fromCharCode(...meta.subarray(handler.start + handler.header + 8, handler.start + handler.header + 12)) !== "mdir") {
    throw new Error("This M4A uses a non-iTunes metadata layout. Use the optional MetaTune server for this container.");
  }
  const ilstBox = children.find((item) => item.type === "ilst");
  let ilst = ilstBox ? raw(meta, ilstBox) : box("ilst");
  const fields: Array<[keyof AudioMetadata, string]> = [["title", "©nam"], ["artist", "©ART"], ["album", "©alb"],
    ["albumArtist", "aART"], ["genre", "©gen"], ["year", "©day"], ["composer", "©wrt"], ["lyrics", "©lyr"]];
  for (const [key, atom] of fields) {
    const value = key === "year" ? metadata.year ?? metadata.date : metadata[key];
    if (value === undefined) continue;
    ilst = replaceChild(ilst, atom, value === "" ? null : box(atom, data(1, new TextEncoder().encode(String(value)))));
  }
  if (metadata.genre !== undefined) ilst = replaceChild(ilst, "gnre", null);
  if (metadata.trackNumber !== undefined) {
    const [track, total] = metadata.trackNumber.split("/").map(Number);
    ilst = replaceChild(ilst, "trkn", metadata.trackNumber ? box("trkn", data(0, u16(0, track, total || 0, 0))) : null);
  }
  if (artwork !== undefined) {
    if (artwork && !["image/jpeg", "image/png"].includes(artwork.type)) throw new Error("Embedded artwork must be JPEG or PNG.");
    ilst = replaceChild(ilst, "covr", artwork ? box("covr", data(artwork.type === "image/png" ? 14 : 13, new Uint8Array(await artwork.arrayBuffer()))) : null);
  }
  meta = replaceChild(meta, "ilst", ilst, 4);
  udta = replaceChild(udta, "meta", meta);
  moov = replaceChild(moov, "udta", udta);
  patchChunkOffsets(moov, originalMoov.start + originalMoov.size, moov.length - originalMoov.size);
  const output = concat(...top.map((item) => item === originalMoov ? moov : raw(bytes, item)));
  return new Blob([output], { type: "audio/mp4" });
}
