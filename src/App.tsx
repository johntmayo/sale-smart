import { useMemo, useState } from "react";
import "./App.css";
import { apnStatusLabel, lookupApnsForSales, type EnrichedSale } from "./lib/apnLookup";
import {
  compareSales,
  formatCurrency,
  formatSheetDate,
  parseRedfinFile,
  parseSheetFile,
  rowsToTsv,
  toSheetRow,
  type CompareResult,
} from "./lib/compare";

function App() {
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [redfinFile, setRedfinFile] = useState<File | null>(null);
  const [altadenaOnly, setAltadenaOnly] = useState(true);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [enrichedSales, setEnrichedSales] = useState<EnrichedSale[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [copied, setCopied] = useState(false);

  const pasteRows = useMemo(
    () => enrichedSales.map((sale) => toSheetRow(sale, sale.apnLookup.apn)),
    [enrichedSales],
  );

  const apnMatchedCount = enrichedSales.filter((sale) => sale.apnLookup.status === "matched").length;

  async function runComparison() {
    if (!sheetFile || !redfinFile) return;

    setIsWorking(true);
    setError(null);
    setCopied(false);
    setResult(null);
    setEnrichedSales([]);
    setProgressLabel("Comparing files...");

    try {
      const [existing, redfin] = await Promise.all([
        parseSheetFile(sheetFile),
        parseRedfinFile(redfinFile),
      ]);
      const compareResult = compareSales(existing, redfin, { altadenaOnly });
      setResult(compareResult);

      if (compareResult.newSales.length) {
        const enriched = await lookupApnsForSales(compareResult.newSales, (current, total) => {
          setProgressLabel(`Looking up APNs... ${current} / ${total}`);
        });
        setEnrichedSales(enriched);
      }
    } catch (err) {
      setResult(null);
      setEnrichedSales([]);
      setError(err instanceof Error ? err.message : "Something went wrong while comparing files.");
    } finally {
      setIsWorking(false);
      setProgressLabel("");
    }
  }

  async function copyRows() {
    if (!pasteRows.length) return;
    await navigator.clipboard.writeText(rowsToTsv(pasteRows));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  }

  return (
    <main className="app">
      <header className="hero">
        <span className="eyebrow">Altadena Property Sales</span>
        <h1>Sale Smart</h1>
        <p>
          Upload your current Google Sheet export and a fresh Redfin CSV. The app finds sales that
          are not already on your <strong>Sales Events</strong> tab, looks up APNs from LA County
          parcel data, and formats them for a clean paste back into the sheet.
        </p>
      </header>

      <section className="panel">
        <div className="upload-grid">
          <label className={`upload-card ${sheetFile ? "ready" : ""}`}>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                setSheetFile(event.target.files?.[0] ?? null);
                setResult(null);
                setEnrichedSales([]);
                setCopied(false);
              }}
            />
            <h2>1. Your spreadsheet export</h2>
            <p>Excel export of the live sheet. The app reads the first tab named Sales Events.</p>
            {sheetFile ? <span className="file-pill">{sheetFile.name}</span> : null}
          </label>

          <label className={`upload-card ${redfinFile ? "ready" : ""}`}>
            <input
              type="file"
              accept=".csv"
              onChange={(event) => {
                setRedfinFile(event.target.files?.[0] ?? null);
                setResult(null);
                setEnrichedSales([]);
                setCopied(false);
              }}
            />
            <h2>2. Redfin CSV download</h2>
            <p>The downloaded Redfin export with recent Altadena past sales.</p>
            {redfinFile ? <span className="file-pill">{redfinFile.name}</span> : null}
          </label>
        </div>

        <div className="controls">
          <label className="toggle">
            <input
              type="checkbox"
              checked={altadenaOnly}
              onChange={(event) => setAltadenaOnly(event.target.checked)}
            />
            Only include Altadena sales
          </label>

          <button
            type="button"
            disabled={!sheetFile || !redfinFile || isWorking}
            onClick={runComparison}
          >
            {isWorking ? progressLabel || "Working..." : "Find new sales"}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {result ? (
        <>
          <div className="summary-grid">
            <div className="stat-card">
              <strong>{result.sheetCount}</strong>
              <span>sales already in your sheet</span>
            </div>
            <div className="stat-card">
              <strong>{result.redfinCount}</strong>
              <span>Redfin past sales scanned</span>
            </div>
            <div className="stat-card highlight">
              <strong>{result.newSales.length}</strong>
              <span>new sales to add</span>
            </div>
            <div className="stat-card">
              <strong>{apnMatchedCount}</strong>
              <span>APNs auto-filled</span>
            </div>
          </div>

          <section className="results">
            <div className="section-header">
              <div>
                <h3>New sales ready to paste</h3>
                <p>
                  Copy the rows below, then paste directly into the next empty row on your Sales
                  Events tab. APNs are filled automatically when LA County returns exactly one
                  parcel match.
                </p>
              </div>
              <div>
                <button type="button" disabled={!pasteRows.length} onClick={copyRows}>
                  Copy rows for Google Sheets
                </button>
                {copied ? <div className="copy-success">Copied to clipboard</div> : null}
              </div>
            </div>

            {enrichedSales.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>APN</th>
                      <th>APN Status</th>
                      <th>Sale Price</th>
                      <th>Sale Date</th>
                      <th>Lot SqFt</th>
                      <th>Property Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedSales.map((sale) => (
                      <tr key={`${sale.address}-${sale.saleDateRaw}-${sale.price}`}>
                        <td>{sale.address}</td>
                        <td>{sale.apnLookup.apn || "—"}</td>
                        <td>
                          <span className={`apn-status apn-status-${sale.apnLookup.status}`}>
                            {apnStatusLabel(sale.apnLookup.status)}
                          </span>
                          {sale.apnLookup.candidateApns &&
                          sale.apnLookup.status === "ambiguous" ? (
                            <div className="apn-note">{sale.apnLookup.candidateApns}</div>
                          ) : null}
                          {sale.apnLookup.note && sale.apnLookup.status !== "matched" ? (
                            <div className="apn-note">{sale.apnLookup.note}</div>
                          ) : null}
                        </td>
                        <td>{sale.price !== null ? formatCurrency(sale.price) : "—"}</td>
                        <td>{sale.saleDate ? formatSheetDate(sale.saleDate) : "—"}</td>
                        <td>{sale.lotSqFt?.toLocaleString() ?? "—"}</td>
                        <td>{sale.propertyType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                No new dated sales were found. Your sheet already appears to include everything in
                this Redfin export.
              </div>
            )}

            {result.needsReview.length ? (
              <>
                <div className="review-banner">
                  {result.needsReview.length} Redfin record
                  {result.needsReview.length === 1 ? "" : "s"} had no sold date and could not be
                  auto-matched. Review these manually before adding them.
                </div>
                <div className="table-wrap" style={{ marginTop: "0.85rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Address</th>
                        <th>City</th>
                        <th>Sale Price</th>
                        <th>Property Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.needsReview.map((sale) => (
                        <tr key={`${sale.address}-${sale.price}`}>
                          <td>{sale.address}</td>
                          <td>{sale.city}</td>
                          <td>{sale.price !== null ? formatCurrency(sale.price) : "—"}</td>
                          <td>{sale.propertyType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </section>
        </>
      ) : (
        <div className="empty-state" style={{ marginTop: "1.25rem" }}>
          Upload both files, then run the comparison to see which Redfin sales are missing from
          your tracker.
        </div>
      )}
    </main>
  );
}

export default App;
