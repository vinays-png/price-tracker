import { validateScrapeUrl } from "../marketplace-url";
export { validateScrapeUrl, isFlipkartUrl } from "../marketplace-url";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { BlockList, isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") :
    family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export async function resolvePublicAddress(hostname: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Scraper DNS lookup timed out")), 5000);
    })
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Blocked non-public scraper destination");
  }
  // Prefer IPv4 on serverless hosts without IPv6 egress.
  return addresses.find(({ family }) => family === 4) || addresses[0];
}

export type SafeResponse = { status: number; headers: IncomingHttpHeaders; body: Buffer; url: string };

// DNS is checked once and pinned in the socket lookup. TLS still verifies the original hostname.
// Never use automatic redirects: each next destination must pass the same checks.
export async function safeRequest(input: string, options: {
  assets?: boolean; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number;
} = {}): Promise<SafeResponse> {
  const url = validateScrapeUrl(input, options.assets);
  const address = await resolvePublicAddress(url.hostname);
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: Error) => { clearTimeout(timeout); reject(error); };
    const finish = (response: SafeResponse) => { clearTimeout(timeout); resolve(response); };
    const req = request(url, {
      method: options.method || "GET",
      agent: false,
      family: address.family,
      headers: { ...options.headers, host: url.host, "accept-encoding": "identity" },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family)
    }, (response) => {
      const encoding = response.headers["content-encoding"];
      const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() :
        encoding === "br" ? createBrotliDecompress() : null;
      if (encoding && encoding !== "identity" && !decoder) {
        const error = new Error("Unsupported scraper content encoding");
        fail(error);
        req.destroy(error);
        return;
      }
      const stream = decoder ? response.pipe(decoder) : response;
      const headers = { ...response.headers };
      delete headers["content-encoding"];
      delete headers["content-length"];
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          const error = new Error("Scraper response too large");
          fail(error);
          stream.destroy(error);
          req.destroy(error);
        }
        else chunks.push(chunk);
      });
      response.on("error", fail);
      stream.on("error", fail);
      stream.on("end", () => finish({
        status: response.statusCode || 502, headers,
        body: Buffer.concat(chunks), url: url.href
      }));
    });
    timeout = setTimeout(() => {
      const error = new Error("Scraper request timed out");
      fail(error);
      req.destroy(error);
    }, options.timeoutMs || 15000);
    req.on("error", fail);
    req.end(options.body);
  });
}

export async function safeFetchHtml(input: string, headers: Record<string, string>, timeoutMs: number) {
  let url = validateScrapeUrl(input).href;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await safeRequest(url, { headers, timeoutMs });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      if (redirects === 5) throw new Error("Too many scraper redirects");
      url = validateScrapeUrl(new URL(response.headers.location, url).href).href;
      continue;
    }
    return { status: response.status, url, html: response.body.toString("utf8") };
  }
  throw new Error("Too many scraper redirects");
}
