import * as cheerio from "cheerio";
import { buildSearchQuery } from "@/lib/search-query";
import { extractPrice, fetchHtml, normalizeWhitespace } from "@/lib/scrapers/shared";
import type { MarketplaceResult, SourceRow } from "@/types";

export async function scrapeFlipkart(row: SourceRow): Promise<MarketplaceResult> {
  const initialUrl = row.flipkartUrl || `https://www.flipkart.com/search?q=${encodeURIComponent(buildSearchQuery(row))}`;

  try {
    const response = await fetchHtml(initialUrl, 1);
    const parsed = row.flipkartUrl
      ? parseFlipkartProductPage(response.html, response.url)
      : await resolveFlipkartSearchResult(response.html);

    return {
      marketplace: "flipkart",
      ok: Boolean(parsed.price || parsed.title),
      blocked: false,
      price: parsed.price,
      currency: "INR",
      title: parsed.title,
      url: parsed.url || response.url,
      notes: parsed.notes,
      attempts: 1
    };
  } catch (error) {
    return {
      marketplace: "flipkart",
      ok: false,
      blocked: false,
      price: null,
      currency: "INR",
      title: "",
      url: "",
      notes: error instanceof Error ? error.message : "Flipkart request failed.",
      attempts: 1
    };
  }
}

function parseFlipkartProductPage(html: string, url: string) {
  const $ = cheerio.load(html);
  const title = normalizeWhitespace(
    $("span.B_NuCI").first().text() || $("title").text() || ""
  );
  const priceText = normalizeWhitespace(
    $("div.Nx9bqj.CxhGGd").first().text() ||
      $("div._30jeq3").first().text() ||
      ""
  );

  return {
    title,
    price: extractPrice(priceText),
    notes: priceText ? "Price captured from Flipkart product page." : "Flipkart page loaded but visible price was not found.",
    url
  };
}

async function resolveFlipkartSearchResult(html: string) {
  const $ = cheerio.load(html);
  const firstLink = $('a[href*="/p/"]').first().attr("href");

  if (!firstLink) {
    return {
      title: "",
      price: null,
      notes: "Flipkart search did not return a product link.",
      url: ""
    };
  }

  const productUrl = new URL(firstLink, "https://www.flipkart.com").toString();
  const response = await fetchHtml(productUrl, 1);
  return parseFlipkartProductPage(response.html, response.url);
}
