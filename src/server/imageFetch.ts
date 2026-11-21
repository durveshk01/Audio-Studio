import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

export class ImageFetchError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))
      || (a === 192 && b === 2) || (a === 198 && b === 51) || (a === 203 && b === 0));
  }
  // Allow only global-unicast IPv6. This rejects loopback, link-local, ULA and IPv4-mapped addresses.
  return net.isIPv6(address) && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}

export function validateImageUrl(input: string, hosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new ImageFetchError("Invalid image URL.", 400); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !hosts.includes(url.hostname.toLowerCase()) || url.hash) throw new ImageFetchError("Image URL is not an approved HTTPS provider.", 400);
  return url;
}

function validImage(buffer: Buffer, type: string): boolean {
  if (type === "image/jpeg") return buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (type === "image/png") return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return type === "image/webp" && buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
}

export async function fetchApprovedImage(input: string, hosts: readonly string[], options: {
  timeoutMs?: number; maxBytes?: number; authorization?: string;
  lookup?: (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
} = {}): Promise<{ buffer: Buffer; contentType: string }> {
  let url = validateImageUrl(input, hosts);
  const originalHost = url.hostname;
  const deadline = Date.now() + (options.timeoutMs || 10_000);
  const maxBytes = options.maxBytes || 8 * 1024 * 1024;
  for (let redirect = 0; redirect <= 2; redirect++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ImageFetchError("Artwork provider timed out.", 504);
    const lookup = options.lookup || ((hostname: string, settings: { all: true; verbatim: true }) => dns.lookup(hostname, settings));
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new ImageFetchError("Artwork DNS lookup timed out.", 504)), remaining);
        dnsTimer.unref();
      })
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw new ImageFetchError("Artwork provider resolved to a restricted address.", 400);
    // Pin the validated address for this request, eliminating DNS-rebinding between validation and connection.
    const address = addresses[0];
    const response = await new Promise<{ redirect?: string; buffer?: Buffer; contentType?: string }>((resolve, reject) => {
      const request = https.get(url, {
        agent: false,
        family: address.family,
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        headers: { Accept: "image/jpeg,image/png,image/webp", ...(options.authorization && url.hostname === originalHost ? { Authorization: options.authorization } : {}) }
      }, (upstream) => {
        if ([301, 302, 303, 307, 308].includes(upstream.statusCode || 0) && upstream.headers.location) {
          upstream.destroy(); resolve({ redirect: upstream.headers.location }); return;
        }
        const contentType = (upstream.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (upstream.statusCode !== 200 || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
          upstream.destroy(); reject(new ImageFetchError("Artwork provider did not return a supported image.")); return;
        }
        if (Number(upstream.headers["content-length"]) > maxBytes) {
          upstream.destroy(); reject(new ImageFetchError("Artwork image exceeds the size limit.")); return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        upstream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) { upstream.destroy(); reject(new ImageFetchError("Artwork image exceeds the size limit.")); }
          else chunks.push(chunk);
        });
        upstream.on("error", () => reject(new ImageFetchError("Artwork download was interrupted.")));
        upstream.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (!validImage(buffer, contentType)) reject(new ImageFetchError("Artwork provider returned invalid image data."));
          else resolve({ buffer, contentType });
        });
      });
      const timer = setTimeout(() => request.destroy(new ImageFetchError("Artwork provider timed out.", 504)), Math.max(1, deadline - Date.now()));
      request.on("close", () => clearTimeout(timer));
      request.on("error", (error) => reject(error instanceof ImageFetchError ? error : new ImageFetchError("Could not reach the artwork provider.")));
    });
    if (!response.redirect) return { buffer: response.buffer!, contentType: response.contentType! };
    const next = validateImageUrl(new URL(response.redirect, url).href, hosts);
    if (options.authorization && next.hostname !== originalHost) throw new ImageFetchError("Artwork provider redirected to a different host.");
    url = next;
  }
  throw new ImageFetchError("Artwork provider redirected too many times.");
}
