import { randomBytes } from "node:crypto";
import type { PrismaClient, Role } from "@cmp/db";

export const SESSION_COOKIE = "cmp_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export interface AuthContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: Role;
  /** Sites this user may act on. OWNER/MANAGER see all org sites. */
  readonly siteIds: readonly string[];
}

export async function createSession(prisma: PrismaClient, userId: string): Promise<string> {
  const id = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { id, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return id;
}

export async function destroySession(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } });
}

export async function resolveAuth(prisma: PrismaClient, sessionId: string): Promise<AuthContext | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { include: { siteAccess: true, organization: true } } },
  });
  if (session === null || session.expiresAt < new Date() || !session.user.active) return null;

  const { user } = session;
  const scopedSites = user.siteAccess.map((s) => s.siteId);
  const siteIds =
    user.role === "OWNER" || user.role === "MANAGER"
      ? (await prisma.site.findMany({ where: { organizationId: user.organizationId }, select: { id: true } })).map((s) => s.id)
      : scopedSites;

  return { userId: user.id, organizationId: user.organizationId, role: user.role, siteIds };
}
