import * as cheerio from "cheerio";
import { buildSearchQuery } from "@/lib/search-query";
import { resolveFlipkartIdentity } from "@/lib/scrapers/flipkart-resolver";
import { extractPrice, fetchHtml, normalizeWhitespace } from "@/lib/scrapers/shared";
import type { MarketplaceResult, SourceRow } from "@/types";

export async function scrapeFlipkart(row: SourceRow): Promise<MarketplaceResult> {
  try {
    const identity = await resolveFlipkartIdentity(row);

    if (identity) {
      const response = await fetchHtml(identity.productUrl, 1);
      const parsed = parseFlipkartProductPage(response.html, response.url);

      return {
        marketplace: "flipkart",
        ok: Boolean(parsed.price || parsed.title),
        blocked: false,
        price: parsed.price,
        currency: "INR",
        title: parsed.title,
        url: parsed.url || response.url,
        notes: parsed.price !== null ? parsed.notes : `${parsed.notes} Product was resolved using ${identity.resolvedBy}.`,
        attempts: 1
      };
    }

    const initialUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(buildSearchQuery(row))}`;
    const response = await fetchHtml(initialUrl, 1);
    const parsed = await resolveFlipkartSearchResult(response.html);

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
  const structured = extractFlipkartStructuredProduct($);
  const title = normalizeWhitespace(
    structured.title ||
      $("span.B_NuCI").first().text() ||
      $("h1").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      ""
  );
  const priceText = normalizeWhitespace(
    $('meta[property="product:price:amount"]').attr("content") ||
      $("div.Nx9bqj.CxhGGd").first().text() ||
      $("div._30jeq3").first().text() ||
      $('div[class*="Nx9bqj"]').first().text() ||
      ""
  );
  const price = structured.price ?? extractPrice(priceText);

  return {
    title,
    price,
    notes: price !== null ? "Price captured from Flipkart product page." : "Flipkart page loaded but visible price was not found.",
    url
  };
}

async function resolveFlipkartSearchResult(html: string) {
  const $ = cheerio.load(html);
  const firstCard = $('a[href*="/p/"]').first();
  const firstLink = firstCard.attr("href");

  if (!firstLink) {
    return {
      title: "",
      price: null,
      notes: "Flipkart search did not return a product link.",
      url: ""
    };
  }

  const productUrl = new URL(firstLink, "https://www.flipkart.com").toString();
  const priceText = normalizeWhitespace(firstCard.text().match(/\u20B9[\d,]+(?:\.\d+)?/)?.[0] || "");
  const title = normalizeWhitespace(
    firstCard.find("img").attr("alt") ||
      firstCard.clone().children().remove().end().text() ||
      ""
  );

  if (priceText || title) {
    return {
      title,
      price: extractPrice(priceText),
      notes: "Price captured from Flipkart search results.",
      url: productUrl
    };
  }

  const response = await fetchHtml(productUrl, 1);
  return parseFlipkartProductPage(response.html, response.url);
}

function extractFlipkartStructuredProduct($: cheerio.CheerioAPI) {
  const scripts = $('script[type="application/ld+json"]')
    .map((_, element) => $(element).contents().text())
    .get();

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script) as unknown;
      const products = Array.isArray(parsed) ? parsed : [parsed];

      for (const entry of products) {
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
