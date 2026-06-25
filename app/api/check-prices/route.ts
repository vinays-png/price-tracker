import { parseCsvToRows } from "@/lib/csv";
import { scrapeAmazon } from "@/lib/scrapers/amazon";
import { scrapeFlipkart } from "@/lib/scrapers/flipkart";
import type { CheckPricesResponse, RowResult } from "@/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { csvText?: string; limit?: number };
    const csvText = String(body.csvText || "");

    if (!csvText.trim()) {
      return Response.json({ error: "CSV text is required." }, { status: 400 });
    }

    const rows = parseCsvToRows(csvText);
    const limit = clampLimit(body.limit);
    const selectedRows = rows.slice(0, limit);

    if (!selectedRows.length) {
      return Response.json({ error: "No usable rows were found in the CSV." }, { status: 400 });
    }

    const results: RowResult[] = [];

    for (const row of selectedRows) {
      const [amazon, flipkart] = await Promise.all([
        scrapeAmazon(row),
        scrapeFlipkart(row)
      ]);

      results.push({
        sku: row.sku,
        asin: row.asin,
        fsn: row.fsn,
        title: row.title || row.searchQuery || row.sku || row.asin || row.fsn,
        amazon,
        flipkart
      });
    }

    const payload: CheckPricesResponse = {
      checkedAt: new Date().toISOString(),
      totalRows: selectedRows.length,
      rows: results
    };

    return Response.json(payload);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Price check failed."
      },
      { status: 500 }
    );
  }
}

function clampLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return 25;
  return Math.min(Math.max(Math.trunc(value as number), 1), 100);
}
