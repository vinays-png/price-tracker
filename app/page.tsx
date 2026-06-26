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

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("prices");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [pincodeText, setPincodeText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [priceResult, setPriceResult] = useState<CheckPricesResponse | null>(null);
  const [deliveryResult, setDeliveryResult] = useState<CheckDeliveryResponse | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    setError("");
    setPriceResult(null);
    setDeliveryResult(null);
  }

  async function runPriceCheck() {
    if (!csvText.trim()) {
      setError("Upload a CSV file first.");
      return;
    }

    setIsLoading(true);
    setError("");
    setPriceResult(null);
    setDeliveryResult(null);
    setProgress(null);

    try {
      const selectedRows = getRowsWithSku(csvText);
      const completedRows: RowResult[] = [];

      for (let index = 0; index < selectedRows.length; index += 1) {
        const row = selectedRows[index];
        let amazonAttemptOffset = 0;
        let rowResult: RowResult | null = null;
        let flipkartResult: RowResult["flipkart"] | null = null;

        setProgress({
          completed: index,
          currentLabel: buildRowLabel(row),
          remaining: selectedRows.length - index,
          total: selectedRows.length
        });

        while (true) {
          setProgress({
            completed: index,
            currentLabel: `${buildRowLabel(row)} | Amazon attempt ${amazonAttemptOffset + 1}`,
            remaining: selectedRows.length - index,
            total: selectedRows.length
          });

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

          rowResult = {
            ...nextRow,
            flipkart: flipkartResult ?? nextRow.flipkart
          };

          setPriceResult({
            checkedAt: new Date().toISOString(),
            totalRows: selectedRows.length,
            rows: [...completedRows, rowResult]
          });

          if (rowResult.amazon.price !== null || rowResult.amazon.completed !== false) {
            break;
          }

          amazonAttemptOffset = rowResult.amazon.attempts;
        }

        if (!rowResult) {
          throw new Error("The server did not produce a row result.");
        }

        completedRows.push(rowResult);
        setPriceResult({
          checkedAt: new Date().toISOString(),
          totalRows: selectedRows.length,
          rows: [...completedRows]
        });
        setProgress({
          completed: index + 1,
          currentLabel: buildRowLabel(row),
          remaining: selectedRows.length - (index + 1),
          total: selectedRows.length
        });
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
    } finally {
      finishLoading();
    }
  }

  async function runDeliveryCheck() {
    if (!csvText.trim()) {
      setError("Upload a CSV file first.");
      return;
    }

    const pincodes = parsePincodes(pincodeText);
    if (!pincodes.length) {
      setError("Enter at least one 6-digit pincode.");
      return;
    }

    setIsLoading(true);
    setError("");
    setPriceResult(null);
    setDeliveryResult(null);
    setProgress(null);

    try {
      const selectedRows = getRowsWithSku(csvText);
      const completedRows: DeliveryRowResult[] = [];
      const totalChecks = selectedRows.length * pincodes.length;
      let completedChecks = 0;

      for (const row of selectedRows) {
        for (const pincode of pincodes) {
          setProgress({
            completed: completedChecks,
            currentLabel: `${buildRowLabel(row)} | ${pincode}`,
            remaining: totalChecks - completedChecks,
            total: totalChecks
          });

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

          setDeliveryResult({
            checkedAt: new Date().toISOString(),
            totalRows: totalChecks,
            rows: [...completedRows]
          });
          setProgress({
            completed: completedChecks,
            currentLabel: `${buildRowLabel(row)} | ${pincode}`,
            remaining: totalChecks - completedChecks,
            total: totalChecks
          });
        }
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
    } finally {
      finishLoading();
    }
  }

  function finishLoading() {
    setIsLoading(false);
    setProgress((currentProgress) =>
      currentProgress
        ? {
            ...currentProgress,
            currentLabel: "",
            remaining: 0
          }
        : null
    );
  }

  function downloadResults() {
    const rows = mode === "prices" ? buildPriceExportRows(priceResult) : buildDeliveryExportRows(deliveryResult);
    const fileStem = mode === "prices" ? "marketplace-prices" : "marketplace-delivery";

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

  const activeResult = mode === "prices" ? priceResult : deliveryResult;
  const hasResults = Boolean(activeResult && activeResult.rows.length);
  const progressMessage = progress
    ? `Completed ${progress.completed} of ${progress.total} | Remaining ${progress.remaining}${
        progress.currentLabel ? ` | Current ${progress.currentLabel}` : ""
      }`
    : "";

  const totalAmazonBlocked = priceResult?.rows.filter((row) => row.amazon.blocked).length ?? 0;
  const totalAmazonSuccess = priceResult?.rows.filter((row) => row.amazon.ok && row.amazon.price !== null).length ?? 0;
  const totalFlipkartSuccess = priceResult?.rows.filter((row) => row.flipkart.ok && row.flipkart.price !== null).length ?? 0;
  const totalDeliveryChecks = deliveryResult?.rows.length ?? 0;
  const totalAmazonDelivery = deliveryResult?.rows.filter((row) => row.amazon.ok && row.amazon.deliveryDate).length ?? 0;
  const totalFlipkartDelivery = deliveryResult?.rows.filter((row) => row.flipkart.ok && row.flipkart.deliveryDate).length ?? 0;

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
          Upload a CSV with <strong>SKU</strong>, <strong>ASIN</strong>, and <strong>FSN</strong> columns. Switch between
          price checks and delivery-date checks without changing the source file.
        </p>
      </section>

      <section className="layout-grid">
        <aside className="panel controls">
          <div className="field">
            <label htmlFor="csvFile">CSV File</label>
            <input id="csvFile" type="file" accept=".csv,text/csv" onChange={onFileChange} />
          </div>

          {mode === "delivery" ? (
            <div className="field">
              <label htmlFor="pincodes">Pincodes</label>
              <textarea
                id="pincodes"
                className="text-area"
                placeholder="560103, 110001&#10;Enter one or many pincodes"
                value={pincodeText}
                onChange={(event) => setPincodeText(event.target.value)}
              />
            </div>
          ) : null}

          <div className="button-row">
            <button
              className="button button-primary"
              onClick={mode === "prices" ? runPriceCheck : runDeliveryCheck}
              disabled={isLoading}
            >
              {isLoading ? (mode === "prices" ? "Checking prices..." : "Checking delivery...") : mode === "prices" ? "Fetch Prices" : "Fetch Delivery Dates"}
            </button>
            <button className="button button-secondary" onClick={downloadResults} disabled={!activeResult}>
              Export Results CSV
            </button>
          </div>

          <p className="note">
            File: <strong>{fileName || "No CSV selected"}</strong>
          </p>
          <p className="note">The app automatically processes every row where SKU details are present.</p>
          {mode === "prices" ? (
            <p className="note">
              Amazon retries continue in small request batches until a price is found, so the app can keep working
              without hitting Vercel function limits.
            </p>
          ) : (
            <p className="note">
              Flipkart delivery dates are checked by pincode directly. Amazon delivery is best-effort and may still
              reflect Amazon&apos;s current visible location when anonymous pincode updates are restricted.
            </p>
          )}
        </aside>

        <section className="panel results">
          {error ? <p className="status">{error}</p> : null}
          {progressMessage ? <p className="status">{progressMessage}</p> : null}

          {!hasResults && isLoading ? (
            <div>
              <p className="eyebrow">Fetching</p>
              <p>
                {mode === "prices"
                  ? "The app is processing your CSV now. Partial price results will appear as each SKU finishes."
                  : "The app is checking delivery dates across your SKU rows and pincodes now."}
              </p>
            </div>
          ) : !hasResults ? (
            <div>
              <p className="eyebrow">Ready</p>
              <p>
                {mode === "prices"
                  ? "Upload the source CSV and run a fetch. Results will appear here with prices, source URLs, retry counts, and scrape notes."
                  : "Upload the source CSV, add one or more pincodes, and run a fetch. Results will appear here with delivery dates, source URLs, and scrape notes."}
              </p>
            </div>
          ) : mode === "prices" && priceResult ? (
            <div>
              <p className="status">
                Checked {priceResult.totalRows} rows at {new Date(priceResult.checkedAt).toLocaleString()}.
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
                    {priceResult.rows.map((row) => (
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
          ) : deliveryResult ? (
            <div>
              <p className="status">
                Checked {deliveryResult.totalRows} delivery combinations at {new Date(deliveryResult.checkedAt).toLocaleString()}.
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
                    {deliveryResult.rows.map((row) => (
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
          ) : null}
        </section>
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
