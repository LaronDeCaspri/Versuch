import { PrismaClient } from "../node_modules/.prisma/client/index.js";

export { PrismaClient };
export * from "../node_modules/.prisma/client/index.js";

let singleton: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (singleton === undefined) singleton = new PrismaClient();
  return singleton;
}
