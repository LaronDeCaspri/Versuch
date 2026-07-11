import type { FastifyInstance } from "fastify";
import { ASSET_TYPES, CRITICALITY, isAssetTypeKey, type Criticality } from "@cmp/core";
import { getPrisma } from "@cmp/db";
import { assertSiteAccess, requireAuth, requireRole } from "../auth/guards.js";
import { badRequest } from "../errors.js";
import { createAsset, getAssetStatus, listAssetStatus } from "../services/assets.js";
import { importAssets } from "../services/import.js";
import { asObject, oneOf, optStr, str } from "../validate.js";

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.get("/asset-types", async (req) => {
    requireAuth(req);
    return ASSET_TYPES;
  });

  // The red wall: every asset + duty with derived status, filterable.
  app.get<{ Querystring: { siteId?: string; criticality?: string } }>("/assets", async (req) => {
    const auth = requireAuth(req);
    const criticality = req.query.criticality;
    if (criticality !== undefined && !(CRITICALITY as readonly string[]).includes(criticality)) {
      throw badRequest("Invalid criticality filter");
    }
    return listAssetStatus(prisma, auth, {
      ...(req.query.siteId ? { siteId: req.query.siteId } : {}),
      ...(criticality ? { criticality: criticality as Criticality } : {}),
    });
  });

  app.get<{ Params: { id: string } }>("/assets/:id", async (req) => {
    const auth = requireAuth(req);
    return getAssetStatus(prisma, auth, req.params.id);
  });

  app.post("/assets", async (req, reply) => {
    const auth = requireRole(req, "OWNER", "MANAGER");
    const body = asObject(req.body);
    const siteId = str(body, "siteId");
    assertSiteAccess(auth, siteId);
    const assetType = str(body, "assetType");
    if (!isAssetTypeKey(assetType)) throw badRequest(`Unknown asset type: ${assetType}`);

    const asset = await createAsset(prisma, auth, {
      siteId,
      tag: str(body, "tag", { max: 100 }),
      name: str(body, "name", { max: 300 }),
      assetType,
      criticality: oneOf(body, "criticality", CRITICALITY),
      manufacturer: optStr(body, "manufacturer"),
      model: optStr(body, "model"),
      serialNumber: optStr(body, "serialNumber"),
      commissionedOn: optStr(body, "commissionedOn"),
      locationDetail: optStr(body, "locationDetail"),
    });
    reply.code(201);
    return getAssetStatus(prisma, auth, asset.id);
  });

  app.post<{ Querystring: { siteId?: string } }>("/assets/import", async (req, reply) => {
    const auth = requireRole(req, "OWNER", "MANAGER");
    const siteId = req.query.siteId;
    if (siteId === undefined) throw badRequest("Query parameter siteId is required");
    assertSiteAccess(auth, siteId);

    const file = await req.file();
    if (file === undefined) throw badRequest("No file uploaded");
    const buffer = await file.toBuffer();
    const report = await importAssets(prisma, auth, siteId, buffer);
    reply.code(report.errors > 0 && report.created === 0 ? 422 : 200);
    return report;
  });
}
