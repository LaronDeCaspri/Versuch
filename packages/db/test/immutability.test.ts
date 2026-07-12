import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb, seedOrgUser } from "./helpers.js";

async function makeAsset(orgId: string, siteId: string, criticality = "LIFE_SAFETY" as const) {
  return prisma.asset.create({
    data: {
      organizationId: orgId,
      siteId,
      tag: `TAG-${Math.random().toString(36).slice(2, 8)}`,
      name: "Asset",
      assetType: "fire_pump",
      criticality,
    },
  });
}

async function makeAssetDuty(orgId: string, assetId: string, isStatutory: boolean) {
  return prisma.assetDuty.create({
    data: {
      organizationId: orgId,
      assetId,
      titleEn: "Duty",
      titleAr: "واجب",
      authority: "CIVIL_DEFENSE",
      reference: "SBC 801",
      intervalDays: 365,
      graceDays: 30,
      requiresCertificate: true,
      requiresThirdParty: true,
      isStatutory,
    },
  });
}

async function makeRecord(orgId: string, assetDutyId: string, userId: string, supersedesId?: string) {
  return prisma.inspectionRecord.create({
    data: {
      organizationId: orgId,
      assetDutyId,
      performedOn: new Date("2026-01-01"),
      performedBy: "Inspector",
      result: "PASS",
      recordedById: userId,
      ...(supersedesId ? { supersedesId, correctionReason: "typo in date" } : {}),
    },
  });
}

describe("InspectionRecord immutability (enforced by DB trigger)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("rejects UPDATE of a submitted record", async () => {
    const { orgId, userId, siteId } = await seedOrgUser();
    const asset = await makeAsset(orgId, siteId);
    const duty = await makeAssetDuty(orgId, asset.id, true);
    const record = await makeRecord(orgId, duty.id, userId);

    await expect(
      prisma.inspectionRecord.update({ where: { id: record.id }, data: { result: "FAIL" } }),
    ).rejects.toThrow(/immutable/i);

    const after = await prisma.inspectionRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.result).toBe("PASS");
  });

  it("rejects DELETE of a submitted record", async () => {
    const { orgId, userId, siteId } = await seedOrgUser();
    const asset = await makeAsset(orgId, siteId);
    const duty = await makeAssetDuty(orgId, asset.id, true);
    const record = await makeRecord(orgId, duty.id, userId);

    await expect(
      prisma.inspectionRecord.delete({ where: { id: record.id } }),
    ).rejects.toThrow(/immutable/i);

    expect(await prisma.inspectionRecord.count()).toBe(1);
  });

  it("rejects TRUNCATE of inspection_records (statement-level guard)", async () => {
    await expect(prisma.$executeRawUnsafe("TRUNCATE TABLE inspection_records")).rejects.toThrow(
      /immutable|TRUNCATE/i,
    );
  });

  it("allows correction only by superseding — both records survive", async () => {
    const { orgId, userId, siteId } = await seedOrgUser();
    const asset = await makeAsset(orgId, siteId);
    const duty = await makeAssetDuty(orgId, asset.id, true);
    const wrong = await makeRecord(orgId, duty.id, userId);
    const fix = await makeRecord(orgId, duty.id, userId, wrong.id);

    const all = await prisma.inspectionRecord.findMany({ orderBy: { recordedAt: "asc" } });
    expect(all).toHaveLength(2);
    expect(fix.supersedesId).toBe(wrong.id);
    expect(fix.correctionReason).toBe("typo in date");
  });
});

describe("Statutory duty deletion guard", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("rejects DELETE of a statutory asset_duty", async () => {
    const { orgId, siteId } = await seedOrgUser();
    const asset = await makeAsset(orgId, siteId);
    const duty = await makeAssetDuty(orgId, asset.id, true);

    await expect(
      prisma.assetDuty.delete({ where: { id: duty.id } }),
    ).rejects.toThrow(/statutory/i);
    expect(await prisma.assetDuty.count()).toBe(1);
  });

  it("allows deactivation of a statutory duty with a reason", async () => {
    const { orgId, siteId } = await seedOrgUser();
    const asset = await makeAsset(orgId, siteId);
    const duty = await makeAssetDuty(orgId, asset.id, true);

    const updated = await prisma.assetDuty.update({
      where: { id: duty.id },
      data: { active: false, deactivationReason: "Asset decommissioned", deactivatedAt: new Date() },
    });
    expect(updated.active).toBe(false);
    expect(updated.deactivationReason).toBe("Asset decommissioned");
  });

  it("allows DELETE of a non-statutory asset_duty", async () => {
    const { orgId, siteId } = await seedOrgUser();
    const asset = await makeAsset(orgId, siteId);
    const duty = await makeAssetDuty(orgId, asset.id, false);

    await prisma.assetDuty.delete({ where: { id: duty.id } });
    expect(await prisma.assetDuty.count()).toBe(0);
  });
});
