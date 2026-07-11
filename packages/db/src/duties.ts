import type { InspectionDuty, Prisma } from "../node_modules/.prisma/client/index.js";

/**
 * Snapshot a template duty onto an asset. Copying the definition (rather than
 * referencing it) means a later edit to the template can never rewrite the
 * compliance history already recorded against an asset.
 */
export function assetDutyDataFromDuty(
  duty: InspectionDuty,
  organizationId: string,
  assetId: string,
): Prisma.AssetDutyCreateManyInput {
  return {
    organizationId,
    assetId,
    sourceDutyId: duty.id,
    titleEn: duty.titleEn,
    titleAr: duty.titleAr,
    authority: duty.authority,
    reference: duty.reference,
    intervalDays: duty.intervalDays,
    graceDays: duty.graceDays,
    requiresCertificate: duty.requiresCertificate,
    requiresThirdParty: duty.requiresThirdParty,
    isStatutory: duty.isStatutory,
  };
}
