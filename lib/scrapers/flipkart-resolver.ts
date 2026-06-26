import * as cheerio from "cheerio";
import { buildFlipkartSearchQueries } from "@/lib/search-query";
import { fetchHtml, normalizeWhitespace } from "@/lib/scrapers/shared";
import type { SourceRow } from "@/types";

export type FlipkartIdentity = {
  lid: string;
  pid: string;
  productUrl: string;
  resolvedBy: string;
};

export async function resolveFlipkartIdentity(row: SourceRow): Promise<FlipkartIdentity | null> {
  const directIdentity = parseFlipkartIdentifiers(row.flipkartUrl);
  if (directIdentity) {
    return {
      ...directIdentity,
      productUrl: row.flipkartUrl,
      resolvedBy: "direct link"
    };
  }

  const resolvedDirectIdentity = await resolveFromDirectLink(row.flipkartUrl, row.fsn);
  if (resolvedDirectIdentity) {
    return resolvedDirectIdentity;
  }

  const fsnIdentity = row.fsn ? await resolveFromSearchQuery(row.fsn, "FSN (pid)", row.fsn) : null;
  if (fsnIdentity) {
    return fsnIdentity;
  }

  for (const candidate of buildFlipkartSearchQueries(row)) {
    const identity = await resolveFromSearchQuery(candidate.query, candidate.label);
    if (identity) {
      return identity;
    }
  }

  return null;
}

async function resolveFromDirectLink(url: string, fallbackPid = "") {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.toLowerCase().includes("flipkart.com")) {
      return null;
    }

    const response = await fetchHtml(url, 1);
    const pid =
      normalizeWhitespace(parsedUrl.searchParams.get("pid") || "") ||
      normalizeWhitespace(new URL(response.url).searchParams.get("pid") || "") ||
      normalizeWhitespace(fallbackPid);
    const lid =
      extractLidFromText(response.url) ||
      extractLidFromText(response.html);

    if (!pid || !lid) {
      return null;
    }

    return {
      pid,
      lid,
      productUrl: response.url || url,
      resolvedBy: "direct link"
    };
  } catch {
    return null;
  }
}

async function resolveFromSearchQuery(query: string, label: string, preferredPid = "") {
  const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
  const response = await fetchHtml(searchUrl, 1);
  const $ = cheerio.load(response.html);
  const preferredCard = preferredPid
    ? $(`a[href*="pid=${preferredPid}"][href*="/p/"]`).first()
    : null;
  const firstCard = preferredCard?.length ? preferredCard : $('a[href*="/p/"]').first();
  const href = firstCard.attr("href");

  if (!href) {
    return null;
  }

  const productUrl = new URL(href, "https://www.flipkart.com").toString();
  const identity = parseFlipkartIdentifiers(productUrl);

  return identity
    ? {
        ...identity,
        productUrl,
        resolvedBy: label
      }
    : null;
}

function parseFlipkartIdentifiers(url: string) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const pid = normalizeWhitespace(parsedUrl.searchParams.get("pid") || "");
    const lid = normalizeWhitespace(parsedUrl.searchParams.get("lid") || "");

    if (!pid || !lid) return null;

    return { pid, lid };
  } catch {
    return null;
  }
}

function extractLidFromText(value: string) {
  const match = value.match(/[?&]lid=([A-Z0-9]+)/i);
  return normalizeWhitespace(match?.[1] || "");
}
