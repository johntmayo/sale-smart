import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  addressCore,
  compareSales,
  dateKey,
  parseRedfinDate,
  type ExistingSale,
  type RedfinRecord,
} from "./src/lib/compare.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseSheet(path: string): ExistingSale[] {
  const workbook = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
  const sheetName =
    workbook.SheetNames.find((name) => name.toLowerCase().includes("sales events")) ??
    workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
  });

  return rows
    .map((row) => {
      const address = String(row.Address ?? "").trim();
      if (!address) return null;
      const saleDate = row["Sale Date"];
      const date =
        saleDate instanceof Date
          ? dateKey(saleDate)
          : typeof saleDate === "string" && saleDate
            ? dateKey(new Date(saleDate))
            : null;
      const priceRaw = row["Sale Price"];
      const price =
        typeof priceRaw === "number"
          ? Math.round(priceRaw)
          : typeof priceRaw === "string" && priceRaw
            ? Math.round(Number(priceRaw.replace(/[$,]/g, "")))
            : null;
      return { addressCore: addressCore(address), price, dateKey: date };
    })
    .filter((row): row is ExistingSale => row !== null);
}

function parseRedfin(path: string): RedfinRecord[] {
  const parsed = Papa.parse<Record<string, string>>(readFileSync(path, "utf8"), {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data
    .filter((row) => row["SALE TYPE"] === "PAST SALE")
    .map((row) => ({
      address: row.ADDRESS ?? "",
      city: row.CITY ?? "",
      state: row["STATE OR PROVINCE"] ?? "",
      zip: row["ZIP OR POSTAL CODE"] ?? "",
      price: row.PRICE ? Math.round(Number(row.PRICE)) : null,
      saleDate: parseRedfinDate(row["SOLD DATE"] ?? ""),
      saleDateRaw: row["SOLD DATE"] ?? "",
      propertyType: row["PROPERTY TYPE"] ?? "",
      lotSqFt: row["LOT SIZE"] ? Math.round(Number(row["LOT SIZE"])) : null,
      latitude: row.LATITUDE ? Number(row.LATITUDE) : null,
      longitude: row.LONGITUDE ? Number(row.LONGITUDE) : null,
      url: "",
    }));
}

const existing = parseSheet(resolve(root, "REFERENCE - Property Sales Records.xlsx"));
const redfin = parseRedfin(resolve(root, "REFERENCE - redfin_2026-07-10-17-29-05.csv"));
const result = compareSales(existing, redfin, { altadenaOnly: true });

console.log({
  sheetCount: result.sheetCount,
  redfinCount: result.redfinCount,
  newSales: result.newSales.length,
  alreadyTracked: result.alreadyTracked.length,
  needsReview: result.needsReview.length,
});
console.log(
  "Sample new sales:",
  result.newSales.slice(0, 5).map((sale) => `${sale.address} | ${sale.saleDateRaw} | ${sale.price}`),
);
