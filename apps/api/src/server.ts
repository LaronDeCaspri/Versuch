import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { getPrisma } from "@cmp/db";
import { resolveAuth, SESSION_COOKIE } from "./auth/session.js";
import { loadEnv } from "./env.js";
import { AppError } from "./errors.js";
import { assetRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { dossierRoutes } from "./routes/dossier.js";
import { fileRoutes } from "./routes/files.js";
import { recordRoutes } from "./routes/records.js";
import { siteRoutes } from "./routes/sites.js";
import { createStorage, type FileStorage } from "./storage/index.js";

declare module "fastify" {
  interface FastifyInstance {
    storage: FileStorage;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const prisma = getPrisma();
  const app = Fastify({ logger: env.nodeEnv !== "test" });

  await app.register(cookie, { secret: env.sessionSecret });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });
  app.decorate("storage", await createStorage());

  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (req) => {
    const sid = req.cookies[SESSION_COOKIE];
    req.auth = sid === undefined ? null : await resolveAuth(prisma, sid);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    if ((err as { validation?: unknown }).validation !== undefined) {
      const message = err instanceof Error ? err.message : "Invalid request";
      reply.code(400).send({ error: { code: "BAD_REQUEST", message } });
      return;
    }
    req.log.error(err as Error);
    reply.code(500).send({ error: { code: "INTERNAL", message: "Internal server error" } });
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(siteRoutes);
  await app.register(assetRoutes);
  await app.register(recordRoutes);
  await app.register(fileRoutes);
  await app.register(dossierRoutes);

  return app;
}
