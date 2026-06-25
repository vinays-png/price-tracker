const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
];

export async function fetchHtml(url: string, attempt: number) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SCRAPE_REQUEST_TIMEOUT_MS || 15000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept-language": "en-IN,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "user-agent": USER_AGENTS[attempt % USER_AGENTS.length] || USER_AGENTS[0]
      }
    });

    return {
      status: response.status,
      url: response.url,
      html: await response.text()
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function extractPrice(value: string) {
  const normalized = value.replace(/[^0-9.]/g, "");
  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : null;
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function looksBlockedDocument(html: string) {
  const text = html.toLowerCase();
  return [
    "enter the characters you see below",
    "sorry, we just need to make sure you're not a robot",
    "api-services-support@amazon.com",
    "to discuss automated access to amazon data please contact",
    "captcha"
  ].some((pattern) => text.includes(pattern));
}

export async function waitBeforeRetry(attempt: number) {
  const backoffMs = Math.min(1500 * attempt, 6000);
  await new Promise((resolve) => setTimeout(resolve, backoffMs));
}
