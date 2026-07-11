import { getPrisma } from "@cmp/db";
import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth/guards.js";
import { badRequest } from "../errors.js";
import { logAccess } from "../services/audit.js";
import { loadFile, storeFile } from "../services/files.js";

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.post("/files", async (req, reply) => {
    const auth = requireRole(req, "OWNER", "MANAGER", "TECHNICIAN");
    const file = await req.file();
    if (file === undefined) throw badRequest("No file uploaded");
    const buffer = await file.toBuffer();
    const result = await storeFile(prisma, app.storage, auth, {
      filename: file.filename,
      contentType: file.mimetype,
      buffer,
    });
    await logAccess(prisma, auth, "UPLOAD", "FileObject", result.id);
    reply.code(201);
    return result;
  });

  app.get<{ Params: { id: string } }>("/files/:id", async (req, reply) => {
    const auth = requireAuth(req);
    const file = await loadFile(prisma, app.storage, auth, req.params.id);
    await logAccess(prisma, auth, "DOWNLOAD", "FileObject", req.params.id);
    reply.header("content-type", file.contentType);
    reply.header("content-disposition", `inline; filename="${encodeURIComponent(file.filename)}"`);
    return reply.send(file.body);
  });
}
