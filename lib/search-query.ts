import type { SourceRow } from "@/types";

export function buildSearchQuery(row: SourceRow) {
  return [row.searchQuery, row.title, row.sku, row.fsn].filter(Boolean).join(" ").trim();
}
