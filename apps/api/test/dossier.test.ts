import { PDFDocument } from "pdf-lib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/session.js";
import { storeFile } from "../src/services/files.js";
import { generateDossier } from "../src/services/dossier.js";
import { submitRecord } from "../src/services/records.js";
import { createAsset } from "../src/services/assets.js";
import { createStorage } from "../src/storage/index.js";
import { prisma, resetDb, seedFixture } from "./helpers.js";

async function pdfBytes(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

describe("compliance dossier", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("generates an Arabic PDF and appends the certificate pages", async () => {
    const fx = await seedFixture();
    const storage = await createStorage();
    const auth: AuthContext = { userId: fx.ownerId, organizationId: fx.orgId, role: "OWNER", siteIds: [fx.siteAId, fx.siteBId] };

    const asset = await createAsset(prisma, auth, {
      siteId: fx.siteAId,
      tag: "FP-1",
      name: "Fire pump",
      assetType: "fire_pump",
      criticality: "LIFE_SAFETY",
      commissionedOn: "2019-01-01",
    });
    const duty = await prisma.assetDuty.findFirstOrThrow({ where: { assetId: asset.id } });

    const cert = await storeFile(prisma, storage, auth, {
      filename: "certificate.pdf",
      contentType: "application/pdf",
      buffer: await pdfBytes(2),
    });
    await submitRecord(prisma, auth, duty.id, {
      performedOn: "2026-06-01",
      performedBy: "Third Party Co",
      result: "PASS",
      certificateId: cert.id,
    });

    const { filename, pdf } = await generateDossier(prisma, storage, auth, {
      siteId: fx.siteAId,
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(filename).toMatch(/\.pdf$/);
    const doc = await PDFDocument.load(pdf);
    // Body (>=1 page) plus the 2-page certificate appended.
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
