import { normalizeAsin, normalizeMarketplaceUrl } from "./marketplace-url";
import type { SourceRow } from "../types";

export function normalizeSourceRow(row: SourceRow): SourceRow {
  const flipkartUrl = normalizeMarketplaceUrl(row.flipkartUrl, "flipkart");
  const linkPid = flipkartUrl ? new URL(flipkartUrl).searchParams.get("pid") || "" : "";
  return {
    sku: cleanText(row.sku),
    asin: normalizeAsin(row.asin),
    fsn: cleanText(row.fsn) || linkPid,
    title: cleanText(row.title),
    searchQuery: cleanText(row.searchQuery),
    amazonUrl: normalizeMarketplaceUrl(row.amazonUrl, "amazon"),
    flipkartUrl: flipkartUrl || cleanText(row.flipkartUrl)
  };
}

function cleanText(value: string | undefined) {
  return String(value ?? "").trim();
}
