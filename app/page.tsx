"use client";

import { ChangeEvent, useState } from "react";
import { parseCsvToRows } from "@/lib/csv";
import type { CheckPricesResponse, RowResult, SourceRow } from "@/types";

type ProgressState = {
  completed: number;
  currentLabel: string;
  remaining: number;
  total: number;
};

export default function HomePage() {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckPricesResponse | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    setError("");
    setResult(null);
  }

  async function runCheck() {
    if (!csvText.trim()) {
      setError("Upload a CSV file first.");
      return;
    }

    setIsLoading(true);
    setError("");
    setResult(null);
    setProgress(null);

    try {
      const parsedRows = parseCsvToRows(csvText);
      const selectedRows = parsedRows.filter((row) => Boolean(row.sku.trim()));

      if (!selectedRows.length) {
        throw new Error("No rows with SKU details were found in the CSV.");
      }

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

          setResult({
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

        setResult({
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
  }

  function downloadResults() {
    if (!result) return;

    const rows = [
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
    anchor.download = `marketplace-prices-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const totalAmazonBlocked = result?.rows.filter((row) => row.amazon.blocked).length ?? 0;
  const totalAmazonSuccess = result?.rows.filter((row) => row.amazon.ok && row.amazon.price !== null).length ?? 0;
  const totalFlipkartSuccess = result?.rows.filter((row) => row.flipkart.ok && row.flipkart.price !== null).length ?? 0;
  const hasResults = Boolean(result && result.rows.length);
  const progressMessage = progress
    ? `Completed ${progress.completed} of ${progress.total} | Remaining ${progress.remaining}${
        progress.currentLabel ? ` | Current ${progress.currentLabel}` : ""
      }`
    : "";

  return (
    <main className="page-shell">
      <section className="hero">
        <h1>Marketplace Price Scraper</h1>
        <p>
          Upload a CSV with <strong>SKU</strong>, <strong>ASIN</strong>, and <strong>FSN</strong> columns.
          The app will fetch Amazon and Flipkart prices, retry Amazon automatically when a block page is detected,
          and let you export the results.
        </p>
      </section>

      <section className="layout-grid">
        <aside className="panel controls">
          <div className="field">
            <label htmlFor="csvFile">CSV File</label>
            <input id="csvFile" type="file" accept=".csv,text/csv" onChange={onFileChange} />
          </div>

          <div className="button-row">
            <button className="button button-primary" onClick={runCheck} disabled={isLoading}>
              {isLoading ? "Checking prices..." : "Fetch Prices"}
            </button>
            <button className="button button-secondary" onClick={downloadResults} disabled={!result}>
              Export Results CSV
            </button>
          </div>

          <p className="note">
            File: <strong>{fileName || "No CSV selected"}</strong>
          </p>
          <p className="note">The app will automatically fetch prices for every row that has a SKU value.</p>
          <p className="note">
            Amazon retries continue in small request batches until a price is found, so the app can keep working
            without hitting Vercel function limits.
          </p>
        </aside>

        <section className="panel results">
          {error ? <p className="status">{error}</p> : null}
          {progressMessage ? <p className="status">{progressMessage}</p> : null}

          {!hasResults && isLoading ? (
            <div>
              <p className="eyebrow">Fetching</p>
              <p>The app is processing your CSV now. Partial results will appear as each SKU finishes.</p>
            </div>
          ) : !hasResults ? (
            <div>
              <p className="eyebrow">Ready</p>
              <p>
                Upload the source CSV and run a fetch. Results will appear here with prices, source URLs, retry counts,
                and scrape notes.
              </p>
            </div>
          ) : (
            <div>
              <p className="status">
                Checked {result!.totalRows} rows at {new Date(result!.checkedAt).toLocaleString()}.
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
                    {result!.rows.map((row) => (
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
    throw new Error(data.error || "Price check failed.");
  }

  return data as T;
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

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value);
}
