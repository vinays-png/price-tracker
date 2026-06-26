import type { SourceRow } from "@/types";

export function buildSearchQuery(row: SourceRow) {
  return [row.searchQuery, row.title, row.sku, row.fsn].filter(Boolean).join(" ").trim();
}

export function buildFlipkartSearchQueries(row: SourceRow) {
  const candidates = [
    { label: "FSN", query: row.fsn },
    { label: "SKU", query: row.sku },
    { label: "custom query", query: row.searchQuery },
    { label: "title", query: row.title },
    { label: "combined fallback", query: buildSearchQuery(row) }
  ];

  return candidates.filter(
    (candidate, index, list) =>
      Boolean(candidate.query?.trim()) &&
      list.findIndex((item) => item.query.trim().toLowerCase() === candidate.query.trim().toLowerCase()) === index
  );
}
