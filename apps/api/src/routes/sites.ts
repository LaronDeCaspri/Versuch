import type { FastifyInstance } from "fastify";
import { getPrisma } from "@cmp/db";
import { assertSiteAccess, requireAuth, requireRole } from "../auth/guards.js";
import { notFound } from "../errors.js";
import { asObject, str } from "../validate.js";

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.get("/sites", async (req) => {
    const auth = requireAuth(req);
    return prisma.site.findMany({
      where: { organizationId: auth.organizationId, id: { in: [...auth.siteIds] } },
      orderBy: { name: "asc" },
    });
  });

  app.post("/sites", async (req, reply) => {
    const auth = requireRole(req, "OWNER", "MANAGER");
    const body = asObject(req.body);
    const site = await prisma.site.create({
      data: {
        organizationId: auth.organizationId,
        name: str(body, "name", { max: 200 }),
        address: str(body, "address", { max: 500 }),
        client: str(body, "client", { max: 200 }),
        responsiblePerson: str(body, "responsiblePerson", { max: 200 }),
      },
    });
    reply.code(201);
    return site;
  });

  app.get<{ Params: { id: string } }>("/sites/:id", async (req) => {
    const auth = requireAuth(req);
    assertSiteAccess(auth, req.params.id);
    const site = await prisma.site.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
    });
    if (site === null) throw notFound("Site not found");
    return site;
  });

  app.patch<{ Params: { id: string } }>("/sites/:id", async (req) => {
    const auth = requireRole(req, "OWNER", "MANAGER");
    assertSiteAccess(auth, req.params.id);
    const body = asObject(req.body);
    const existing = await prisma.site.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
    });
    if (existing === null) throw notFound("Site not found");
    return prisma.site.update({
      where: { id: req.params.id },
      data: {
        name: str(body, "name", { max: 200 }),
        address: str(body, "address", { max: 500 }),
        client: str(body, "client", { max: 200 }),
        responsiblePerson: str(body, "responsiblePerson", { max: 200 }),
      },
    });
  });
}
