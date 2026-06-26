import { parseCsvToRows } from "@/lib/csv";
import { scrapeAmazonDelivery } from "@/lib/scrapers/amazon-delivery";
import { scrapeFlipkartDelivery } from "@/lib/scrapers/flipkart-delivery";
import type { CheckDeliveryResponse, DeliveryRowResult, SourceRow } from "@/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      csvText?: string;
      pincodes?: string[];
      rows?: SourceRow[];
    };

    const selectedRows = resolveRows(body.rows, String(body.csvText || ""));
    const pincodes = normalizePincodes(body.pincodes);

    if (!selectedRows.length) {
      return Response.json({ error: "No usable rows were found in the CSV." }, { status: 400 });
    }

    if (!pincodes.length) {
      return Response.json({ error: "Enter at least one valid pincode." }, { status: 400 });
    }

    const results: DeliveryRowResult[] = [];

    for (const row of selectedRows) {
      for (const pincode of pincodes) {
        const [amazon, flipkart] = await Promise.all([
          scrapeAmazonDelivery(row, pincode),
          scrapeFlipkartDelivery(row, pincode)
        ]);

        results.push({
          sku: row.sku,
          asin: row.asin,
          fsn: row.fsn,
          title: row.title || row.searchQuery || row.sku || row.asin || row.fsn,
          pincode,
          amazon,
          flipkart
        });
      }
    }

    const payload: CheckDeliveryResponse = {
      checkedAt: new Date().toISOString(),
      totalRows: results.length,
      rows: results
    };

    return Response.json(payload);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Delivery check failed."
      },
      { status: 500 }
    );
  }
}

function resolveRows(rows: SourceRow[] | undefined, csvText: string) {
  if (Array.isArray(rows) && rows.length) {
    return rows.map(normalizeIncomingRow).filter((row) => row.sku || row.asin || row.fsn || row.title || row.searchQuery);
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

function normalizePincodes(pincodes: string[] | undefined) {
  if (!Array.isArray(pincodes)) return [];

  return Array.from(
    new Set(
      pincodes
        .map((value) => cleanText(value).replace(/\D+/g, ""))
        .filter((value) => value.length === 6)
    )
  );
}

function cleanText(value: string | undefined) {
  return String(value ?? "").trim();
}
