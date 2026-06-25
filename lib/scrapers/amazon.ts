import * as cheerio from "cheerio";
import { buildSearchQuery } from "@/lib/search-query";
import { extractPrice, fetchHtml, looksBlockedDocument, normalizeWhitespace, waitBeforeRetry } from "@/lib/scrapers/shared";
import type { MarketplaceResult, SourceRow } from "@/types";

export async function scrapeAmazon(row: SourceRow): Promise<MarketplaceResult> {
  const maxAttempts = clampAttempts(Number(process.env.AMAZON_MAX_ATTEMPTS || 5));
  const baseUrl = buildAmazonUrl(row);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const targetUrl = baseUrl || `https://www.amazon.in/s?k=${encodeURIComponent(buildSearchQuery(row))}`;

    try {
      const response = await fetchHtml(targetUrl, attempt);

      if (response.status >= 400 || looksBlockedDocument(response.html)) {
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

      const parsed = baseUrl
        ? parseAmazonProductPage(response.html, response.url)
        : await resolveAmazonSearchResult(response.html, attempt);

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
        return {
          marketplace: "amazon",
          ok: Boolean(parsed.price || parsed.title),
          blocked: false,
          price: parsed.price,
          currency: "INR",
          title: parsed.title,
          url: parsed.url || response.url,
          notes: parsed.notes,
          attempts: attempt
        };
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
  const title = normalizeWhitespace(
    $("#productTitle").text() || $("title").text() || ""
  );
  const priceText = normalizeWhitespace(
    $(".a-price .a-offscreen").first().text() ||
      $("#corePriceDisplay_desktop_feature_div .a-offscreen").first().text() ||
      ""
  );

  return {
    blocked: looksBlockedDocument(html),
    title,
    price: extractPrice(priceText),
    notes: priceText ? "Price captured from Amazon product page." : "Amazon page loaded but visible price was not found.",
    url
  };
}

async function resolveAmazonSearchResult(html: string, attempt: number) {
  if (looksBlockedDocument(html)) {
    return { blocked: true, title: "", price: null, notes: "", url: "" };
  }

  const $ = cheerio.load(html);
  const firstLink = $('a.a-link-normal.s-no-outline').first().attr("href");

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
  const response = await fetchHtml(productUrl, attempt);
  return parseAmazonProductPage(response.html, response.url);
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

function clampAttempts(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.min(Math.max(Math.trunc(value), 1), 10);
}
