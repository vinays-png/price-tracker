"use client";

import { ChangeEvent, useState } from "react";
import { parseCsvToRows } from "@/lib/csv";
import type {
  CheckDeliveryResponse,
  CheckPricesResponse,
  DeliveryMarketplaceResult,
  DeliveryRowResult,
  RowResult,
  SourceRow
} from "@/types";

type Mode = "prices" | "delivery";

type ProgressState = {
  completed: number;
  currentLabel: string;
  remaining: number;
  total: number;
};

type PriceState = {
  csvText: string;
  error: string;
  fileName: string;
  isLoading: boolean;
  progress: ProgressState | null;
  result: CheckPricesResponse | null;
};

type DeliveryState = {
  csvText: string;
  error: string;
  fileName: string;
  isLoading: boolean;
  pincodes: string;
  progress: ProgressState | null;
  result: CheckDeliveryResponse | null;
};

const INITIAL_PRICE_STATE: PriceState = {
  csvText: "",
  error: "",
  fileName: "",
  isLoading: false,
  progress: null,
  result: null
};

type WorkbookCell = {
  mergeAcross?: number;
  styleId?: string;
  value: number | string;
};

type WorkbookRow = WorkbookCell[];

type WorkbookSheet = {
  name: string;
  rows: WorkbookRow[];
};

const INITIAL_DELIVERY_STATE: DeliveryState = {
  csvText: "",
  error: "",
  fileName: "",
  isLoading: false,
  pincodes: "",
  progress: null,
  result: null
};

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("prices");
  const [priceState, setPriceState] = useState<PriceState>(INITIAL_PRICE_STATE);
  const [deliveryState, setDeliveryState] = useState<DeliveryState>(INITIAL_DELIVERY_STATE);

  async function onPriceFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setPriceState((current) => ({
      ...current,
      csvText: text,
      error: "",
      fileName: file.name,
      result: null
    }));
  }

  async function onDeliveryFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setDeliveryState((current) => ({
      ...current,
      csvText: text,
      error: "",
      fileName: file.name,
      result: null
    }));
  }

  async function runPriceCheck() {
    if (!priceState.csvText.trim()) {
      setPriceState((current) => ({ ...current, error: "Upload a CSV file first." }));
      return;
    }

    setPriceState((current) => ({
      ...current,
      error: "",
      isLoading: true,
      progress: null,
      result: null
    }));

    try {
      const selectedRows = getProcessableRows(priceState.csvText);
      const completedRows: RowResult[] = [];

      for (let index = 0; index < selectedRows.length; index += 1) {
        const row = selectedRows[index];
        let amazonAttemptOffset = 0;
        let rowResult: RowResult | null = null;
        let flipkartResult: RowResult["flipkart"] | null = null;

        setPriceState((current) => ({
          ...current,
          progress: {
            completed: index,
            currentLabel: buildRowLabel(row),
            remaining: selectedRows.length - index,
            total: selectedRows.length
          }
        }));

        while (true) {
          setPriceState((current) => ({
            ...current,
            progress: {
              completed: index,
              currentLabel: `${buildRowLabel(row)} | Amazon attempt ${amazonAttemptOffset + 1}`,
              remaining: selectedRows.length - index,
              total: selectedRows.length
            }
          }));

          const data = await postJson<CheckPricesResponse>("/api/check-prices", {
            amazonAttemptOffset,
            amazonMaxAttempts: 2,
            includeFlipkart: amazonAttemptOffset === 0,
            limit: 1,
            rows: [row]
          });

          const nextRow = data.rows[0];
          if (!nextRow) {
            throw new Error("The server returned no row result.");
          }

          if (!flipkartResult && nextRow.flipkart.attempts > 0) {
            flipkartResult = nextRow.flipkart;
          }

          const mergedRowResult: RowResult = {
            ...nextRow,
            flipkart: flipkartResult ?? nextRow.flipkart
          };
          rowResult = mergedRowResult;

          setPriceState((current) => ({
            ...current,
            result: {
              checkedAt: new Date().toISOString(),
              totalRows: selectedRows.length,
              rows: [...completedRows, mergedRowResult]
            }
          }));

          if (mergedRowResult.amazon.price !== null || mergedRowResult.amazon.completed !== false) {
            break;
          }

          amazonAttemptOffset = mergedRowResult.amazon.attempts;
        }

        if (!rowResult) {
          throw new Error("The server did not produce a row result.");
        }

        completedRows.push(rowResult);
        setPriceState((current) => ({
          ...current,
          progress: {
            completed: index + 1,
            currentLabel: buildRowLabel(row),
            remaining: selectedRows.length - (index + 1),
            total: selectedRows.length
          },
          result: {
            checkedAt: new Date().toISOString(),
            totalRows: selectedRows.length,
            rows: [...completedRows]
          }
        }));
      }
    } catch (caughtError) {
      setPriceState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Something went wrong."
      }));
    } finally {
      finishPriceLoading();
    }
  }

  async function runDeliveryCheck() {
    if (!deliveryState.csvText.trim()) {
      setDeliveryState((current) => ({ ...current, error: "Upload a CSV file first." }));
      return;
    }

    const pincodes = parsePincodes(deliveryState.pincodes);
    if (!pincodes.length) {
      setDeliveryState((current) => ({ ...current, error: "Enter at least one 6-digit pincode." }));
      return;
    }

    setDeliveryState((current) => ({
      ...current,
      error: "",
      isLoading: true,
      progress: null,
      result: null
    }));

    try {
      const selectedRows = getProcessableRows(deliveryState.csvText);
      const completedRows: DeliveryRowResult[] = [];
      const totalChecks = selectedRows.length * pincodes.length;
      let completedChecks = 0;

      for (const row of selectedRows) {
        for (const pincode of pincodes) {
          setDeliveryState((current) => ({
            ...current,
            progress: {
              completed: completedChecks,
              currentLabel: `${buildRowLabel(row)} | ${pincode}`,
              remaining: totalChecks - completedChecks,
              total: totalChecks
            }
          }));

          const data = await postJson<CheckDeliveryResponse>("/api/check-delivery", {
            rows: [row],
            pincodes: [pincode]
          });

          const nextRow = data.rows[0];
          if (!nextRow) {
            throw new Error("The server returned no delivery result.");
          }

          completedRows.push(nextRow);
          completedChecks += 1;

          setDeliveryState((current) => ({
            ...current,
            progress: {
              completed: completedChecks,
              currentLabel: `${buildRowLabel(row)} | ${pincode}`,
              remaining: totalChecks - completedChecks,
              total: totalChecks
            },
            result: {
              checkedAt: new Date().toISOString(),
              totalRows: totalChecks,
              rows: [...completedRows]
            }
          }));
        }
      }
    } catch (caughtError) {
      setDeliveryState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Something went wrong."
      }));
    } finally {
      finishDeliveryLoading();
    }
  }

  function finishPriceLoading() {
    setPriceState((current) => ({
      ...current,
      isLoading: false,
      progress: current.progress
        ? {
            ...current.progress,
            currentLabel: "",
            remaining: 0
          }
        : null
    }));
  }

  function finishDeliveryLoading() {
    setDeliveryState((current) => ({
      ...current,
      isLoading: false,
      progress: current.progress
        ? {
            ...current.progress,
            currentLabel: "",
            remaining: 0
          }
        : null
    }));
  }

  function downloadPriceResults() {
    downloadCsvRows(buildPriceExportRows(priceState.result), "marketplace-prices");
  }

  function downloadDeliveryResults() {
    downloadWorkbook(buildDeliveryWorkbook(deliveryState.result), "marketplace-delivery");
  }

  const priceHasResults = Boolean(priceState.result && priceState.result.rows.length);
  const deliveryHasResults = Boolean(deliveryState.result && deliveryState.result.rows.length);
  const priceProgressMessage = priceState.progress
    ? `Completed ${priceState.progress.completed} of ${priceState.progress.total} | Remaining ${priceState.progress.remaining}${
        priceState.progress.currentLabel ? ` | Current ${priceState.progress.currentLabel}` : ""
      }`
    : "";
  const deliveryProgressMessage = deliveryState.progress
    ? `Completed ${deliveryState.progress.completed} of ${deliveryState.progress.total} | Remaining ${deliveryState.progress.remaining}${
        deliveryState.progress.currentLabel ? ` | Current ${deliveryState.progress.currentLabel}` : ""
      }`
    : "";

  const totalAmazonBlocked = priceState.result?.rows.filter((row) => row.amazon.blocked).length ?? 0;
  const totalAmazonSuccess = priceState.result?.rows.filter((row) => row.amazon.ok && row.amazon.price !== null).length ?? 0;
  const totalFlipkartSuccess = priceState.result?.rows.filter((row) => row.flipkart.ok && row.flipkart.price !== null).length ?? 0;
  const totalDeliveryChecks = deliveryState.result?.rows.length ?? 0;
  const totalAmazonDelivery = deliveryState.result?.rows.filter((row) => row.amazon.ok && row.amazon.deliveryDate).length ?? 0;
  const totalFlipkartDelivery = deliveryState.result?.rows.filter((row) => row.flipkart.ok && row.flipkart.deliveryDate).length ?? 0;

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="nav-strip">
          <button className={`nav-pill ${mode === "prices" ? "nav-pill-active" : ""}`} onClick={() => setMode("prices")}>
            Price Scraper
          </button>
          <button className={`nav-pill ${mode === "delivery" ? "nav-pill-active" : ""}`} onClick={() => setMode("delivery")}>
            Delivery Checker
          </button>
        </div>
        <h1>Marketplace Price Scraper</h1>
        <p>
          Upload a CSV with <strong>SKU Id</strong>, <strong>FSN</strong>, <strong>Flipkart Link</strong>,{" "}
          <strong>ASIN</strong>, and <strong>Amazon Link</strong>. Each tab keeps its own file, progress, and
          results so price and delivery jobs can run independently.
        </p>
      </section>

      <section className="layout-grid">
        {mode === "prices" ? (
          <>
            <aside className="panel controls">
              <div className="field">
                <label htmlFor="priceCsvFile">CSV File</label>
                <input id="priceCsvFile" type="file" accept=".csv,text/csv" onChange={onPriceFileChange} />
              </div>

              <div className="button-row">
                <button className="button button-primary" onClick={runPriceCheck} disabled={priceState.isLoading}>
                  {priceState.isLoading ? "Checking prices..." : "Fetch Prices"}
                </button>
                <button className="button button-secondary" onClick={downloadPriceResults} disabled={!priceState.result}>
                  Export Results CSV
                </button>
              </div>

              <p className="note">
                File: <strong>{priceState.fileName || "No CSV selected"}</strong>
              </p>
              <p className="note">
                The app automatically processes every row that has a SKU, marketplace ID, title, or direct product
                link.
              </p>
              <p className="note">
                Amazon retries continue in small request batches until a price is found, so the app can keep working
                without hitting Vercel function limits.
              </p>
            </aside>

            <section className="panel results">
              {priceState.error ? <p className="status">{priceState.error}</p> : null}
              {priceProgressMessage ? <p className="status">{priceProgressMessage}</p> : null}

              {!priceHasResults && priceState.isLoading ? (
                <div>
                  <p className="eyebrow">Fetching</p>
                  <p>The app is processing your CSV now. Partial price results will appear as each SKU finishes.</p>
                </div>
              ) : !priceHasResults ? (
                <div>
                  <p className="eyebrow">Ready</p>
                  <p>
                    Upload the source CSV and run a fetch. Results will appear here with prices, source URLs, retry
                    counts, and scrape notes.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="status">
                    Checked {priceState.result!.totalRows} rows at {new Date(priceState.result!.checkedAt).toLocaleString()}.
                  </p>

                  <div className="card-grid">
                    <div className="stat-card">
                      <p className="eyebrow">Amazon Success</p>
                      <p className="stat-value">{totalAmazonSuccess}</p>
                    </div>
                    <div className="stat-card">
                      <p className="eyebrow">Flipkart Success</p>
                      <p className="stat-value">{totalFlipkartSuccess}</p>
                    </div>
                    <div className="stat-card">
                      <p className="eyebrow">Amazon Blocked</p>
                      <p className="stat-value">{totalAmazonBlocked}</p>
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>ASIN</th>
                          <th>FSN</th>
                          <th>Amazon</th>
                          <th>Flipkart</th>
                        </tr>
                      </thead>
                      <tbody>
                        {priceState.result!.rows.map((row) => (
                          <tr key={`${row.sku}-${row.asin}-${row.fsn}`}>
                            <td>
                              <strong>{row.sku || "-"}</strong>
                              <div className="tiny">{row.title}</div>
                            </td>
                            <td>{row.asin || "-"}</td>
                            <td>{row.fsn || "-"}</td>
                            <td>
                              <MarketplaceCell
                                price={row.amazon.price}
                                notes={row.amazon.notes}
                                attempts={row.amazon.attempts}
                                blocked={row.amazon.blocked}
                                url={row.amazon.url}
                              />
                            </td>
                            <td>
                              <MarketplaceCell
                                price={row.flipkart.price}
                                notes={row.flipkart.notes}
                                attempts={row.flipkart.attempts}
                                blocked={false}
                                url={row.flipkart.url}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <aside className="panel controls">
              <div className="field">
                <label htmlFor="deliveryCsvFile">CSV File</label>
                <input id="deliveryCsvFile" type="file" accept=".csv,text/csv" onChange={onDeliveryFileChange} />
              </div>

              <div className="field">
                <label htmlFor="pincodes">Pincodes</label>
                <textarea
                  id="pincodes"
                  className="text-area"
                  placeholder="560103, 110001&#10;Enter one or many pincodes"
                  value={deliveryState.pincodes}
                  onChange={(event) => setDeliveryState((current) => ({ ...current, pincodes: event.target.value }))}
                />
              </div>

              <div className="button-row">
                <button className="button button-primary" onClick={runDeliveryCheck} disabled={deliveryState.isLoading}>
                  {deliveryState.isLoading ? "Checking delivery..." : "Fetch Delivery Dates"}
                </button>
                <button className="button button-secondary" onClick={downloadDeliveryResults} disabled={!deliveryState.result}>
                  Export Results Workbook
                </button>
              </div>

              <p className="note">
                File: <strong>{deliveryState.fileName || "No CSV selected"}</strong>
              </p>
              <p className="note">
                The app automatically processes every row that has a SKU, marketplace ID, title, or direct product
                link.
              </p>
              <p className="note">
                Flipkart delivery dates are checked by pincode directly, and Flipkart product resolution now treats the
                `pid=` value as the FSN signal when available.
              </p>
            </aside>

            <section className="panel results">
              {deliveryState.error ? <p className="status">{deliveryState.error}</p> : null}
              {deliveryProgressMessage ? <p className="status">{deliveryProgressMessage}</p> : null}

              {!deliveryHasResults && deliveryState.isLoading ? (
                <div>
                  <p className="eyebrow">Fetching</p>
                  <p>The app is checking delivery dates across your SKU rows and pincodes now.</p>
                </div>
              ) : !deliveryHasResults ? (
                <div>
                  <p className="eyebrow">Ready</p>
                  <p>
                    Upload the source CSV, add one or more pincodes, and run a fetch. Results will appear here with
                    delivery dates, source URLs, and scrape notes.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="status">
                    Checked {deliveryState.result!.totalRows} delivery combinations at{" "}
                    {new Date(deliveryState.result!.checkedAt).toLocaleString()}.
                  </p>

                  <div className="card-grid">
                    <div className="stat-card">
                      <p className="eyebrow">Checks Run</p>
                      <p className="stat-value">{totalDeliveryChecks}</p>
                    </div>
                    <div className="stat-card">
                      <p className="eyebrow">Amazon Delivery</p>
                      <p className="stat-value">{totalAmazonDelivery}</p>
                    </div>
                    <div className="stat-card">
                      <p className="eyebrow">Flipkart Delivery</p>
                      <p className="stat-value">{totalFlipkartDelivery}</p>
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>ASIN</th>
                          <th>FSN</th>
                          <th>Pincode</th>
                          <th>Amazon</th>
                          <th>Flipkart</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveryState.result!.rows.map((row) => (
                          <tr key={`${row.sku}-${row.asin}-${row.fsn}-${row.pincode}`}>
                            <td>
                              <strong>{row.sku || "-"}</strong>
                              <div className="tiny">{row.title}</div>
                            </td>
                            <td>{row.asin || "-"}</td>
                            <td>{row.fsn || "-"}</td>
                            <td>{row.pincode}</td>
                            <td>
                              <DeliveryCell result={row.amazon} />
                            </td>
                            <td>
                              <DeliveryCell result={row.flipkart} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}

async function postJson<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const rawText = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const trimmedText = rawText.trim();
    const friendlyMessage = trimmedText.startsWith("<")
      ? "The server returned HTML instead of JSON. Check deployment protection or the server response."
      : trimmedText || "The server returned a non-JSON response.";
    throw new Error(friendlyMessage);
  }

  const data = JSON.parse(rawText) as { error?: string };

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data as T;
}

function getProcessableRows(csvText: string) {
  const parsedRows = parseCsvToRows(csvText);
  const selectedRows = parsedRows.filter(
    (row) =>
      Boolean(row.sku.trim()) ||
      Boolean(row.asin.trim()) ||
      Boolean(row.fsn.trim()) ||
      Boolean(row.title.trim()) ||
      Boolean(row.searchQuery.trim()) ||
      Boolean(row.amazonUrl.trim()) ||
      Boolean(row.flipkartUrl.trim())
  );

  if (!selectedRows.length) {
    throw new Error("No usable rows with SKU details, marketplace IDs, titles, or links were found in the CSV.");
  }

  return selectedRows;
}

function downloadCsvRows(rows: Array<Array<string | number>>, fileStem: string) {
  if (!rows.length) return;

  const csv = rows
    .map((line) =>
      line
        .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileStem}-${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadWorkbook(workbook: WorkbookSheet[], fileStem: string) {
  if (!workbook.length) return;

  const xml = buildWorkbookXml(workbook);
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileStem}-${Date.now()}.xml`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parsePincodes(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.replace(/\D+/g, "").trim())
        .filter((entry) => entry.length === 6)
    )
  );
}

function buildPriceExportRows(result: CheckPricesResponse | null) {
  if (!result) return [];

  return [
    [
      "SKU",
      "ASIN",
      "FSN",
      "Title",
      "Amazon Price",
      "Amazon Attempts",
      "Amazon Notes",
      "Amazon URL",
      "Flipkart Price",
      "Flipkart Notes",
      "Flipkart URL"
    ],
    ...result.rows.map((row) => [
      row.sku,
      row.asin,
      row.fsn,
      row.title,
      row.amazon.price ?? "",
      row.amazon.attempts,
      row.amazon.notes,
      row.amazon.url,
      row.flipkart.price ?? "",
      row.flipkart.notes,
      row.flipkart.url
    ])
  ];
}

function buildDeliveryExportRows(result: CheckDeliveryResponse | null) {
  if (!result) return [];

  return [
    [
      "SKU",
      "ASIN",
      "FSN",
      "Title",
      "Pincode",
      "Amazon Delivery Label",
      "Amazon Delivery Date",
      "Amazon Notes",
      "Amazon URL",
      "Flipkart Delivery Label",
      "Flipkart Delivery Date",
      "Flipkart Notes",
      "Flipkart URL"
    ],
    ...result.rows.map((row) => [
      row.sku,
      row.asin,
      row.fsn,
      row.title,
      row.pincode,
      row.amazon.deliveryLabel,
      row.amazon.deliveryDate,
      row.amazon.notes,
      row.amazon.url,
      row.flipkart.deliveryLabel,
      row.flipkart.deliveryDate,
      row.flipkart.notes,
      row.flipkart.url
    ])
  ];
}

function buildDeliveryWorkbook(result: CheckDeliveryResponse | null): WorkbookSheet[] {
  if (!result) return [];

  return [
    {
      name: "Details",
      rows: buildDeliveryExportRows(result).map((row, rowIndex) =>
        row.map((value) => ({
          styleId: rowIndex === 0 ? "header" : "body",
          value
        }))
      )
    },
    {
      name: "Summary",
      rows: buildDeliverySummaryRows(result)
    }
  ];
}

function buildDeliverySummaryRows(result: CheckDeliveryResponse): WorkbookRow[] {
  const pincodes = uniqueInOrder(result.rows.map((row) => row.pincode));
  const rowsBySku = new Map<string, DeliveryRowResult[]>();

  for (const row of result.rows) {
    const skuKey = row.sku || row.title || row.asin || row.fsn || "Unknown SKU";
    const bucket = rowsBySku.get(skuKey) ?? [];
    bucket.push(row);
    rowsBySku.set(skuKey, bucket);
  }

  const workbookRows: WorkbookRow[] = [
    [
      { styleId: "groupSpacer", value: "" },
      { mergeAcross: Math.max(pincodes.length - 1, 0), styleId: "groupFk", value: "FK" },
      { mergeAcross: Math.max(pincodes.length - 1, 0), styleId: "groupAmz", value: "AMZ" }
    ],
    [
      { styleId: "header", value: "SKU" },
      ...pincodes.map((pincode) => ({ styleId: "header", value: pincode })),
      ...pincodes.map((pincode) => ({ styleId: "header", value: pincode }))
    ]
  ];

  for (const [skuKey, skuRows] of rowsBySku) {
    const rowByPincode = new Map(skuRows.map((row) => [row.pincode, row] as const));
    workbookRows.push([
      { styleId: "sku", value: skuKey },
      ...pincodes.map((pincode) => ({
        styleId: "summaryValue",
        value: summarizeDeliveryValue(rowByPincode.get(pincode)?.flipkart, result.checkedAt)
      })),
      ...pincodes.map((pincode) => ({
        styleId: "summaryValue",
        value: summarizeDeliveryValue(rowByPincode.get(pincode)?.amazon, result.checkedAt)
      }))
    ]);
  }

  return workbookRows;
}

function summarizeDeliveryValue(result: DeliveryMarketplaceResult | undefined, checkedAt: string) {
  if (!result || !result.ok || !result.deliveryDate) {
    return "";
  }

  const explicitRange = extractRangeFromText(result.deliveryDate);
  if (explicitRange) {
    return explicitRange;
  }

  const textForDates = result.marketplace === "amazon" ? result.deliveryDate.split(/Or fastest delivery/i)[0] : result.deliveryDate;
  const dateOffsets = extractDeliveryDayOffsets(textForDates, checkedAt);
  if (dateOffsets.length) {
    return dateOffsets[0] === dateOffsets[dateOffsets.length - 1]
      ? String(dateOffsets[0])
      : `${dateOffsets[0]}-${dateOffsets[dateOffsets.length - 1]}`;
  }

  const relativeDay = extractRelativeDay(result.deliveryDate);
  return relativeDay === null ? result.deliveryDate : String(relativeDay);
}

function extractRangeFromText(value: string) {
  const rangeMatch = value.match(/\b(\d{1,2})\s*[-to]+\s*(\d{1,2})\b/i);
  if (!rangeMatch) return "";

  return `${rangeMatch[1]}-${rangeMatch[2]}`;
}

function extractRelativeDay(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("today")) return 0;
  if (normalized.includes("tomorrow")) return 1;
  return null;
}

function extractDeliveryDayOffsets(value: string, checkedAt: string) {
  const baseDate = toIndiaStartOfDay(checkedAt);
  const dateRegex =
    /\b(?:(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*(\d{4}))?/gi;
  const offsets: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = dateRegex.exec(value)) !== null) {
    const day = Number(match[2]);
    const monthIndex = monthNameToIndex(match[3]);
    if (monthIndex < 0) continue;

    const parsed = buildFutureDate(day, monthIndex, checkedAt, match[4] ? Number(match[4]) : undefined);
    if (!parsed) continue;

    const difference = Math.round((parsed.getTime() - baseDate.getTime()) / 86400000);
    if (difference >= 0) {
      offsets.push(difference);
    }
  }

  return uniqueInOrder(offsets).sort((left, right) => left - right);
}

function monthNameToIndex(value: string) {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return months.indexOf(value.slice(0, 3).toLowerCase());
}

function buildFutureDate(day: number, monthIndex: number, checkedAt: string, explicitYear?: number) {
  const base = toIndiaStartOfDay(checkedAt);
  const baseYear = base.getUTCFullYear();
  const yearCandidates = explicitYear ? [explicitYear] : [baseYear, baseYear + 1];

  for (const year of yearCandidates) {
    const candidate = new Date(Date.UTC(year, monthIndex, day));
    if (explicitYear || candidate.getTime() >= base.getTime()) {
      return candidate;
    }
  }

  return null;
}

function toIndiaStartOfDay(value: string) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function uniqueInOrder<T>(values: T[]) {
  return Array.from(new Set(values));
}

function buildWorkbookXml(sheets: WorkbookSheet[]) {
  const workbookBody = sheets
    .map(
      (sheet) => `
        <Worksheet ss:Name="${xmlEscape(sheet.name)}">
          <Table>
            ${sheet.rows.map((row) => buildWorkbookRowXml(row)).join("")}
          </Table>
        </Worksheet>
      `
    )
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
      <Font ss:FontName="Calibri" ss:Size="11"/>
      <Interior/>
    </Style>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F3EFE8" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="body"/>
    <Style ss:ID="groupSpacer">
      <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="groupFk">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:Bold="1"/>
      <Interior ss:Color="#E7F0DD" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="groupAmz">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F8E8BA" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="sku">
      <Font ss:Bold="1"/>
    </Style>
    <Style ss:ID="summaryValue">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Interior ss:Color="#FCEBD6" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  ${workbookBody}
</Workbook>`;
}

function buildWorkbookRowXml(row: WorkbookRow) {
  return `<Row>${row
    .map((cell) => {
      const type = typeof cell.value === "number" ? "Number" : "String";
      const mergeAcross = cell.mergeAcross ? ` ss:MergeAcross="${cell.mergeAcross}"` : "";
      const style = cell.styleId ? ` ss:StyleID="${cell.styleId}"` : "";
      return `<Cell${style}${mergeAcross}><Data ss:Type="${type}">${xmlEscape(String(cell.value ?? ""))}</Data></Cell>`;
    })
    .join("")}</Row>`;
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildRowLabel(row: SourceRow) {
  return row.sku || row.asin || row.fsn || row.title || row.searchQuery || "current row";
}

function MarketplaceCell(props: {
  price: number | null;
  notes: string;
  attempts: number;
  blocked: boolean;
  url: string;
}) {
  return (
    <div className="market-card">
      <div className={`tag ${props.blocked ? "tag-warn" : "tag-ok"}`}>
        {props.blocked ? "Retrying" : "Checked"} | {props.attempts} attempt{props.attempts === 1 ? "" : "s"}
      </div>
      <h3>{props.price === null ? "Price not found" : formatPrice(props.price)}</h3>
      <p className="tiny">{props.notes}</p>
      {props.url ? (
        <p className="tiny">
          <a href={props.url} target="_blank" rel="noreferrer">
            Open source page
          </a>
        </p>
      ) : null}
    </div>
  );
}

function DeliveryCell({ result }: { result: DeliveryMarketplaceResult }) {
  return (
    <div className="market-card">
      <div className={`tag ${result.blocked ? "tag-warn" : "tag-ok"}`}>
        {result.blocked ? "Blocked" : "Checked"} | {result.attempts} attempt{result.attempts === 1 ? "" : "s"}
      </div>
      <h3>{result.deliveryDate || "Delivery not found"}</h3>
      <p className="tiny">{result.deliveryLabel || result.notes}</p>
      {result.deliveryLabel && result.deliveryDate ? <p className="tiny">{result.notes}</p> : null}
      {result.url ? (
        <p className="tiny">
          <a href={result.url} target="_blank" rel="noreferrer">
            Open source page
          </a>
        </p>
      ) : null}
    </div>
  );
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value);
}
