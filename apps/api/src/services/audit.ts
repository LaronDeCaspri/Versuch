import type { PrismaClient } from "@cmp/db";
import type { AuthContext } from "../auth/session.js";

/** PDPL: record who accessed which record and when. */
export async function logAccess(
  prisma: PrismaClient,
  auth: AuthContext,
  action: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  await prisma.accessLog.create({
    data: { organizationId: auth.organizationId, userId: auth.userId, action, entityType, entityId },
  });
}
