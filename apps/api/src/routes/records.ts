import { INSPECTION_RESULT, isIsoDate } from "@cmp/core";
import { getPrisma } from "@cmp/db";
import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth/guards.js";
import { badRequest } from "../errors.js";
import { logAccess } from "../services/audit.js";
import { listRecords, submitRecord, supersedeRecord, type SubmitRecordInput } from "../services/records.js";
import { asObject, oneOf, optStr, str } from "../validate.js";

function readBody(req: { body: unknown }): SubmitRecordInput {
  const b = asObject(req.body);
  const performedOn = str(b, "performedOn");
  if (!isIsoDate(performedOn)) throw badRequest("performedOn must be a valid date (YYYY-MM-DD)");
  return {
    performedOn,
    performedBy: str(b, "performedBy", { max: 200 }),
    performedByCompany: optStr(b, "performedByCompany"),
    thirdPartyAccreditationRef: optStr(b, "thirdPartyAccreditationRef"),
    result: oneOf(b, "result", INSPECTION_RESULT),
    findings: optStr(b, "findings"),
    nextAction: optStr(b, "nextAction"),
    certificateId: optStr(b, "certificateId"),
  };
}

export async function recordRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.get<{ Params: { id: string } }>("/asset-duties/:id/records", async (req) => {
    const auth = requireAuth(req);
    const records = await listRecords(prisma, auth, req.params.id);
    await logAccess(prisma, auth, "VIEW", "AssetDuty", req.params.id);
    return records;
  });

  app.post<{ Params: { id: string } }>("/asset-duties/:id/records", async (req, reply) => {
    const auth = requireRole(req, "OWNER", "MANAGER", "TECHNICIAN");
    const record = await submitRecord(prisma, auth, req.params.id, readBody(req));
    await logAccess(prisma, auth, "CREATE", "InspectionRecord", record.id);
    reply.code(201);
    return record;
  });

  app.post<{ Params: { id: string } }>("/records/:id/supersede", async (req, reply) => {
    const auth = requireRole(req, "OWNER", "MANAGER");
    const b = asObject(req.body);
    const record = await supersedeRecord(prisma, auth, req.params.id, {
      ...readBody(req),
      correctionReason: str(b, "correctionReason", { max: 1000 }),
    });
    await logAccess(prisma, auth, "SUPERSEDE", "InspectionRecord", record.id);
    reply.code(201);
    return record;
  });

  app.get<{ Params: { id: string } }>("/asset-duties/:id/defects", async (req) => {
    const auth = requireAuth(req);
    return prisma.defect.findMany({
      where: {
        assetDutyId: req.params.id,
        organizationId: auth.organizationId,
        assetDuty: { asset: { siteId: { in: [...auth.siteIds] } } },
      },
      orderBy: { createdAt: "desc" },
    });
  });
}
