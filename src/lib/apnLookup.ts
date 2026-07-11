import type { RedfinRecord } from "./compare";

const LA_COUNTY_PARCEL_QUERY =
  "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/LA_County_Parcels/FeatureServer/0/query";

const LACOUNTY_THROTTLE_MS = 260;
const DEFAULT_ZIP = "91001";

export type ApnLookupStatus =
  | "matched"
  | "ambiguous"
  | "no_match"
  | "unparsed"
  | "skipped"
  | "error";

export interface ApnLookupResult {
  apn: string;
  status: ApnLookupStatus;
  candidateApns: string;
  note: string;
}

export interface EnrichedSale extends RedfinRecord {
  apnLookup: ApnLookupResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeApn(value: string): string {
  return String(value || "").replace(/[^0-9]/g, "").trim();
}

export function formatApn(value: string): string {
  const digits = normalizeApn(value);
  if (digits.length !== 10) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
}

function normalizeAddress(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/,/g, " ")
    .replace(/\bNORTH\b/g, "N")
    .replace(/\bSOUTH\b/g, "S")
    .replace(/\bEAST\b/g, "E")
    .replace(/\bWEST\b/g, "W")
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bWY\b/g, "WAY")
    .replace(/\bCIRCLE\b/g, "CIR")
    .replace(/\bPLACE\b/g, "PL")
    .replace(/\bCOURT\b/g, "CT")
    .replace(/\bLANE\b/g, "LN")
    .replace(/\bTERRACE\b/g, "TER")
    .replace(/\bHIGHWAY\b/g, "HWY")
    .replace(/\bMOUNT\b/g, "MT")
    .replace(/#\s*/g, " UNIT ")
    .replace(/\bAPT\b/g, "UNIT")
    .replace(/\bAPARTMENT\b/g, "UNIT")
    .replace(/\bSTE\b/g, "UNIT")
    .replace(/\bSUITE\b/g, "UNIT")
    .replace(/\bUNIT\b/g, "UNIT")
    .replace(/\b1\/2\b/g, "HALF")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeSqlLiteral(value: string): string {
  return String(value ?? "").replace(/'/g, "''");
}

function normalizeZipPrefix5(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
}

function parseHouseAndStreet(normalizedAddress: string): {
  house: string;
  direction: string;
  street: string;
} {
  const match = String(normalizedAddress || "").match(/^(\d+[A-Z]?)\s+(?:([NSEW])\s+)?(.+)$/);
  if (!match) return { house: "", direction: "", street: "" };
  const street = match[3].replace(/\s+(?:UNIT|APT)\s+\S+.*$/, "").trim();
  return { house: match[1], direction: match[2] || "", street };
}

function expandStreetVariantsForLaCounty(streetCore: string): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  const push = (value: string) => {
    const trimmed = String(value || "").trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    variants.push(trimmed);
  };

  push(streetCore);
  const swaps: [RegExp, string][] = [
    [/\bMT\b/g, "MOUNT"],
    [/\bMOUNT\b/g, "MT"],
    [/\bSAINT\b/g, "ST"],
    [/\bFT\b/g, "FORT"],
    [/\bFORT\b/g, "FT"],
  ];
  const snapshot = variants.slice();
  for (const base of snapshot) {
    for (const [pattern, replacement] of swaps) {
      if (pattern.test(base)) push(base.replace(pattern, replacement));
    }
  }
  return variants;
}

function buildLaCountyWhereClause(normalizedAddress: string, zipPrefix5: string): string {
  const { house, direction, street } = parseHouseAndStreet(normalizedAddress);
  let core: string;
  if (house && street) {
    const streetClauses = expandStreetVariantsForLaCounty(street)
      .map((variant) => `UPPER(SitusStreet) LIKE UPPER('${escapeSqlLiteral(variant)}%')`)
      .join(" OR ");
    core = `SitusHouseNo = '${escapeSqlLiteral(house)}' AND (${streetClauses})`;
    if (direction) {
      core += ` AND SitusDirection = '${escapeSqlLiteral(direction)}'`;
    }
  } else {
    core = `UPPER(SitusAddress) LIKE UPPER('%${escapeSqlLiteral(normalizedAddress)}%')`;
  }
  if (zipPrefix5) {
    return `(${core}) AND SitusZIP LIKE '${escapeSqlLiteral(zipPrefix5)}%'`;
  }
  return core;
}

function pickApnDigitsFromAttributes(attrs: Record<string, unknown> | undefined): string {
  if (!attrs) return "";
  const ain = normalizeApn(String(attrs.AIN ?? ""));
  if (ain) return ain;
  return normalizeApn(String(attrs.APN ?? ""));
}

interface ParcelQueryResult {
  features: Array<{ attributes: Record<string, unknown> }>;
  exceededTransferLimit: boolean;
}

async function queryLaCountyParcelFeatures(
  normalizedAddress: string,
  zipPrefix5: string,
): Promise<ParcelQueryResult> {
  const params = new URLSearchParams({
    f: "json",
    where: buildLaCountyWhereClause(normalizedAddress, zipPrefix5 || ""),
    outFields: "APN,AIN,SitusAddress,SitusStreet,SitusHouseNo,SitusCity,SitusZIP",
    returnGeometry: "false",
    resultRecordCount: "15",
  });
  const response = await fetch(`${LA_COUNTY_PARCEL_QUERY}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`LA County parcel request failed (${response.status})`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || "LA County parcel query error");
  }
  return {
    features: data.features || [],
    exceededTransferLimit: Boolean(data.exceededTransferLimit),
  };
}

function uniqueApnDigitsFromParcelResult(result: ParcelQueryResult): {
  apns: string[];
  exceededTransferLimit: boolean;
  featureCount: number;
} {
  const set = new Set<string>();
  for (const feature of result.features) {
    const digits = pickApnDigitsFromAttributes(feature.attributes);
    if (digits) set.add(digits);
  }
  return {
    apns: Array.from(set),
    exceededTransferLimit: result.exceededTransferLimit,
    featureCount: result.features.length,
  };
}

function zipForRecord(record: RedfinRecord): string {
  return normalizeZipPrefix5(record.zip) || DEFAULT_ZIP;
}

async function lookupApnForRecord(record: RedfinRecord): Promise<ApnLookupResult> {
  const normalizedAddress = normalizeAddress(record.address);
  if (!normalizedAddress) {
    return {
      apn: "",
      status: "skipped",
      candidateApns: "",
      note: "No usable street address found",
    };
  }

  try {
    const raw = await queryLaCountyParcelFeatures(normalizedAddress, zipForRecord(record));
    const { apns, exceededTransferLimit, featureCount } = uniqueApnDigitsFromParcelResult(raw);
    const limitNote = exceededTransferLimit
      ? " Query hit record limit; review candidates carefully."
      : "";

    if (apns.length === 1) {
      return {
        apn: formatApn(apns[0]),
        status: "matched",
        candidateApns: formatApn(apns[0]),
        note: `Exactly one distinct APN found.${limitNote}`.trim(),
      };
    }
    if (apns.length > 1) {
      return {
        apn: "",
        status: "ambiguous",
        candidateApns: apns.map(formatApn).join(" | "),
        note: `Multiple distinct APNs matched this address.${limitNote}`.trim(),
      };
    }
    if (featureCount > 0) {
      return {
        apn: "",
        status: "unparsed",
        candidateApns: "",
        note: `Parcel rows returned, but no usable AIN/APN field was found.${limitNote}`.trim(),
      };
    }
    return {
      apn: "",
      status: "no_match",
      candidateApns: "",
      note: "No parcel features returned for this address",
    };
  } catch (error) {
    return {
      apn: "",
      status: "error",
      candidateApns: "",
      note: error instanceof Error ? error.message : "APN lookup failed",
    };
  }
}

export async function lookupApnsForSales(
  sales: RedfinRecord[],
  onProgress?: (current: number, total: number) => void,
): Promise<EnrichedSale[]> {
  const enriched: EnrichedSale[] = [];

  for (let index = 0; index < sales.length; index += 1) {
    onProgress?.(index + 1, sales.length);
    const apnLookup = await lookupApnForRecord(sales[index]);
    enriched.push({ ...sales[index], apnLookup });
    if (index < sales.length - 1) {
      await sleep(LACOUNTY_THROTTLE_MS);
    }
  }

  return enriched;
}

export function apnStatusLabel(status: ApnLookupStatus): string {
  switch (status) {
    case "matched":
      return "Matched";
    case "ambiguous":
      return "Ambiguous";
    case "no_match":
      return "No match";
    case "unparsed":
      return "Unparsed";
    case "skipped":
      return "Skipped";
    case "error":
      return "Error";
    default:
      return status;
  }
}
