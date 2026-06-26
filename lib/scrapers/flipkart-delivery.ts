import * as cheerio from "cheerio";
import { resolveFlipkartIdentity } from "@/lib/scrapers/flipkart-resolver";
import { fetchHtml, normalizeWhitespace } from "@/lib/scrapers/shared";
import type { DeliveryMarketplaceResult, SourceRow } from "@/types";

export async function scrapeFlipkartDelivery(row: SourceRow, pincode: string): Promise<DeliveryMarketplaceResult> {
  try {
    const identity = await resolveFlipkartIdentity(row);

    if (!identity) {
      return failureResult("Flipkart product page could not be resolved.");
    }

    const deliveryUrl =
      `https://www.flipkart.com/item/product-delivery/itemId?pageKey=delivery-page&marketplace=FLIPKART` +
      `&pin=${encodeURIComponent(pincode)}&lid=${encodeURIComponent(identity.lid)}&pid=${encodeURIComponent(identity.pid)}`;

    const response = await fetchHtml(deliveryUrl, 1);
    const parsed = parseFlipkartDeliveryResponse(response.html);

    return {
      marketplace: "flipkart",
      ok: Boolean(parsed.deliveryLabel || parsed.deliveryDate),
      blocked: false,
      attempts: 1,
      url: deliveryUrl,
      notes: `${parsed.notes} Product was resolved using ${identity.resolvedBy}.`,
      deliveryLabel: parsed.deliveryLabel,
      deliveryDate: parsed.deliveryDate
    };
  } catch (error) {
    return failureResult(error instanceof Error ? error.message : "Flipkart delivery check failed.");
  }
}

function parseFlipkartDeliveryResponse(html: string) {
  const $ = cheerio.load(html);
  const listItems = $("li, ._1uR9yB, .hVvnXm, .Y8v7Fl")
    .map((_, element) => normalizeWhitespace($(element).text()))
    .get()
    .filter(Boolean);

  const pageText = normalizeWhitespace($.text());
  const deliveryByIndex = listItems.findIndex((item) => item.toLowerCase().includes("delivery by"));

  if (deliveryByIndex >= 0) {
    return {
      deliveryLabel: listItems[deliveryByIndex] || "",
      deliveryDate: listItems[deliveryByIndex + 1] || "",
      notes: "Delivery details captured from Flipkart."
    };
  }

  const deliveryMatch = pageText.match(/Delivery by\s+([A-Za-z0-9,\s]+)/i);
  if (deliveryMatch) {
    return {
      deliveryLabel: "Delivery by",
      deliveryDate: normalizeWhitespace(deliveryMatch[1] || ""),
      notes: "Delivery details captured from Flipkart."
    };
  }

  return {
    deliveryLabel: "",
    deliveryDate: "",
    notes: "Flipkart delivery details were not available for this pincode."
  };
}

function failureResult(notes: string): DeliveryMarketplaceResult {
  return {
    marketplace: "flipkart",
    ok: false,
    blocked: false,
    attempts: 1,
    url: "",
    notes,
    deliveryLabel: "",
    deliveryDate: ""
  };
}
