import * as cheerio from "cheerio";
import { buildSearchQuery } from "@/lib/search-query";
import { fetchHtml, looksBlockedDocument, normalizeWhitespace } from "@/lib/scrapers/shared";
import type { DeliveryMarketplaceResult, SourceRow } from "@/types";

export async function scrapeAmazonDelivery(row: SourceRow, pincode: string): Promise<DeliveryMarketplaceResult> {
  const baseUrl = buildAmazonUrl(row);
  if (!baseUrl) {
    return {
      marketplace: "amazon",
      ok: false,
      blocked: false,
      attempts: 0,
      url: "",
      notes: "Amazon delivery skipped: no ASIN or Amazon Link was provided.",
      deliveryLabel: "",
      deliveryDate: ""
    };
  }

  const targetUrl = baseUrl || `https://www.amazon.in/s?k=${encodeURIComponent(buildSearchQuery(row))}`;

  try {
    const response = await fetchHtml(targetUrl, 1);

    if (response.status >= 400 || looksBlockedDocument(response.html)) {
      return failureResult({
        blocked: true,
        notes: "Amazon blocked the delivery lookup before the delivery message could be read.",
        url: response.url
      });
    }

    const parsed = baseUrl
      ? parseAmazonDeliveryPage(response.html)
      : await resolveAmazonSearchResult(response.html);

    return {
      marketplace: "amazon",
      ok: Boolean(parsed.deliveryLabel || parsed.deliveryDate),
      blocked: false,
      attempts: 1,
      url: parsed.url || response.url,
      notes: parsed.deliveryDate
        ? `Amazon delivery was read from the product page. Pincode ${pincode} could not be forced anonymously, so this reflects Amazon's current visible delivery location.`
        : parsed.notes,
      deliveryLabel: parsed.deliveryLabel,
      deliveryDate: parsed.deliveryDate
    };
  } catch (error) {
    return failureResult({
      blocked: false,
      notes: error instanceof Error ? error.message : "Amazon delivery check failed."
    });
  }
}

function buildAmazonUrl(row: SourceRow) {
  if (row.amazonUrl) return row.amazonUrl;
  if (row.asin) return `https://www.amazon.in/dp/${encodeURIComponent(row.asin)}`;
  return "";
}

function parseAmazonDeliveryPage(html: string) {
  const $ = cheerio.load(html);
  const lines = $("#deliveryBlockMessage span, #deliveryBlockMessage div, #mir-layout-DELIVERY_BLOCK span")
    .map((_, element) => normalizeWhitespace($(element).text()))
    .get()
    .filter(Boolean);

  const deliveryLine = lines.find((line) => /delivery/i.test(line) && !/^details$/i.test(line)) || "";
  const fastestLine = lines.find((line) => /fastest delivery/i.test(line)) || "";

  if (deliveryLine || fastestLine) {
    return {
      deliveryLabel: deliveryLine || "Fastest delivery",
      deliveryDate: fastestLine || deliveryLine,
      notes: "Amazon delivery details captured from the product page.",
      url: ""
    };
  }

  const pageText = normalizeWhitespace($.text());
  const freeDeliveryMatch = pageText.match(/FREE delivery\s+([^.]*)/i);
  const fastestMatch = pageText.match(/Or fastest delivery\s+([^.]*)/i);

  return {
    deliveryLabel: freeDeliveryMatch ? "FREE delivery" : fastestMatch ? "Fastest delivery" : "",
    deliveryDate: normalizeWhitespace((freeDeliveryMatch?.[1] || fastestMatch?.[1] || "").trim()),
    notes: freeDeliveryMatch || fastestMatch ? "Amazon delivery details captured from the product page." : "Amazon delivery details were not available on the page.",
    url: ""
  };
}

async function resolveAmazonSearchResult(html: string) {
  const $ = cheerio.load(html);
  const firstResult = $('[data-component-type="s-search-result"]').filter((_, element) => {
    const link = $(element).find("h2 a").attr("href") || "";
    return !link.includes("/sspa/") && !link.includes("slredirect");
  }).first();
  const href = firstResult.find("h2 a").attr("href");

  if (!href) {
    return {
      deliveryLabel: "",
      deliveryDate: "",
      notes: "Amazon search did not return a product link.",
      url: ""
    };
  }

  const productUrl = new URL(href, "https://www.amazon.in").toString();
  const response = await fetchHtml(productUrl, 1);

  if (response.status >= 400 || looksBlockedDocument(response.html)) {
    return {
      deliveryLabel: "",
      deliveryDate: "",
      notes: "Amazon blocked the product page while checking delivery details.",
      url: productUrl
    };
  }

  const parsed = parseAmazonDeliveryPage(response.html);
  return {
    ...parsed,
    url: productUrl
  };
}

function failureResult(input: { blocked: boolean; notes: string; url?: string }): DeliveryMarketplaceResult {
  return {
    marketplace: "amazon",
    ok: false,
    blocked: input.blocked,
    attempts: 1,
    url: input.url || "",
    notes: input.notes,
    deliveryLabel: "",
    deliveryDate: ""
  };
}
