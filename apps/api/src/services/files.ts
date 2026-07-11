import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@cmp/db";
import type { AuthContext } from "../auth/session.js";
import { notFound } from "../errors.js";
import type { FileStorage } from "../storage/index.js";

export async function storeFile(
  prisma: PrismaClient,
  storage: FileStorage,
  auth: AuthContext,
  file: { filename: string; contentType: string; buffer: Buffer },
): Promise<{ id: string }> {
  const key = `${auth.organizationId}/${randomUUID()}`;
  await storage.put(key, file.buffer, file.contentType);
  const row = await prisma.fileObject.create({
    data: {
      organizationId: auth.organizationId,
      storageKey: key,
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.buffer.length,
    },
  });
  return { id: row.id };
}

export async function loadFile(
  prisma: PrismaClient,
  storage: FileStorage,
  auth: AuthContext,
  fileId: string,
): Promise<{ filename: string; contentType: string; body: Buffer }> {
  const row = await prisma.fileObject.findFirst({
    where: { id: fileId, organizationId: auth.organizationId },
  });
  if (row === null) throw notFound("File not found");
  const body = await storage.get(row.storageKey);
  return { filename: row.filename, contentType: row.contentType, body };
}
