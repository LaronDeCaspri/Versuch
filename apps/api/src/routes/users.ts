import { ROLE } from "@cmp/core";
import { getPrisma } from "@cmp/db";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guards.js";
import { createUser, listUsers, updateUser } from "../services/users.js";
import { asObject, oneOf, optStr, str } from "../validate.js";

function strArray(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x): x is string => typeof x === "string")) {
    throw new Error(`Field "${key}" must be an array of strings`);
  }
  return v;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.get("/users", async (req) => {
    const auth = requireRole(req, "OWNER");
    return listUsers(prisma, auth);
  });

  app.post("/users", async (req, reply) => {
    const auth = requireRole(req, "OWNER");
    const b = asObject(req.body);
    const user = await createUser(prisma, auth, {
      email: str(b, "email", { max: 200 }),
      name: str(b, "name", { max: 200 }),
      password: str(b, "password", { max: 200 }),
      role: oneOf(b, "role", ROLE),
      siteIds: strArray(b, "siteIds"),
    });
    reply.code(201);
    return user;
  });

  app.patch<{ Params: { id: string } }>("/users/:id", async (req) => {
    const auth = requireRole(req, "OWNER");
    const b = asObject(req.body);
    const name = optStr(b, "name");
    return updateUser(prisma, auth, req.params.id, {
      ...(name !== null ? { name } : {}),
      ...(b["role"] !== undefined ? { role: oneOf(b, "role", ROLE) } : {}),
      ...(typeof b["active"] === "boolean" ? { active: b["active"] } : {}),
      ...(b["siteIds"] !== undefined ? { siteIds: strArray(b, "siteIds") } : {}),
    });
  });
}
