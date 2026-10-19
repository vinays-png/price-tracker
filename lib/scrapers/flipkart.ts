import * as cheerio from "cheerio";
import { buildSearchQuery } from "@/lib/search-query";
import { fetchRenderedHtml } from "@/lib/scrapers/browser";
import { resolveFlipkartIdentity } from "@/lib/scrapers/flipkart-resolver";
import { extractPrice, fetchHtml, normalizeWhitespace } from "@/lib/scrapers/shared";
import type { MarketplaceResult, SourceRow } from "@/types";

export async function scrapeFlipkart(row: SourceRow): Promise<MarketplaceResult> {
  try {
    if (isDirectFlipkartUrl(row.flipkartUrl)) {
      const direct = await fetchFlipkartProductPage(row.flipkartUrl);
      const parsed = direct.parsed;

      if (parsed.price !== null) {
        return {
          marketplace: "flipkart",
          ok: true,
          blocked: false,
          price: parsed.price,
          currency: "INR",
          title: parsed.title,
          url: parsed.url || direct.url,
          notes: direct.rendered
            ? "Price captured from the rendered provided Flipkart link."
            : "Price captured from provided Flipkart link.",
          attempts: 1
        };
      }

      // PID-only links such as /product/p/itme?pid=... often do not expose
      // the product page's price in their HTML. Resolve the FSN to a canonical
      // product link before giving up on the provided link.
      const identity = await resolveFlipkartIdentity(row);
      if (identity && !sameUrl(identity.productUrl, direct.url)) {
        const resolvedPage = await fetchFlipkartProductPage(identity.productUrl);
        const resolved = resolvedPage.parsed;

        return {
          marketplace: "flipkart",
          ok: Boolean(resolved.price || resolved.title),
          blocked: false,
          price: resolved.price,
          currency: "INR",
          title: resolved.title || parsed.title,
          url: resolved.url || resolvedPage.url || identity.productUrl,
          notes:
            resolved.price !== null
              ? `Price captured after resolving the Flipkart link using ${identity.resolvedBy}.${resolvedPage.rendered ? " The product page was rendered." : ""}`
              : `${resolved.notes} The link was resolved using ${identity.resolvedBy}.${resolvedPage.rendered ? " The rendered page was also checked." : ""}`,
          attempts: 2
        };
      }

      return {
        marketplace: "flipkart",
        ok: Boolean(parsed.price || parsed.title),
        blocked: false,
        price: parsed.price,
        currency: "INR",
        title: parsed.title,
        url: parsed.url || direct.url,
        notes: parsed.price !== null
          ? "Price captured from provided Flipkart link."
          : `${parsed.notes}${direct.rendered ? " The rendered page was also checked." : ""}`,
        attempts: 1
      };
    }

    if (row.flipkartUrl.trim()) {
      return {
        marketplace: "flipkart",
        ok: false,
        blocked: false,
        price: null,
        currency: "INR",
        title: "",
        url: "",
        notes: "Flipkart Link was provided but is not a valid Flipkart product URL.",
        attempts: 1
      };
    }

    const identity = await resolveFlipkartIdentity(row);

    if (identity) {
      const page = await fetchFlipkartProductPage(identity.productUrl);
      const parsed = page.parsed;

      return {
        marketplace: "flipkart",
        ok: Boolean(parsed.price || parsed.title),
        blocked: false,
        price: parsed.price,
        currency: "INR",
        title: parsed.title,
        url: parsed.url || page.url || identity.productUrl,
        notes:
          parsed.price !== null
            ? `${parsed.notes}${page.rendered ? " Product page was rendered." : ""}`
            : `${parsed.notes} Product was resolved using ${identity.resolvedBy}.${page.rendered ? " The rendered page was also checked." : ""}`,
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

function sameUrl(left: string, right: string) {
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    };
    return normalize(left) === normalize(right);
  } catch {
    return left === right;
  }
}

function isDirectFlipkartUrl(url: string) {
  if (!url) return false;

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.toLowerCase().includes("flipkart.com");
  } catch {
    return false;
  }
}

async function fetchFlipkartProductPage(url: string) {
  const response = await fetchHtml(url, 1);
  const initial = parseFlipkartProductPage(response.html, response.url || url);

  if (initial.price !== null) {
    return { parsed: initial, url: response.url || url, rendered: false };
  }

  try {
    const rendered = await fetchRenderedHtml(response.url || url);
    const parsed = parseFlipkartProductPage(rendered.html, response.url || url, rendered.text);
    return {
      parsed: {
        ...parsed,
        title: parsed.title || initial.title
      },
      url: response.url || url,
      rendered: true
    };
  } catch {
    return { parsed: initial, url: response.url || url, rendered: false };
  }
}

function parseFlipkartProductPage(html: string, url: string, visibleText = "") {
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
    $("div.v1zwn21n")
      .filter((_, element) => /₹/.test($(element).text()))
      .first()
      .text() ||
      $('meta[property="product:price:amount"]').attr("content") ||
      $("div.Nx9bqj.CxhGGd").first().text() ||
      $("div._30jeq3").first().text() ||
      $('div[class*="Nx9bqj"]').first().text() ||
      ""
  );
  const visiblePrice = visibleText.match(/₹\s*[\d,]+(?:\.\d{1,2})?/)?.[0] || "";
  const price = structured.price ?? extractPrice(priceText) ?? extractPrice(visiblePrice);

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

  if (priceText) {
    return {
      title,
      price: extractPrice(priceText),
      notes: "Price captured from Flipkart search results.",
      url: productUrl
    };
  }

  const page = await fetchFlipkartProductPage(productUrl);
  return {
    ...page.parsed,
    title: page.parsed.title || title,
    notes:
      page.parsed.price !== null
        ? page.parsed.notes
        : `${page.parsed.notes} Product was resolved from Flipkart search results.`,
    url: page.parsed.url || page.url || productUrl
  };
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

