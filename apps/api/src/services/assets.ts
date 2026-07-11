import {
  asIsoDate,
  computeDerived,
  todayInRiyadh,
  type Criticality,
  type Derived,
  type IsoDate,
} from "@cmp/core";
import { assetDutyDataFromDuty, type PrismaClient } from "@cmp/db";
import type { AuthContext } from "../auth/session.js";
import { conflict, notFound } from "../errors.js";

export interface CreateAssetInput {
  siteId: string;
  tag: string;
  name: string;
  assetType: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  commissionedOn?: string | null;
  locationDetail?: string | null;
  criticality: Criticality;
}

function toIso(date: Date | null): IsoDate | null {
  return date === null ? null : asIsoDate(date.toISOString().slice(0, 10));
}

/** Templates that apply to an asset type: system-wide plus the tenant's own. */
export async function matchingTemplates(prisma: PrismaClient, organizationId: string, assetType: string) {
  return prisma.inspectionDuty.findMany({
    where: { assetType, active: true, OR: [{ organizationId: null }, { organizationId }] },
  });
}

export async function createAsset(prisma: PrismaClient, auth: AuthContext, input: CreateAssetInput) {
  const site = await prisma.site.findFirst({
    where: { id: input.siteId, organizationId: auth.organizationId },
  });
  if (site === null) throw notFound("Site not found");

  const templates = await matchingTemplates(prisma, auth.organizationId, input.assetType);

  try {
    return await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          organizationId: auth.organizationId,
          siteId: input.siteId,
          tag: input.tag,
          name: input.name,
          assetType: input.assetType,
          manufacturer: input.manufacturer ?? null,
          model: input.model ?? null,
          serialNumber: input.serialNumber ?? null,
          commissionedOn: input.commissionedOn ? new Date(input.commissionedOn) : null,
          locationDetail: input.locationDetail ?? null,
          criticality: input.criticality,
        },
      });
      if (templates.length > 0) {
        await tx.assetDuty.createMany({
          data: templates.map((t) => assetDutyDataFromDuty(t, auth.organizationId, asset.id)),
        });
      }
      return asset;
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      throw conflict(`An asset with tag "${input.tag}" already exists at this site`);
    }
    throw err;
  }
}

export interface DutyStatusView extends Derived {
  assetDutyId: string;
  titleEn: string;
  titleAr: string;
  authority: string;
  reference: string;
  intervalDays: number;
  graceDays: number;
  isStatutory: boolean;
  requiresCertificate: boolean;
  requiresThirdParty: boolean;
  active: boolean;
}

export interface AssetStatusView {
  id: string;
  siteId: string;
  tag: string;
  name: string;
  assetType: string;
  criticality: Criticality;
  commissionedOn: IsoDate | null;
  locationDetail: string | null;
  duties: DutyStatusView[];
}

function projectDuty(
  duty: {
    id: string;
    titleEn: string;
    titleAr: string;
    authority: string;
    reference: string;
    intervalDays: number;
    graceDays: number;
    isStatutory: boolean;
    requiresCertificate: boolean;
    requiresThirdParty: boolean;
    active: boolean;
    records: { id: string; performedOn: Date; supersedesId: string | null }[];
  },
  commissionedOn: IsoDate | null,
  today: IsoDate,
): DutyStatusView {
  const derived = computeDerived({
    today,
    commissionedOn,
    intervalDays: duty.intervalDays,
    graceDays: duty.graceDays,
    records: duty.records.map((r) => ({
      id: r.id,
      performedOn: asIsoDate(r.performedOn.toISOString().slice(0, 10)),
      supersedesId: r.supersedesId,
    })),
  });
  return {
    assetDutyId: duty.id,
    titleEn: duty.titleEn,
    titleAr: duty.titleAr,
    authority: duty.authority,
    reference: duty.reference,
    intervalDays: duty.intervalDays,
    graceDays: duty.graceDays,
    isStatutory: duty.isStatutory,
    requiresCertificate: duty.requiresCertificate,
    requiresThirdParty: duty.requiresThirdParty,
    active: duty.active,
    ...derived,
  };
}

export async function getAssetStatus(
  prisma: PrismaClient,
  auth: AuthContext,
  assetId: string,
): Promise<AssetStatusView> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, organizationId: auth.organizationId, siteId: { in: [...auth.siteIds] } },
    include: { assetDuties: { include: { records: true } } },
  });
  if (asset === null) throw notFound("Asset not found");

  const today = todayInRiyadh();
  const commissionedOn = toIso(asset.commissionedOn);
  return {
    id: asset.id,
    siteId: asset.siteId,
    tag: asset.tag,
    name: asset.name,
    assetType: asset.assetType,
    criticality: asset.criticality,
    commissionedOn,
    locationDetail: asset.locationDetail,
    duties: asset.assetDuties.map((d) => projectDuty(d, commissionedOn, today)),
  };
}

export interface DashboardFilter {
  siteId?: string;
  criticality?: Criticality;
}

export async function listAssetStatus(
  prisma: PrismaClient,
  auth: AuthContext,
  filter: DashboardFilter,
): Promise<AssetStatusView[]> {
  const siteIds = filter.siteId ? [filter.siteId].filter((s) => auth.siteIds.includes(s)) : [...auth.siteIds];
  const assets = await prisma.asset.findMany({
    where: {
      organizationId: auth.organizationId,
      siteId: { in: siteIds },
      ...(filter.criticality ? { criticality: filter.criticality } : {}),
    },
    include: { assetDuties: { include: { records: true } } },
    orderBy: [{ criticality: "asc" }, { tag: "asc" }],
  });

  const today = todayInRiyadh();
  return assets.map((asset) => {
    const commissionedOn = toIso(asset.commissionedOn);
    return {
      id: asset.id,
      siteId: asset.siteId,
      tag: asset.tag,
      name: asset.name,
      assetType: asset.assetType,
      criticality: asset.criticality,
      commissionedOn,
      locationDetail: asset.locationDetail,
      duties: asset.assetDuties.map((d) => projectDuty(d, commissionedOn, today)),
    };
  });
}
