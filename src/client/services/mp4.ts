export interface Mp4Box { type: string; start: number; size: number; header: number }

export function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Mp4Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: Mp4Box[] = [];
  for (let offset = start; offset < end;) {
    if (end - offset < 8) throw new Error("Invalid MP4 box header.");
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (end - offset < 16) throw new Error("Invalid extended MP4 box.");
      const extended = view.getBigUint64(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MP4 box exceeds the supported size.");
      size = Number(extended); header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) throw new Error("Invalid MP4 box size.");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    result.push({ type, start: offset, size, header });
    offset += size;
  }
  return result;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export function u32(...values: number[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value));
  return bytes;
}

export function u16(...values: number[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value));
  return bytes;
}

export const fourCC = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(text, (c) => c.charCodeAt(0));
export const zeros = (length: number): Uint8Array<ArrayBuffer> => new Uint8Array(length);

export function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  if (size > 0xffffffff || type.length !== 4) throw new Error("Unsupported MP4 box size or type.");
  return concat(u32(size), fourCC(type), ...parts);
}

const matrix = () => u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

function descriptor(type: number, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  let length = bytes.length;
  const lengths = [length & 127];
  while ((length >>>= 7)) lengths.unshift((length & 127) | 128);
  return concat(Uint8Array.of(type, ...lengths), bytes);
}

/** An ISO BMFF AAC-LC audio track. One contiguous media chunk; each encoded AAC packet is a sample. */
export function muxAac(samples: Uint8Array[], sampleRate: number, channels: number, bitrate: number, config: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!samples.length || !config.length) throw new Error("AAC encoder produced no audio or codec configuration.");
  const ftyp = box("ftyp", fourCC("M4A "), u32(0), fourCC("isom"), fourCC("mp42"));
  const durations = 1024;
  const frameCount = samples.length * durations;
  const movieDuration = Math.round(frameCount * 1000 / sampleRate);
  const esds = box("esds", u32(0), descriptor(3, concat(u16(1), Uint8Array.of(0),
    descriptor(4, concat(Uint8Array.of(0x40, 0x15, 0, 0, 0), u32(bitrate, bitrate), descriptor(5, config))),
    descriptor(6, Uint8Array.of(2)))));
  const entry = box("mp4a", zeros(6), u16(1), zeros(8), u16(channels, 16, 0, 0), u32(sampleRate * 65536), esds);
  const stbl = box("stbl", box("stsd", u32(0, 1), entry), box("stts", u32(0, 1, samples.length, durations)),
    box("stsc", u32(0, 1, 1, samples.length, 1)), box("stsz", u32(0, 0, samples.length, ...samples.map((s) => s.length))),
    box("stco", u32(0, 1, ftyp.length + 8)));
  const minf = box("minf", box("smhd", u32(0), u16(0, 0)), box("dinf", box("dref", u32(0, 1), box("url ", u32(1)))), stbl);
  const mdia = box("mdia", box("mdhd", u32(0, 0, 0, sampleRate, frameCount), u16(0x55c4, 0)),
    box("hdlr", u32(0, 0), fourCC("soun"), zeros(12), new TextEncoder().encode("Audio Studio\0")), minf);
  const trak = box("trak", box("tkhd", u32(7, 0, 0, 1, 0, movieDuration), zeros(8), u16(0, 0, 0x100, 0), matrix(), u32(0, 0)), mdia);
  const mvhd = box("mvhd", u32(0, 0, 0, 1000, movieDuration, 0x10000), u16(0x100, 0), zeros(8), matrix(), zeros(24), u32(2));
  return concat(ftyp, box("mdat", ...samples), box("moov", mvhd, trak));
}
