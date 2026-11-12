import { isFlipkartUrl } from "./safe-request";
import * as cheerio from "cheerio";
import { buildFlipkartSearchQueries } from "../search-query";
import { fetchHtml, normalizeWhitespace } from "./shared";
import type { SourceRow } from "@/types";

export type FlipkartIdentity = {
  lid: string;
  pid: string;
  productUrl: string;
  resolvedBy: string;
};

export async function resolveFlipkartIdentity(row: SourceRow): Promise<FlipkartIdentity | null> {
  const preferredPid = isFlipkartUrl(row.flipkartUrl)
    ? new URL(row.flipkartUrl).searchParams.get("pid") || row.fsn
    : row.fsn;
  const directIdentity = parseFlipkartIdentifiers(row.flipkartUrl);
  if (directIdentity) {
    return {
      ...directIdentity,
      productUrl: row.flipkartUrl,
      resolvedBy: "direct link"
    };
  }

  // The generic product/p/itme path needs the FSN (pid) to find the real
  // product listing. Try that lookup before fetching the generic URL again.
  const isGenericPidLink = isGenericFlipkartPidLink(row.flipkartUrl);
  let fsnIdentity: FlipkartIdentity | null = null;
  if (isGenericPidLink && preferredPid) {
    fsnIdentity = await resolveFromSearchQuery(preferredPid, "FSN (pid)", preferredPid);
    if (fsnIdentity) {
      return fsnIdentity;
    }
  }

  const resolvedDirectIdentity = await resolveFromDirectLink(row.flipkartUrl, preferredPid);
  if (resolvedDirectIdentity) {
    return resolvedDirectIdentity;
  }

  fsnIdentity ??= preferredPid ? await resolveFromSearchQuery(preferredPid, "FSN (pid)", preferredPid) : null;
  if (fsnIdentity) {
    return fsnIdentity;
  }

  for (const candidate of buildFlipkartSearchQueries(row)) {
    const identity = await resolveFromSearchQuery(candidate.query, candidate.label, preferredPid);
    if (identity) {
      return identity;
    }
  }

  return null;
}

function isGenericFlipkartPidLink(url: string) {
  try {
    const parsedUrl = new URL(url);
    return (
      isFlipkartUrl(parsedUrl.href) &&
      /^\/product\/p\/itme\/?$/i.test(parsedUrl.pathname) &&
      Boolean(parsedUrl.searchParams.get("pid"))
    );
  } catch {
    return false;
  }
}

async function resolveFromDirectLink(url: string, fallbackPid = "") {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    if (!isFlipkartUrl(parsedUrl.href)) {
      return null;
    }

    const response = await fetchHtml(url, 1);
    const expectedPid = normalizeWhitespace(parsedUrl.searchParams.get("pid") || fallbackPid);
    const finalUrl = new URL(response.url || url);
    const finalPid = normalizeWhitespace(finalUrl.searchParams.get("pid") || "");
    if (!isFlipkartUrl(finalUrl.href) || (expectedPid && finalPid !== expectedPid)) return null;
    const pid = expectedPid || finalPid;
    const lid =
      extractLidFromText(response.url) ||
      extractLidFromText(response.html);

    if (!pid || !lid || !lid.startsWith(`LST${pid}`)) {
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
  const cards = $('a[href*="/p/"]');
  const firstCard = preferredPid
    ? cards.filter((_, element) => {
        try {
          const link = new URL($(element).attr("href") || "", "https://www.flipkart.com");
          return isFlipkartUrl(link.href) && link.searchParams.get("pid") === preferredPid;
        } catch { return false; }
      }).first()
    : cards.first();
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

    if (!isFlipkartUrl(url) || !pid || !lid || !lid.startsWith(`LST${pid}`)) return null;

    return { pid, lid };
  } catch {
    return null;
  }
}

function extractLidFromText(value: string) {
  const patterns = [
    /[?&]lid=([A-Z0-9]+)/i,
    /["']lid["']\s*[:=]\s*["']([A-Z0-9]+)["']/i,
    /\blid\b\s*[:=]\s*([A-Z0-9]+)/i,
    /"listing_id":"([A-Z0-9]+)"/i,
    /"lid":"([A-Z0-9]+)"/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    const lid = normalizeWhitespace(match?.[1] || "");
    if (lid) {
      return lid;
    }
  }

  return "";
}

