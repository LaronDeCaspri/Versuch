import type { FastifyInstance } from "fastify";
import { getPrisma } from "@cmp/db";
import { requireAuth } from "../auth/guards.js";
import { verifyPassword } from "../auth/password.js";
import { createSession, destroySession, SESSION_COOKIE } from "../auth/session.js";
import { unauthorized } from "../errors.js";
import { asObject, str } from "../validate.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.post("/auth/login", async (req, reply) => {
    const body = asObject(req.body);
    const email = str(body, "email").toLowerCase();
    const password = str(body, "password");

    // Email is unique per organization, so the same address may exist in more
    // than one tenant. Verify against every candidate and select the account
    // whose password matches, rather than an arbitrary first row.
    const candidates = await prisma.user.findMany({ where: { email, active: true } });
    let user: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (await verifyPassword(password, candidate.passwordHash)) {
        user = candidate;
        break;
      }
    }
    // Keep timing uniform when no candidate matches (including unknown emails).
    if (user === null) {
      await verifyPassword(password, "scrypt$00$00");
      throw unauthorized("Invalid email or password");
    }

    const sessionId = await createSession(prisma, user.id);
    reply.setCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "strict",
      secure: app.config.cookieSecure,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return { id: user.id, name: user.name, role: user.role, organizationId: user.organizationId };
  });

  app.post("/auth/logout", async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid !== undefined) await destroySession(prisma, sid);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (req) => {
    const auth = requireAuth(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: auth.role,
      organizationId: auth.organizationId,
      siteIds: auth.siteIds,
    };
  });
}
