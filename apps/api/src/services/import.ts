import ExcelJS from "exceljs";
import { CRITICALITY, matchAssetType, type Criticality } from "@cmp/core";
import type { PrismaClient } from "@cmp/db";
import type { AuthContext } from "../auth/session.js";
import { badRequest, notFound } from "../errors.js";
import { createAsset } from "./assets.js";

type Field = "tag" | "name" | "assetType" | "criticality" | "manufacturer" | "model" | "serialNumber" | "commissionedOn" | "locationDetail";

const HEADER_ALIASES: Record<Field, string[]> = {
  tag: ["tag", "asset tag", "code", "رقم", "الوسم", "الرمز"],
  name: ["name", "description", "asset name", "الاسم", "الوصف"],
  assetType: ["type", "asset type", "category", "النوع", "الفئة"],
  criticality: ["criticality", "priority", "الأهمية", "الحرجية"],
  manufacturer: ["manufacturer", "make", "brand", "الصانع", "الماركة"],
  model: ["model", "الموديل", "الطراز"],
  serialNumber: ["serial", "serial number", "sn", "الرقم التسلسلي"],
  commissionedOn: ["commissioned", "commissioned on", "install date", "تاريخ التشغيل", "تاريخ التركيب"],
  locationDetail: ["location", "location detail", "room", "الموقع", "المكان"],
};

const CRITICALITY_ALIASES: Record<string, Criticality> = {
  "life safety": "LIFE_SAFETY",
  "life_safety": "LIFE_SAFETY",
  "critical": "LIFE_SAFETY",
  "حرج": "LIFE_SAFETY",
  "سلامة الأرواح": "LIFE_SAFETY",
  "operational": "OPERATIONAL",
  "تشغيلي": "OPERATIONAL",
  "non critical": "NON_CRITICAL",
  "non_critical": "NON_CRITICAL",
  "غير حرج": "NON_CRITICAL",
};

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function parseCriticality(raw: string): Criticality | null {
  const n = norm(raw);
  if (n === "") return null;
  if (CRITICALITY_ALIASES[n]) return CRITICALITY_ALIASES[n];
  const upper = n.toUpperCase().replace(/\s+/g, "_");
  return (CRITICALITY as readonly string[]).includes(upper) ? (upper as Criticality) : null;
}

export type RowOutcome = "created" | "error";

export interface ImportRowResult {
  row: number;
  outcome: RowOutcome;
  tag: string | null;
  assetType: string | null;
  fuzzy: boolean;
  message: string | null;
}

export interface ImportReport {
  totalRows: number;
  created: number;
  errors: number;
  results: ImportRowResult[];
}

function buildColumnMap(headerRow: ExcelJS.Row): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  headerRow.eachCell((cell, col) => {
    const h = norm(cell.value);
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      if (map[field] === undefined && HEADER_ALIASES[field].some((a) => norm(a) === h)) {
        map[field] = col;
      }
    }
  });
  return map;
}

export async function importAssets(
  prisma: PrismaClient,
  auth: AuthContext,
  siteId: string,
  buffer: Buffer,
): Promise<ImportReport> {
  const site = await prisma.site.findFirst({ where: { id: siteId, organizationId: auth.organizationId } });
  if (site === null) throw notFound("Site not found");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (ws === undefined) throw badRequest("The uploaded file has no worksheet");

  const headerRow = ws.getRow(1);
  const cols = buildColumnMap(headerRow);
  for (const req of ["tag", "name", "assetType"] as Field[]) {
    if (cols[req] === undefined) {
      throw badRequest(`Missing required column: ${req} (expected one of: ${HEADER_ALIASES[req].join(", ")})`);
    }
  }

  const cell = (row: ExcelJS.Row, field: Field): string => {
    const col = cols[field];
    return col === undefined ? "" : String(row.getCell(col).value ?? "").trim();
  };

  const results: ImportRowResult[] = [];
  let created = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const tag = cell(row, "tag");
    const name = cell(row, "name");
    const rawType = cell(row, "assetType");
    if (tag === "" && name === "" && rawType === "") continue; // blank row

    const record = (outcome: RowOutcome, assetType: string | null, fuzzy: boolean, message: string | null) => {
      results.push({ row: r, outcome, tag: tag || null, assetType, fuzzy, message });
      if (outcome === "created") created++;
    };

    if (tag === "" || name === "") {
      record("error", null, false, "Row is missing a tag or name");
      continue;
    }
    const match = matchAssetType(rawType);
    if (match === null) {
      record("error", null, false, `Could not map asset type "${rawType}"`);
      continue;
    }
    const criticality = parseCriticality(cell(row, "criticality")) ?? "OPERATIONAL";

    try {
      await createAsset(prisma, auth, {
        siteId,
        tag,
        name,
        assetType: match.key,
        criticality,
        manufacturer: cell(row, "manufacturer") || null,
        model: cell(row, "model") || null,
        serialNumber: cell(row, "serialNumber") || null,
        commissionedOn: parseDate(cell(row, "commissionedOn")),
        locationDetail: cell(row, "locationDetail") || null,
      });
      record("created", match.key, !match.exact, match.exact ? null : `Fuzzy-matched "${rawType}" → ${match.key}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      record("error", match.key, !match.exact, message);
    }
  }

  return { totalRows: results.length, created, errors: results.filter((x) => x.outcome === "error").length, results };
}

function parseDate(raw: string): string | null {
  if (raw === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
