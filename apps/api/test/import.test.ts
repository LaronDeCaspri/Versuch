import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/session.js";
import { importAssets } from "../src/services/import.js";
import { prisma, resetDb, seedFixture } from "./helpers.js";

async function workbook(rows: (string | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Assets");
  ws.addRow(["Tag", "Name", "Type", "Criticality", "Commissioned"]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("forgiving Excel import", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("imports clean rows, fuzzy-matches types, and reports unmappable rows without dropping them", async () => {
    const fx = await seedFixture();
    const auth: AuthContext = {
      userId: fx.ownerId,
      organizationId: fx.orgId,
      role: "OWNER",
      siteIds: [fx.siteAId, fx.siteBId],
    };
    const buf = await workbook([
      ["FP-1", "Main fire pump", "Fire Pump", "Life Safety", "2019-01-01"],
      ["GEN-1", "Generator", "generatr", "operational", "2020-05-01"], // typo → fuzzy
      ["X-1", "Mystery box", "banana", "", ""], // unmappable type → error, not dropped
      ["", "", "", "", ""], // blank → skipped silently
    ]);

    const report = await importAssets(prisma, auth, fx.siteAId, buf);
    expect(report.created).toBe(2);
    expect(report.errors).toBe(1);
    expect(report.totalRows).toBe(3); // blank row excluded from results

    const gen = report.results.find((r) => r.tag === "GEN-1");
    expect(gen?.outcome).toBe("created");
    expect(gen?.fuzzy).toBe(true);
    expect(gen?.assetType).toBe("diesel_generator");

    const mystery = report.results.find((r) => r.tag === "X-1");
    expect(mystery?.outcome).toBe("error");
    expect(mystery?.message).toMatch(/could not map/i);

    const created = await prisma.asset.findMany({ where: { organizationId: fx.orgId } });
    expect(created.map((a) => a.tag).sort()).toEqual(["FP-1", "GEN-1"]);
    // Fire pump instantiated its statutory duty on import.
    const fp = created.find((a) => a.tag === "FP-1");
    expect(await prisma.assetDuty.count({ where: { assetId: fp?.id } })).toBe(1);
  });

  it("reports a row error for a duplicate tag instead of aborting the whole import", async () => {
    const fx = await seedFixture();
    const auth: AuthContext = {
      userId: fx.ownerId,
      organizationId: fx.orgId,
      role: "OWNER",
      siteIds: [fx.siteAId, fx.siteBId],
    };
    await importAssets(prisma, auth, fx.siteAId, await workbook([["FP-1", "Pump", "fire pump", "", ""]]));
    const report = await importAssets(
      prisma,
      auth,
      fx.siteAId,
      await workbook([
        ["FP-1", "Pump dup", "fire pump", "", ""],
        ["FP-2", "Pump two", "fire pump", "", ""],
      ]),
    );
    expect(report.created).toBe(1);
    expect(report.errors).toBe(1);
    expect(report.results.find((r) => r.tag === "FP-1")?.message).toMatch(/already exists/i);
  });
});
