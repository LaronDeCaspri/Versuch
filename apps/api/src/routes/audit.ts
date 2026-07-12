import { getPrisma } from "@cmp/db";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guards.js";

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.get<{ Querystring: { limit?: string } }>("/audit", async (req) => {
    const auth = requireRole(req, "OWNER", "MANAGER");
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
    const logs = await prisma.accessLog.findMany({
      where: { organizationId: auth.organizationId },
      orderBy: { at: "desc" },
      take: limit,
      include: { user: { select: { name: true } } },
    });
    return logs.map((l) => ({
      id: l.id,
      at: l.at.toISOString(),
      userName: l.user?.name ?? null,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
    }));
  });
}
