import { parseCsvToRows } from "@/lib/csv";
import { scrapeAmazon } from "@/lib/scrapers/amazon";
import { scrapeFlipkart } from "@/lib/scrapers/flipkart";
import type { CheckPricesResponse, RowResult, SourceRow } from "@/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      amazonAttemptOffset?: number;
      amazonMaxAttempts?: number;
      csvText?: string;
      includeFlipkart?: boolean;
      limit?: number;
      rows?: SourceRow[];
    };
    const csvText = String(body.csvText || "");
    const limit = clampLimit(body.limit);
    const includeFlipkart = body.includeFlipkart !== false;
    const selectedRows = resolveRows(body.rows, csvText).slice(0, limit);

    if (!selectedRows.length) {
      return Response.json({ error: "No usable rows were found in the CSV." }, { status: 400 });
    }

    const results: RowResult[] = [];

    for (const row of selectedRows) {
      const amazonPromise = scrapeAmazon(row, {
        attemptOffset: clampAttemptOffset(body.amazonAttemptOffset),
        maxAttempts: clampAmazonMaxAttempts(body.amazonMaxAttempts)
      });
      const flipkartPromise = includeFlipkart
        ? scrapeFlipkart(row)
        : Promise.resolve({
            marketplace: "flipkart" as const,
            ok: false,
            blocked: false,
            price: null,
            currency: "INR",
            title: "",
            url: "",
            notes: "Flipkart skipped during Amazon retry batch.",
            attempts: 0,
            completed: true
          });
      const [amazon, flipkart] = await Promise.all([amazonPromise, flipkartPromise]);

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

function clampAttemptOffset(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value as number));
}

function clampAmazonMaxAttempts(value: number | undefined) {
  if (!Number.isFinite(value)) return 2;
  return Math.min(Math.max(Math.trunc(value as number), 1), 5);
}

function resolveRows(rows: SourceRow[] | undefined, csvText: string) {
  if (Array.isArray(rows) && rows.length) {
    return rows.map(normalizeIncomingRow);
  }

  if (!csvText.trim()) {
    throw new Error("CSV text or rows are required.");
  }

  return parseCsvToRows(csvText);
}

function normalizeIncomingRow(row: SourceRow): SourceRow {
  return {
    sku: cleanText(row.sku),
    asin: cleanText(row.asin),
    fsn: cleanText(row.fsn),
    title: cleanText(row.title),
    searchQuery: cleanText(row.searchQuery),
    amazonUrl: cleanText(row.amazonUrl),
    flipkartUrl: cleanText(row.flipkartUrl)
  };
}

function cleanText(value: string | undefined) {
  return String(value ?? "").trim();
}
