import Papa from "papaparse";
import type { SourceRow } from "../types";
import { normalizeSourceRow } from "./source-row";

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

  return normalizeSourceRow({
    sku: firstValue(row, ["SKU", "SKU Id", "Sku", "sku", "Seller SKU", "Product SKU"]),
    asin: firstValue(row, ["Amazon ASIN", "ASIN", "Asin"]),
    fsn: firstValue(row, ["FSN", "Fsn"]),
    title: firstValue(row, ["Product Name", "Title", "Name", "Item Name"]),
    searchQuery: firstValue(row, ["Search Query", "Search", "Query", "Keyword"]),
    amazonUrl: rawAmazonLink,
    flipkartUrl: rawFlipkartLink
  });
}

function firstValue(row: RawRow, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(row[key]);
    if (value) return value;
  }
  return "";
}

function cleanText(value: string | undefined) {
  return String(value ?? "").trim();
}
