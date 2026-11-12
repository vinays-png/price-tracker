export type Marketplace = "amazon" | "flipkart";
const PRODUCT_HOSTS = new Set(["amazon.in", "www.amazon.in", "flipkart.com", "www.flipkart.com"]);
const ASSET_HOSTS = new Set(["1.rome.api.flipkart.com"]);
const ASSET_DOMAINS = ["media-amazon.com", "ssl-images-amazon.com", "images-amazon.com", "flixcart.com", "flipkart.net"];

export function validateScrapeUrl(input: string, assets = false): URL {
  const url = new URL(input);
  const hostAllowed = PRODUCT_HOSTS.has(url.hostname) || (assets && (ASSET_HOSTS.has(url.hostname) || ASSET_DOMAINS.some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  )));
  if (url.protocol !== "https:" || url.username || url.password || url.port || !hostAllowed) {
    throw new Error("Unsupported scraper URL: use an HTTPS Amazon India or Flipkart URL");
  }
  return url;
}

export function isFlipkartUrl(input: string) {
  try {
    const url = validateScrapeUrl(input);
    return url.hostname === "flipkart.com" || url.hostname === "www.flipkart.com";
  } catch { return false; }
}

export function normalizeAsin(value: string | undefined) {
  const asin = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : "";
}

// Normalize presentation artifacts, then enforce exactly the same host policy as
// the server. Never treat an unrecognized link as permission to fetch another host.
export function normalizeMarketplaceUrl(value: string | undefined, marketplace: Marketplace) {
  let input = String(value ?? "").trim();
  if (!input) return "";
  const markdownLink = input.match(/^\[[^\]]*\]\((.+)\)$/);
  if (markdownLink) input = markdownLink[1].trim();
  input = input.replace(/^<([^<>]+)>$/, "$1");
  input = input.replace(/\\([\\`*_{}\[\]()#+\-.!|>?=&:])/g, "$1");
  if (input.includes("\\")) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) input = `https://${input.replace(/^\/\//, "")}`;
  try {
    const parsed = new URL(input);
    if (parsed.protocol === "http:") parsed.protocol = "https:";
    const url = validateScrapeUrl(parsed.href);
    const flipkart = isFlipkartUrl(url.href);
    if ((marketplace === "flipkart") !== flipkart) return "";
    if (marketplace === "amazon") {
      const productPath = url.pathname.match(/\/(?:dp|gp\/product)(?:\/([^/]*))?(?:\/|$)/i);
      if (productPath && !normalizeAsin(productPath[1])) return "";
    }
    return url.href;
  } catch { return ""; }
}

export function flipkartIdentityConflict(row: { fsn: string; flipkartUrl: string }) {
  if (!row.fsn || !isFlipkartUrl(row.flipkartUrl)) return "";
  const pid = new URL(row.flipkartUrl).searchParams.get("pid");
  return pid && pid !== row.fsn
    ? "Flipkart FSN does not match the product ID in the link. Correct one before fetching."
    : "";
}
