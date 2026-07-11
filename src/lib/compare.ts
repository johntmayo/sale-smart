import * as XLSX from "xlsx";
import Papa from "papaparse";

export const SHEET_COLUMNS = [
  "Address",
  "APN",
  "Address - Sold Since Fire",
  "Sale Price",
  "Sale Date",
  "Lot SqFt",
  "Latitude",
  "Longitude",
  "New Owner",
  "Buyer Notes",
  "sort_order",
  "Sales History",
] as const;

export type SheetRow = Record<(typeof SHEET_COLUMNS)[number], string | number | boolean>;

export interface RedfinRecord {
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number | null;
  saleDate: Date | null;
  saleDateRaw: string;
  propertyType: string;
  lotSqFt: number | null;
  latitude: number | null;
  longitude: number | null;
  url: string;
}

export interface ExistingSale {
  addressCore: string;
  price: number | null;
  dateKey: string | null;
}

export interface CompareResult {
  newSales: RedfinRecord[];
  alreadyTracked: RedfinRecord[];
  needsReview: RedfinRecord[];
  sheetCount: number;
  redfinCount: number;
}

const STREET_SUFFIXES = new Set([
  "ST",
  "STREET",
  "AVE",
  "AVENUE",
  "RD",
  "ROAD",
  "DR",
  "DRIVE",
  "PL",
  "PLACE",
  "CT",
  "COURT",
  "LN",
  "LANE",
  "BLVD",
  "BOULEVARD",
  "TER",
  "TERRACE",
  "WAY",
  "CIR",
  "CIRCLE",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function cleanAddress(address: string): string {
  return normalizeWhitespace(
    address
      .replace(/\bPl\s+Pl\b/gi, "Pl")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function addressCore(address: string): string {
  let s = cleanAddress(address).toUpperCase();
  const replacements: [RegExp, string][] = [
    [/\bSTREET\b/g, "ST"],
    [/\bAVENUE\b/g, "AVE"],
    [/\bROAD\b/g, "RD"],
    [/\bDRIVE\b/g, "DR"],
    [/\bPLACE\b/g, "PL"],
    [/\bCOURT\b/g, "CT"],
    [/\bLANE\b/g, "LN"],
    [/\bTERRACE\b/g, "TER"],
    [/\bNORTH\b/g, "N"],
    [/\bSOUTH\b/g, "S"],
    [/\bEAST\b/g, "E"],
    [/\bWEST\b/g, "W"],
    [/[^A-Z0-9 ]/g, " "],
    [/\s+/g, " "],
  ];
  for (const [pattern, replacement] of replacements) {
    s = s.replace(pattern, replacement);
  }
  s = normalizeWhitespace(s);
  const parts = s.split(" ");
  if (parts.length > 1 && STREET_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(" ");
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function parseRedfinDate(value: string): Date | null {
  if (!value?.trim()) return null;
  const match = value.trim().match(/^([A-Za-z]+)-(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const [, monthName, day, year] = match;
  const parsed = new Date(`${monthName} ${day}, ${year}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseSheetDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isNaN(parsed) ? null : Math.round(parsed);
  }
  return null;
}

export async function parseSheetFile(file: File): Promise<ExistingSale[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName =
    workbook.SheetNames.find((name) => name.toLowerCase().includes("sales events")) ??
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return rows
    .map((row) => {
      const address = String(row.Address ?? row.address ?? "").trim();
      if (!address) return null;
      const saleDate = parseSheetDate(row["Sale Date"] ?? row.saleDate);
      return {
        addressCore: addressCore(address),
        price: parseNumber(row["Sale Price"] ?? row.salePrice),
        dateKey: saleDate ? dateKey(saleDate) : null,
      };
    })
    .filter((row): row is ExistingSale => row !== null);
}

export async function parseRedfinFile(file: File): Promise<RedfinRecord[]> {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  return parsed.data
    .filter((row) => row["SALE TYPE"] === "PAST SALE")
    .map((row) => {
      const saleDate = parseRedfinDate(row["SOLD DATE"] ?? "");
      return {
        address: cleanAddress(row.ADDRESS ?? ""),
        city: row.CITY ?? "",
        state: row["STATE OR PROVINCE"] ?? "",
        zip: row["ZIP OR POSTAL CODE"] ?? "",
        price: parseNumber(row.PRICE),
        saleDate,
        saleDateRaw: row["SOLD DATE"] ?? "",
        propertyType: row["PROPERTY TYPE"] ?? "",
        lotSqFt: parseNumber(row["LOT SIZE"]),
        latitude: parseNumber(row.LATITUDE),
        longitude: parseNumber(row.LONGITUDE),
        url: row["URL (SEE https://www.redfin.com/buy-a-home/comparative-market-analysis FOR INFO ON PRICING)"] ?? "",
      };
    })
    .filter((row) => row.address);
}

function isAlreadyTracked(record: RedfinRecord, existing: ExistingSale[]): boolean {
  const core = addressCore(record.address);
  return existing.some((sale) => {
    if (sale.addressCore !== core) return false;
    if (record.saleDate && sale.dateKey === dateKey(record.saleDate)) return true;
    if (record.price !== null && sale.price !== null && record.price === sale.price) return true;
    return false;
  });
}

export function compareSales(
  existing: ExistingSale[],
  redfin: RedfinRecord[],
  options?: { altadenaOnly?: boolean },
): CompareResult {
  const altadenaOnly = options?.altadenaOnly ?? true;
  const filtered = altadenaOnly
    ? redfin.filter((row) => row.city.trim().toLowerCase() === "altadena")
    : redfin;

  const seen = new Set<string>();
  const newSales: RedfinRecord[] = [];
  const alreadyTracked: RedfinRecord[] = [];
  const needsReview: RedfinRecord[] = [];

  for (const record of filtered) {
    const dedupeKey = [
      addressCore(record.address),
      record.saleDate ? dateKey(record.saleDate) : "no-date",
      record.price ?? "no-price",
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (isAlreadyTracked(record, existing)) {
      alreadyTracked.push(record);
      continue;
    }

    if (!record.saleDate) {
      needsReview.push(record);
      continue;
    }

    newSales.push(record);
  }

  newSales.sort((a, b) => {
    if (!a.saleDate || !b.saleDate) return 0;
    return b.saleDate.getTime() - a.saleDate.getTime();
  });

  return {
    newSales,
    alreadyTracked,
    needsReview,
    sheetCount: existing.length,
    redfinCount: filtered.length,
  };
}

export function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatSheetDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export function formatHistoryLine(date: Date, price: number): string {
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `[${formattedDate}] Sold to Unknown for ${formatCurrency(price)}. `;
}

export function toSheetRow(record: RedfinRecord): SheetRow {
  const saleDate = record.saleDate ? formatSheetDate(record.saleDate) : "";
  const price = record.price ?? "";
  const history =
    record.saleDate && record.price !== null
      ? formatHistoryLine(record.saleDate, record.price)
      : "";

  return {
    Address: record.address,
    APN: "",
    "Address - Sold Since Fire": true,
    "Sale Price": price,
    "Sale Date": saleDate,
    "Lot SqFt": record.lotSqFt ?? "",
    Latitude: record.latitude ?? "",
    Longitude: record.longitude ?? "",
    "New Owner": "Unknown",
    "Buyer Notes": "",
    sort_order: "",
    "Sales History": history,
  };
}

export function rowsToTsv(rows: SheetRow[]): string {
  const lines = [SHEET_COLUMNS.join("\t")];
  for (const row of rows) {
    lines.push(
      SHEET_COLUMNS.map((column) => {
        const value = row[column];
        if (value === "" || value === null || value === undefined) return "";
        return String(value);
      }).join("\t"),
    );
  }
  return lines.join("\n");
}
