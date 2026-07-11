import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asIsoDate, computeDerived, todayInRiyadh, type IsoDate } from "@cmp/core";
import type { PrismaClient } from "@cmp/db";
import type { AuthContext } from "../auth/session.js";
import { badRequest, notFound } from "../errors.js";
import type { FileStorage } from "../storage/index.js";
import { buildDossierHtml, type DossierAsset, type DossierRecord } from "../dossier/html.js";
import { appendCertificates, renderHtmlToPdf, type Certificate } from "../dossier/render.js";

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");

function toIso(date: Date | null): IsoDate | null {
  return date === null ? null : asIsoDate(date.toISOString().slice(0, 10));
}

function isoOf(date: Date): IsoDate {
  return asIsoDate(date.toISOString().slice(0, 10));
}

export async function generateDossier(
  prisma: PrismaClient,
  storage: FileStorage,
  auth: AuthContext,
  params: { siteId: string; from: string; to: string },
): Promise<{ filename: string; pdf: Buffer }> {
  const from = asIsoDate(params.from);
  const to = asIsoDate(params.to);
  if (from > to) throw badRequest("`from` must not be after `to`");
  if (!auth.siteIds.includes(params.siteId)) throw notFound("Site not found");

  const site = await prisma.site.findFirst({
    where: { id: params.siteId, organizationId: auth.organizationId },
    include: { organization: true },
  });
  if (site === null) throw notFound("Site not found");

  const assets = await prisma.asset.findMany({
    where: { siteId: site.id, organizationId: auth.organizationId },
    include: { assetDuties: { include: { records: { include: { supersededBy: true, certificate: true } } } } },
    orderBy: [{ criticality: "asc" }, { tag: "asc" }],
  });

  const today = todayInRiyadh();
  const asOf = to > today ? today : to;

  const dossierAssets: DossierAsset[] = [];
  for (const asset of assets) {
    const commissionedOn = toIso(asset.commissionedOn);
    const duties = asset.assetDuties.map((duty) => {
      const upToAsOf = duty.records.filter((r) => isoOf(r.performedOn) <= asOf);
      const derived = computeDerived({
        today: asOf,
        commissionedOn,
        intervalDays: duty.intervalDays,
        graceDays: duty.graceDays,
        records: upToAsOf.map((r) => ({ id: r.id, performedOn: isoOf(r.performedOn), supersedesId: r.supersedesId })),
      });

      const inRange = duty.records
        .filter((r) => {
          const d = isoOf(r.performedOn);
          return d >= from && d <= to;
        })
        .sort((a, b) => (isoOf(a.performedOn) < isoOf(b.performedOn) ? 1 : -1));

      const records: DossierRecord[] = inRange.map((r) => {
        return {
          performedOn: isoOf(r.performedOn),
          performedBy: r.performedBy,
          performedByCompany: r.performedByCompany,
          thirdPartyAccreditationRef: r.thirdPartyAccreditationRef,
          result: r.result,
          findings: r.findings,
          certificateFilename: r.certificate?.filename ?? null,
          superseded: r.supersededBy !== null,
          correctionReason: r.correctionReason,
        };
      });

      return {
        titleAr: duty.titleAr,
        authority: duty.authority,
        reference: duty.reference,
        isStatutory: duty.isStatutory,
        intervalDays: duty.intervalDays,
        status: derived.status,
        nextDueOn: derived.nextDueOn,
        lastCompletedOn: derived.lastCompletedOn,
        records,
      };
    });
    dossierAssets.push({
      tag: asset.tag,
      name: asset.name,
      criticality: asset.criticality,
      locationDetail: asset.locationDetail,
      duties,
    });
  }

  // Fetch certificate bytes (kept out of the projection loop for clarity).
  const certRows = await prisma.inspectionRecord.findMany({
    where: {
      organizationId: auth.organizationId,
      assetDuty: { asset: { siteId: site.id } },
      certificateId: { not: null },
      performedOn: { gte: new Date(from), lte: new Date(to) },
    },
    include: { certificate: true, assetDuty: { include: { asset: true } } },
    orderBy: [{ performedOn: "asc" }],
  });
  const fetched: Certificate[] = [];
  for (const row of certRows) {
    if (row.certificate === null) continue;
    fetched.push({
      label: `${row.assetDuty.asset.tag} | ${isoOf(row.performedOn)}`,
      contentType: row.certificate.contentType,
      body: await storage.get(row.certificate.storageKey),
    });
  }

  const generatedByUser = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true } });

  const [fontRegular, fontBold] = await Promise.all([
    readFile(join(FONT_DIR, "Amiri-Regular.ttf")),
    readFile(join(FONT_DIR, "Amiri-Bold.ttf")),
  ]);

  const html = buildDossierHtml({
    orgName: site.organization.name,
    site: { name: site.name, address: site.address, client: site.client, responsiblePerson: site.responsiblePerson },
    from,
    to,
    generatedAt: todayInRiyadh(),
    generatedBy: generatedByUser?.name ?? auth.userId,
    assets: dossierAssets,
    fontRegularBase64: fontRegular.toString("base64"),
    fontBoldBase64: fontBold.toString("base64"),
  });

  const body = await renderHtmlToPdf(html);
  const pdf = await appendCertificates(body, fetched);
  return { filename: `dossier-${site.name}-${from}_${to}.pdf`, pdf };
}
