import { flipkartIdentityConflict } from "../marketplace-url";
import { isFlipkartUrl } from "./safe-request";
import * as cheerio from "cheerio";
import { buildSearchQuery } from "../search-query";
import { fetchRenderedHtml } from "./browser";
import { resolveFlipkartIdentity } from "./flipkart-resolver";
import { extractPrice, fetchHtml, normalizeWhitespace } from "./shared";
import type { MarketplaceResult, SourceRow } from "@/types";

export async function scrapeFlipkart(row: SourceRow): Promise<MarketplaceResult> {
  try {
    const conflict = flipkartIdentityConflict(row);
    if (conflict) {
      return { marketplace: "flipkart", ok: false, blocked: false, price: null,
        currency: "INR", title: "", url: "", attempts: 0, notes: conflict };
    }
    if (isDirectFlipkartUrl(row.flipkartUrl)) {
      const direct = await fetchFlipkartProductPage(row.flipkartUrl, row.fsn);
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
          ok: resolved.price !== null,
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
        ok: parsed.price !== null,
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
        ok: parsed.price !== null,
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

    if (row.fsn) {
      return {
        marketplace: "flipkart", ok: false, blocked: false, price: null,
        currency: "INR", title: "", url: "", attempts: 1,
        notes: "Flipkart did not return the requested product ID; no substitute was used."
      };
    }

    const initialUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(buildSearchQuery(row))}`;
    const response = await fetchHtml(initialUrl, 1);
    const parsed = await resolveFlipkartSearchResult(response.html);

    return {
      marketplace: "flipkart",
      ok: parsed.price !== null,
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
    return isFlipkartUrl(parsedUrl.href);
  } catch {
    return false;
  }
}

async function fetchFlipkartProductPage(url: string, fallbackPid = "") {
  const response = await fetchHtml(url, 1);
  const expectedPid = new URL(url).searchParams.get("pid") || fallbackPid;
  if (expectedPid && new URL(response.url || url).searchParams.get("pid") !== expectedPid) {
    throw new Error("Flipkart redirected away from the requested product; no substitute was used.");
  }
  const initial = parseFlipkartProductPage(response.html, response.url || url);

  if (initial.price !== null) {
    return { parsed: initial, url: response.url || url, rendered: false };
  }

  try {
    const rendered = await fetchRenderedHtml(response.url || url);
    if (expectedPid && new URL(rendered.url).searchParams.get("pid") !== expectedPid) {
      return { parsed: initial, url: response.url || url, rendered: false };
    }
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

export function parseFlipkartProductPage(html: string, url: string, _visibleText = "") {
  const $ = cheerio.load(html);
  const expectedPid = new URL(url).searchParams.get("pid") || "";
  const structured = extractFlipkartStructuredProduct($, expectedPid);
  const title = normalizeWhitespace(
    structured.title || $("span.B_NuCI").first().text() || $("h1").first().text() ||
    $('meta[property="og:title"]').attr("content") || $("title").text() || ""
  );
  // Never use the first arbitrary rupee amount: it may be EMI, shipping, a bank
  // offer or a recommendation. Without matched Product JSON-LD, only known
  // primary product price selectors on a PID-confirmed document are eligible.
  let documentMatches = false;
  try {
    const ogUrl = $('meta[property="og:url"]').attr("content") || "";
    documentMatches = Boolean(expectedPid && isFlipkartUrl(ogUrl) && new URL(ogUrl).searchParams.get("pid") === expectedPid);
  } catch { /* No verifiable product metadata. */ }
  const priceText = documentMatches ? normalizeWhitespace(
    $('meta[property="product:price:amount"]').attr("content") ||
    $("div.Nx9bqj.CxhGGd").first().text() || $("div._30jeq3._16Jk6d").first().text() || ""
  ) : "";
  const displayedPrice = documentMatches ? extractDisplayedFlipkartPrice($) : null;
  const price = displayedPrice ?? structured.price ?? extractPrice(priceText);
  return {
    title, price,
    notes: price !== null ? "Price captured from Flipkart product page." : "Flipkart page loaded but a verified product price was not found.",
    url
  };
}

// Observed shopper-facing price row: discount, struck-through MRP, then sale
// price. Require the primary product container and a unique non-linked row so
// recommendation cards and conditional "Buy at"/bank offers cannot qualify.
function extractDisplayedFlipkartPrice($: cheerio.CheerioAPI) {
  const candidates: number[] = [];
  $('div.CTTtEa').filter((_, container) => $(container).find('h1').length === 1)
    .find('div.v1zwn21n.v1zwn20').each((_, element) => {
      const priceNode = $(element);
      if (!/^₹\s*\d[\d,]*(?:\.\d{1,2})?$/.test(priceNode.text().trim())) return;
      const row = priceNode.parent().parent();
      const anchor = row.parent();
      if (!priceNode.parent().is('div.css-g5y9jx') || !anchor.is('a._1o6mltlk4') || anchor.attr('href') !== undefined) return;
      const mrps = row.find('div.v1zwn21o.v1zwn21').filter((_, node) =>
        /text-decoration(?:-line)?\s*:\s*line-through/i.test($(node).attr('style') || ''));
      if (mrps.length !== 1 || row.find('div.v1zwn21n.v1zwn20').length !== 1) return;
      const price = extractPrice(priceNode.text());
      const mrp = extractPrice(mrps.text());
      if (price !== null && mrp !== null && price >= 0 && price <= mrp) candidates.push(price);
    });
  return candidates.length === 1 ? candidates[0] : null;
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

function extractFlipkartStructuredProduct($: cheerio.CheerioAPI, expectedPid: string) {
  const empty = { title: "", price: null as number | null };
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed: unknown = JSON.parse($(element).contents().text());
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const entry = queue.shift();
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        if (Array.isArray(record["@graph"])) queue.push(...record["@graph"]);
        const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
        if (!types.includes("Product")) continue;
        let pid = typeof record.sku === "string" ? record.sku : typeof record.productID === "string" ? record.productID : "";
        if (!pid && typeof record.url === "string" && isFlipkartUrl(record.url)) pid = new URL(record.url).searchParams.get("pid") || "";
        if (!expectedPid || pid !== expectedPid) continue;
        const offer = Array.isArray(record.offers) ? record.offers[0] : record.offers;
        if (!offer || typeof offer !== "object") continue;
        const { price: rawPrice, priceCurrency } = offer as { price?: unknown; priceCurrency?: unknown };
        if (priceCurrency && priceCurrency !== "INR") continue;
        const price = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" ? extractPrice(rawPrice) : null;
        if (price === null || !Number.isFinite(price) || price < 0) continue;
        return { title: normalizeWhitespace(typeof record.name === "string" ? record.name : ""), price };
      }
    } catch { continue; }
  }
  return empty;
}
