import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asIsoDate, computeDerived, type RecordRef } from "@cmp/core";
import { assetDutyDataFromDuty } from "../src/duties.js";
import { prisma, resetDb, seedOrgUser } from "./helpers.js";

const TODAY = asIsoDate("2026-07-11");

function toRecordRef(r: { id: string; performedOn: Date; supersedesId: string | null }): RecordRef {
  return {
    id: r.id,
    performedOn: asIsoDate(r.performedOn.toISOString().slice(0, 10)),
    supersedesId: r.supersedesId,
  };
}

describe("status engine over DB rows", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("instantiates a snapshotted AssetDuty from a template and derives NEVER_DONE", async () => {
    const { orgId, siteId } = await seedOrgUser();
    const template = await prisma.inspectionDuty.create({
      data: {
        organizationId: null,
        assetType: "fire_pump",
        titleEn: "Annual test",
        titleAr: "اختبار سنوي",
        authority: "CIVIL_DEFENSE",
        reference: "SBC 801",
        intervalDays: 365,
        graceDays: 30,
        requiresCertificate: true,
        requiresThirdParty: true,
        isStatutory: true,
      },
    });
    const asset = await prisma.asset.create({
      data: {
        organizationId: orgId,
        siteId,
        tag: "FP-99",
        name: "Pump",
        assetType: "fire_pump",
        criticality: "LIFE_SAFETY",
        commissionedOn: new Date("2019-01-01"),
      },
    });
    const [duty] = await prisma.$transaction([
      prisma.assetDuty.create({ data: assetDutyDataFromDuty(template, orgId, asset.id) }),
    ]);

    // Snapshot copied the definition, not a reference.
    expect(duty.titleAr).toBe("اختبار سنوي");
    expect(duty.isStatutory).toBe(true);
    expect(duty.sourceDutyId).toBe(template.id);

    const records = await prisma.inspectionRecord.findMany({ where: { assetDutyId: duty.id } });
    const derived = computeDerived({
      today: TODAY,
      commissionedOn: asIsoDate("2019-01-01"),
      intervalDays: duty.intervalDays,
      graceDays: duty.graceDays,
      records: records.map(toRecordRef),
    });
    expect(derived.status).toBe("NEVER_DONE");
  });

  it("derives OK after a recent record and excludes superseded records", async () => {
    const { orgId, userId, siteId } = await seedOrgUser();
    const asset = await prisma.asset.create({
      data: {
        organizationId: orgId,
        siteId,
        tag: "FP-100",
        name: "Pump",
        assetType: "fire_pump",
        criticality: "LIFE_SAFETY",
        commissionedOn: new Date("2019-01-01"),
      },
    });
    const duty = await prisma.assetDuty.create({
      data: {
        organizationId: orgId,
        assetId: asset.id,
        titleEn: "Annual",
        titleAr: "سنوي",
        authority: "CIVIL_DEFENSE",
        reference: "SBC 801",
        intervalDays: 365,
        graceDays: 30,
        requiresCertificate: true,
        requiresThirdParty: true,
        isStatutory: true,
      },
    });
    const wrong = await prisma.inspectionRecord.create({
      data: {
        organizationId: orgId,
        assetDutyId: duty.id,
        performedOn: new Date("2020-01-01"),
        performedBy: "X",
        result: "PASS",
        recordedById: userId,
      },
    });
    await prisma.inspectionRecord.create({
      data: {
        organizationId: orgId,
        assetDutyId: duty.id,
        performedOn: new Date("2026-06-01"),
        performedBy: "X",
        result: "PASS",
        recordedById: userId,
        supersedesId: wrong.id,
        correctionReason: "corrected date",
      },
    });

    const records = await prisma.inspectionRecord.findMany({ where: { assetDutyId: duty.id } });
    const derived = computeDerived({
      today: TODAY,
      commissionedOn: asIsoDate("2019-01-01"),
      intervalDays: 365,
      graceDays: 30,
      records: records.map(toRecordRef),
    });
    expect(derived.lastCompletedOn).toBe("2026-06-01");
    expect(derived.status).toBe("OK");
  });
});
