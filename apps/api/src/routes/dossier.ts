import { isIsoDate } from "@cmp/core";
import { getPrisma } from "@cmp/db";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/guards.js";
import { badRequest } from "../errors.js";
import { logAccess } from "../services/audit.js";
import { generateDossier } from "../services/dossier.js";

export async function dossierRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    "/sites/:id/dossier",
    async (req, reply) => {
      const auth = requireAuth(req);
      const { from, to } = req.query;
      if (from === undefined || to === undefined || !isIsoDate(from) || !isIsoDate(to)) {
        throw badRequest("`from` and `to` query params (YYYY-MM-DD) are required");
      }
      const { filename, pdf } = await generateDossier(prisma, app.storage, auth, {
        siteId: req.params.id,
        from,
        to,
      });
      await logAccess(prisma, auth, "EXPORT_DOSSIER", "Site", req.params.id);
      reply.header("content-type", "application/pdf");
      reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return reply.send(pdf);
    },
  );
}
