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
    .filter((row) => row.sku || row.asin || row.fsn || row.searchQuery || row.title);
}

function normalizeRow(row: RawRow): SourceRow {
  return {
    sku: firstValue(row, ["SKU", "SKU Id", "Sku", "sku", "Seller SKU", "Product SKU"]),
    asin: firstValue(row, ["Amazon ASIN", "ASIN", "Asin"]),
    fsn: firstValue(row, ["FSN", "Fsn"]),
    title: firstValue(row, ["Product Name", "Title", "Name", "Item Name"]),
    searchQuery: firstValue(row, ["Search Query", "Search", "Query", "Keyword"]),
    amazonUrl: normalizeUrl(firstValue(row, ["Amazon URL", "Amazon Link", "Amazon Product URL", "Amazon"])),
    flipkartUrl: normalizeUrl(firstValue(row, ["Flipkart URL", "Flipkart Link", "Flipkart Product URL", "Flipkart"]))
  };
}

function firstValue(row: RawRow, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(row[key]);
    if (value) return value;
  }
  return "";
}

function normalizeUrl(value: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

function cleanText(value: string | undefined) {
  return String(value ?? "").trim();
}
