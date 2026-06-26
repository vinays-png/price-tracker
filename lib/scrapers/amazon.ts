import * as cheerio from "cheerio";
import { buildSearchQuery } from "@/lib/search-query";
import { extractPrice, fetchHtml, looksBlockedDocument, normalizeWhitespace, waitBeforeRetry } from "@/lib/scrapers/shared";
import type { MarketplaceResult, SourceRow } from "@/types";

export async function scrapeAmazon(row: SourceRow): Promise<MarketplaceResult> {
  const maxAttempts = clampAttempts(Number(process.env.AMAZON_MAX_ATTEMPTS || 5));
  const baseUrl = buildAmazonUrl(row);
  const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(buildSearchQuery(row))}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const targetUrl = baseUrl || searchUrl;

    try {
      const response = await fetchHtml(targetUrl, attempt);

      if (response.status >= 400 || looksBlockedDocument(response.html)) {
        const fallback = baseUrl ? await tryAmazonSearchFallback(searchUrl, attempt) : null;
        if (fallback?.price !== null || fallback?.title) {
          return toMarketplaceResult(fallback, attempt);
        }

        if (attempt < maxAttempts) {
          await waitBeforeRetry(attempt);
          continue;
        }

        return failureResult({
          attempts: attempt,
          blocked: true,
          notes: `Amazon blocked or challenged the request after ${attempt} attempts.`,
          url: response.url
        });
      }

      let parsed = baseUrl
        ? parseAmazonProductPage(response.html, response.url)
        : await resolveAmazonSearchResult(response.html, attempt);

      if (baseUrl && !parsed.blocked && parsed.price === null) {
        const fallback = await tryAmazonSearchFallback(searchUrl, attempt);
        if (fallback?.price !== null || fallback?.title) {
          parsed = fallback;
        }
      }

      if (parsed.blocked) {
        if (attempt < maxAttempts) {
          await waitBeforeRetry(attempt);
          continue;
        }

        return failureResult({
          attempts: attempt,
          blocked: true,
          notes: `Amazon search kept returning challenge pages after ${attempt} attempts.`,
          url: parsed.url || response.url
        });
      }

      if (parsed.price || parsed.title) {
        return toMarketplaceResult(parsed, attempt);
      }
    } catch (error) {
      if (attempt < maxAttempts) {
        await waitBeforeRetry(attempt);
        continue;
      }

      return failureResult({
        attempts: attempt,
        blocked: false,
        notes: error instanceof Error ? error.message : "Amazon request failed."
      });
    }
  }

  return failureResult({
    attempts: maxAttempts,
    blocked: true,
    notes: `Amazon could not be fetched after ${maxAttempts} attempts.`
  });
}

function buildAmazonUrl(row: SourceRow) {
  if (row.amazonUrl) return row.amazonUrl;
  if (row.asin) return `https://www.amazon.in/dp/${encodeURIComponent(row.asin)}`;
  return "";
}

function parseAmazonProductPage(html: string, url: string) {
  const $ = cheerio.load(html);
  const structured = extractAmazonStructuredProduct($);
  const title = normalizeWhitespace(
    structured.title ||
      $("#productTitle").text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      ""
  );
  const priceText = extractAmazonVisiblePrice($);
  const price = structured.price ?? extractPrice(priceText);

  return {
    blocked: looksBlockedDocument(html),
    title,
    price,
    notes: price !== null ? "Price captured from Amazon product page." : "Amazon page loaded but visible price was not found.",
    url
  };
}

async function resolveAmazonSearchResult(html: string, attempt: number) {
  if (looksBlockedDocument(html)) {
    return { blocked: true, title: "", price: null, notes: "", url: "" };
  }

  const $ = cheerio.load(html);
  const firstResult = $('[data-component-type="s-search-result"]').filter((_, element) => {
    const link = $(element).find('h2 a').attr("href") || "";
    return !link.includes("/sspa/") && !link.includes("slredirect");
  }).first();
  const firstLink = firstResult.find('h2 a').attr("href");

  if (!firstLink) {
    return {
      blocked: false,
      title: "",
      price: null,
      notes: "Amazon search did not return a product link.",
      url: ""
    };
  }

  const productUrl = new URL(firstLink, "https://www.amazon.in").toString();
  const title = normalizeWhitespace(firstResult.find("h2").text() || "");
  const priceText = extractAmazonVisiblePrice(firstResult);

  if (title || priceText) {
    return {
      blocked: false,
      title,
      price: extractPrice(priceText),
      notes: priceText ? "Price captured from Amazon search results." : "Amazon search result was found but visible price was not available.",
      url: productUrl
    };
  }

  const response = await fetchHtml(productUrl, attempt);
  return parseAmazonProductPage(response.html, response.url);
}

async function tryAmazonSearchFallback(searchUrl: string, attempt: number) {
  const response = await fetchHtml(searchUrl, attempt);
  if (response.status >= 400 || looksBlockedDocument(response.html)) {
    return null;
  }

  return resolveAmazonSearchResult(response.html, attempt);
}

function extractAmazonVisiblePrice(scope: cheerio.CheerioAPI | cheerio.Cheerio<cheerio.Element>) {
  const priceCandidates = [
    getScopedText(scope, 'meta[property="product:price:amount"]'),
    getScopedText(scope, ".a-price .a-offscreen"),
    getScopedText(scope, '[data-a-price-whole]'),
    getScopedText(scope, '[data-cy="price-recipe"]'),
    getScopedText(scope, "#corePriceDisplay_desktop_feature_div .a-offscreen"),
    getScopedText(scope, "#corePrice_feature_div .a-offscreen")
  ];

  return normalizeWhitespace(priceCandidates.find(Boolean) || "");
}

function getScopedText(scope: cheerio.CheerioAPI | cheerio.Cheerio<cheerio.Element>, selector: string) {
  if (typeof scope === "function") {
    const content = scope(selector).first().attr("content");
    return content || scope(selector).first().text();
  }

  const match = scope.find(selector).first();
  return match.attr("content") || match.text();
}

function extractAmazonStructuredProduct($: cheerio.CheerioAPI) {
  const scripts = $('script[type="application/ld+json"]')
    .map((_, element) => $(element).contents().text())
    .get();

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script) as unknown;
      const entries = Array.isArray(parsed) ? parsed : [parsed];

      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;

        const record = entry as {
          "@type"?: string;
          name?: string;
          offers?: { price?: number | string } | Array<{ price?: number | string }>;
        };

        if (record["@type"] !== "Product") continue;

        const offers = Array.isArray(record.offers) ? record.offers[0] : record.offers;
        const rawPrice = offers?.price;
        const price =
          typeof rawPrice === "number"
            ? rawPrice
            : typeof rawPrice === "string"
              ? extractPrice(rawPrice)
              : null;

        return {
          title: normalizeWhitespace(record.name || ""),
          price
        };
      }
    } catch {
      continue;
    }
  }

  return {
    title: "",
    price: null as number | null
  };
}

function failureResult(input: { attempts: number; blocked: boolean; notes: string; url?: string }): MarketplaceResult {
  return {
    marketplace: "amazon",
    ok: false,
    blocked: input.blocked,
    price: null,
    currency: "INR",
    title: "",
    url: input.url || "",
    notes: input.notes,
    attempts: input.attempts
  };
}

function toMarketplaceResult(
  parsed: { blocked: boolean; notes: string; price: number | null; title: string; url: string },
  attempt: number
): MarketplaceResult {
  return {
    marketplace: "amazon",
    ok: Boolean(parsed.price || parsed.title),
    blocked: parsed.blocked,
    price: parsed.price,
    currency: "INR",
    title: parsed.title,
    url: parsed.url,
    notes: parsed.notes,
    attempts: attempt
  };
}

function clampAttempts(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.min(Math.max(Math.trunc(value), 1), 10);
}
