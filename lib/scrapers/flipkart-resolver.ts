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

  for (const candidate of buildFlipkartSearchQueries(row)) {
    const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(candidate.query)}`;
    const response = await fetchHtml(searchUrl, 1);
    const $ = cheerio.load(response.html);
    const firstCard = $('a[href*="/p/"]').first();
    const href = firstCard.attr("href");

    if (!href) {
      continue;
    }

    const productUrl = new URL(href, "https://www.flipkart.com").toString();
    const identity = parseFlipkartIdentifiers(productUrl);

    if (identity) {
      return {
        ...identity,
        productUrl,
        resolvedBy: candidate.label
      };
    }
  }

  return null;
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
