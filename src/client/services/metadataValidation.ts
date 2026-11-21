import type { AudioMetadata } from "./audioEngine";

export function validateMetadata(metadata: AudioMetadata, artwork?: Blob | null): void {
  const year = metadata.year ?? metadata.date;
  if (year) {
    if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(year)) throw new Error("Year must be four digits or an ISO date.");
    const [, month, day] = year.split("-").map(Number);
    if (month !== undefined && (month < 1 || month > 12)) throw new Error("Choose a valid month in the ISO date.");
    if (day !== undefined) {
      const date = new Date(`${year}T00:00:00Z`);
      if (day < 1 || !Number.isFinite(date.getTime()) || date.getUTCDate() !== day || date.getUTCMonth() + 1 !== month) throw new Error("Choose a valid calendar date.");
    }
  }
  if (metadata.trackNumber) {
    const parts = metadata.trackNumber.split("/").map(Number);
    if (!/^\d{1,5}(?:\/\d{1,5})?$/.test(metadata.trackNumber) || parts.some((part) => part > 65535)
      || (parts.length === 2 && parts[1] > 0 && parts[0] > parts[1])) throw new Error("Track number must be a number or number/total, up to 65535.");
  }
  if (artwork && (!artwork.size || artwork.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(artwork.type))) throw new Error("Choose nonempty JPEG or PNG artwork up to 8 MB.");
}
