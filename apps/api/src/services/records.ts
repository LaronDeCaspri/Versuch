import { asIsoDate, todayInRiyadh, type InspectionResult } from "@cmp/core";
import type { DefectSeverity, Prisma, PrismaClient } from "@cmp/db";
import type { AuthContext } from "../auth/session.js";
import { badRequest, conflict, notFound } from "../errors.js";

export interface SubmitRecordInput {
  performedOn: string;
  performedBy: string;
  performedByCompany?: string | null;
  thirdPartyAccreditationRef?: string | null;
  result: InspectionResult;
  findings?: string | null;
  nextAction?: string | null;
  certificateId?: string | null;
}

type Tx = Prisma.TransactionClient;

async function loadDutyForWrite(prisma: PrismaClient, auth: AuthContext, assetDutyId: string) {
  const duty = await prisma.assetDuty.findFirst({
    where: { id: assetDutyId, organizationId: auth.organizationId, asset: { siteId: { in: [...auth.siteIds] } } },
    include: { asset: true },
  });
  if (duty === null) throw notFound("Duty not found");
  return duty;
}

function validate(input: SubmitRecordInput, today: string): void {
  const performed = asIsoDate(input.performedOn);
  if (performed > today) throw badRequest("performedOn cannot be in the future");
  if (input.performedBy.trim() === "") throw badRequest("performedBy is required");
}

function severityFor(result: InspectionResult, criticality: string): DefectSeverity {
  if (result === "FAIL") return criticality === "LIFE_SAFETY" ? "CRITICAL" : "MAJOR";
  return "MINOR"; // PASS_WITH_DEFECTS
}

/** A FAIL/PASS_WITH_DEFECTS raises a defect; a clean PASS clears open defects. */
async function applyEffects(
  tx: Tx,
  organizationId: string,
  assetDutyId: string,
  criticality: string,
  record: { id: string; result: InspectionResult; findings: string | null },
): Promise<void> {
  if (record.result === "FAIL" || record.result === "PASS_WITH_DEFECTS") {
    await tx.defect.create({
      data: {
        organizationId,
        assetDutyId,
        raisedByRecordId: record.id,
        severity: severityFor(record.result, criticality),
        description: record.findings ?? "Defect raised by inspection",
        status: "OPEN",
      },
    });
  }
  if (record.result === "PASS") {
    await tx.defect.updateMany({
      where: { assetDutyId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      data: { status: "CLOSED", closedByRecordId: record.id },
    });
  }
}

async function assertCertificate(prisma: PrismaClient, auth: AuthContext, certificateId: string | null): Promise<void> {
  if (certificateId === null) return;
  const file = await prisma.fileObject.findFirst({ where: { id: certificateId, organizationId: auth.organizationId } });
  if (file === null) throw badRequest("certificateId does not reference a known file");
}

export async function submitRecord(
  prisma: PrismaClient,
  auth: AuthContext,
  assetDutyId: string,
  input: SubmitRecordInput,
) {
  const duty = await loadDutyForWrite(prisma, auth, assetDutyId);
  if (!duty.active) throw badRequest("Cannot record against a deactivated duty");
  validate(input, todayInRiyadh());
  await assertCertificate(prisma, auth, input.certificateId ?? null);

  return prisma.$transaction(async (tx) => {
    const record = await tx.inspectionRecord.create({
      data: {
        organizationId: auth.organizationId,
        assetDutyId,
        performedOn: new Date(input.performedOn),
        performedBy: input.performedBy.trim(),
        performedByCompany: input.performedByCompany ?? null,
        thirdPartyAccreditationRef: input.thirdPartyAccreditationRef ?? null,
        result: input.result,
        findings: input.findings ?? null,
        nextAction: input.nextAction ?? null,
        certificateId: input.certificateId ?? null,
        recordedById: auth.userId,
      },
    });
    await applyEffects(tx, auth.organizationId, assetDutyId, duty.asset.criticality, record);
    return record;
  });
}

export interface SupersedeInput extends SubmitRecordInput {
  correctionReason: string;
}

export async function supersedeRecord(
  prisma: PrismaClient,
  auth: AuthContext,
  recordId: string,
  input: SupersedeInput,
) {
  if (input.correctionReason.trim() === "") throw badRequest("correctionReason is required");
  const target = await prisma.inspectionRecord.findFirst({
    where: { id: recordId, organizationId: auth.organizationId },
    include: { supersededBy: true },
  });
  if (target === null) throw notFound("Record not found");
  if (target.supersededBy !== null) throw conflict("This record has already been superseded");

  const duty = await loadDutyForWrite(prisma, auth, target.assetDutyId);
  validate(input, todayInRiyadh());
  await assertCertificate(prisma, auth, input.certificateId ?? null);

  return prisma.$transaction(async (tx) => {
    const record = await tx.inspectionRecord.create({
      data: {
        organizationId: auth.organizationId,
        assetDutyId: target.assetDutyId,
        performedOn: new Date(input.performedOn),
        performedBy: input.performedBy.trim(),
        performedByCompany: input.performedByCompany ?? null,
        thirdPartyAccreditationRef: input.thirdPartyAccreditationRef ?? null,
        result: input.result,
        findings: input.findings ?? null,
        nextAction: input.nextAction ?? null,
        certificateId: input.certificateId ?? null,
        recordedById: auth.userId,
        supersedesId: target.id,
        correctionReason: input.correctionReason.trim(),
      },
    });
    await applyEffects(tx, auth.organizationId, target.assetDutyId, duty.asset.criticality, record);
    return record;
  });
}

export async function listRecords(prisma: PrismaClient, auth: AuthContext, assetDutyId: string) {
  await loadDutyForWrite(prisma, auth, assetDutyId);
  const records = await prisma.inspectionRecord.findMany({
    where: { assetDutyId, organizationId: auth.organizationId },
    orderBy: { recordedAt: "desc" },
    include: { supersededBy: { select: { id: true } }, certificate: { select: { id: true, filename: true } } },
  });
  // performedOn is a calendar date; expose it as YYYY-MM-DD so the client's date
  // convention (and <DateLabel>) receives what it expects.
  return records.map((r) => ({ ...r, performedOn: asIsoDate(r.performedOn.toISOString().slice(0, 10)) }));
}
