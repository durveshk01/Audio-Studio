import { useEffect, useState } from "react";

export function useAudioSource(blob?: Blob, src?: string): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = blob ? URL.createObjectURL(blob) : src || "";
    setUrl(next);
    return () => { if (blob) URL.revokeObjectURL(next); };
  }, [blob, src]);
  return url;
}
