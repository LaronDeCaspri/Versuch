import type { FastifyRequest } from "fastify";
import type { Role } from "@cmp/db";
import { forbidden, unauthorized } from "../errors.js";
import type { AuthContext } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (req.auth === null) throw unauthorized();
  return req.auth;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthContext {
  const auth = requireAuth(req);
  if (!roles.includes(auth.role)) throw forbidden(`Requires role: ${roles.join(", ")}`);
  return auth;
}

/** A user may only touch a site they have access to (OWNER/MANAGER: all org sites). */
export function assertSiteAccess(auth: AuthContext, siteId: string): void {
  if (!auth.siteIds.includes(siteId)) throw forbidden("No access to this site");
}
