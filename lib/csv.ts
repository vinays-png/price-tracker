import Papa from "papaparse";
import type { SourceRow } from "@/types";

type RawRow = Record<string, string | undefined>;

export function parseCsvToRows(csvText: string): SourceRow[] {
  const parsed = Papa.parse<RawRow>(csvText, {
    header: true,
    skipEmptyLines: "greedy"
  });

  if (parsed.errors.length) {
    throw new Error(parsed.errors[0]?.message || "CSV parsing failed.");
  }

  return parsed.data
    .map(normalizeRow)
    .filter(
      (row) =>
        row.sku ||
        row.asin ||
        row.fsn ||
        row.searchQuery ||
        row.title ||
        row.amazonUrl ||
        row.flipkartUrl
    );
}

function normalizeRow(row: RawRow): SourceRow {
  const rawAmazonLink = firstValue(row, ["Amazon URL", "Amazon Link", "Amazon Product URL", "Amazon"]);
  const rawFlipkartLink = firstValue(row, ["Flipkart URL", "Flipkart Link", "Flipkart Product URL", "Flipkart"]);

  return {
    sku: firstValue(row, ["SKU", "SKU Id", "Sku", "sku", "Seller SKU", "Product SKU"]),
    asin: firstValue(row, ["Amazon ASIN", "ASIN", "Asin"]),
    fsn: firstValue(row, ["FSN", "Fsn"]),
    title: firstValue(row, ["Product Name", "Title", "Name", "Item Name"]),
    searchQuery: firstValue(row, ["Search Query", "Search", "Query", "Keyword"]),
    amazonUrl: normalizeUrl(rawAmazonLink, ["amazon."]),
    flipkartUrl: normalizeFlipkartValue(rawFlipkartLink)
  };
}

function firstValue(row: RawRow, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(row[key]);
    if (value) return value;
  }
  return "";
}

function normalizeUrl(value: string, allowedHosts: string[] = []) {
  if (!value) return "";
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return matchesAllowedHost(trimmed, allowedHosts) ? trimmed : "";
  }

  const normalized = `https://${trimmed.replace(/^\/+/, "")}`;
  return matchesAllowedHost(normalized, allowedHosts) ? normalized : "";
}

function normalizeFlipkartValue(value: string) {
  const normalizedUrl = normalizeUrl(value, ["flipkart.com"]);
  if (normalizedUrl) return normalizedUrl;
  return value.trim();
}

function matchesAllowedHost(value: string, allowedHosts: string[]) {
  if (!allowedHosts.length) return true;

  try {
    const parsedUrl = new URL(value);
    const hostname = parsedUrl.hostname.toLowerCase();
    return allowedHosts.some((host) => hostname.includes(host));
  } catch {
    return false;
  }
}

function cleanText(value: string | undefined) {
  return String(value ?? "").trim();
}
