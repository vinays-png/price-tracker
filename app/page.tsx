"use client";

import { ChangeEvent, useState } from "react";
import type { CheckPricesResponse } from "@/types";

export default function HomePage() {
  const [csvText, setCsvText] = useState("");
  const [limit, setLimit] = useState(15);
  const [fileName, setFileName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckPricesResponse | null>(null);

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

    try {
      const response = await fetch("/api/check-prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          csvText,
          limit
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Price check failed.");
      }

      setResult(data as CheckPricesResponse);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
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

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Vercel-ready scraper</p>
        <h1>Marketplace Price Radar</h1>
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

          <div className="field">
            <label htmlFor="limit">Rows To Process</label>
            <input
              id="limit"
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value || 1))}
            />
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
          <p className="note">
            Amazon retries are bounded to avoid serverless timeouts. Increase `AMAZON_MAX_ATTEMPTS` in Vercel if you
            want more retries.
          </p>
        </aside>

        <section className="panel results">
          {error ? <p className="status">{error}</p> : null}

          {!result ? (
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
                Checked {result.totalRows} rows at {new Date(result.checkedAt).toLocaleString()}.
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
                    {result.rows.map((row) => (
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
        {props.blocked ? "Blocked" : "Checked"} | {props.attempts} attempt{props.attempts === 1 ? "" : "s"}
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
