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
      const selectedRows = getRowsWithSku(priceState.csvText);
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
      const selectedRows = getRowsWithSku(deliveryState.csvText);
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
    downloadRows(buildPriceExportRows(priceState.result), "marketplace-prices");
  }

  function downloadDeliveryResults() {
    downloadRows(buildDeliveryExportRows(deliveryState.result), "marketplace-delivery");
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
          Upload a CSV with <strong>SKU</strong>, <strong>ASIN</strong>, and <strong>FSN</strong> columns. Each tab keeps
          its own file, progress, and results so price and delivery jobs can run independently.
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
              <p className="note">The app automatically processes every row where SKU details are present.</p>
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
                  Export Results CSV
                </button>
              </div>

              <p className="note">
                File: <strong>{deliveryState.fileName || "No CSV selected"}</strong>
              </p>
              <p className="note">The app automatically processes every row where SKU details are present.</p>
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

function getRowsWithSku(csvText: string) {
  const parsedRows = parseCsvToRows(csvText);
  const selectedRows = parsedRows.filter((row) => Boolean(row.sku.trim()));

  if (!selectedRows.length) {
    throw new Error("No rows with SKU details were found in the CSV.");
  }

  return selectedRows;
}

function downloadRows(rows: Array<Array<string | number>>, fileStem: string) {
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
