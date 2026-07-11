import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/session.js";
import { loadFile, storeFile } from "../src/services/files.js";
import { createStorage } from "../src/storage/index.js";
import { prisma, resetDb, seedFixture } from "./helpers.js";

describe("file storage", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("stores and retrieves a certificate, scoped to the tenant", async () => {
    const fx = await seedFixture();
    const storage = await createStorage();
    const auth: AuthContext = { userId: fx.ownerId, organizationId: fx.orgId, role: "OWNER", siteIds: [fx.siteAId] };

    const { id } = await storeFile(prisma, storage, auth, {
      filename: "cert.pdf",
      contentType: "application/pdf",
      buffer: Buffer.from("PDF-CONTENT"),
    });
    const loaded = await loadFile(prisma, storage, auth, id);
    expect(loaded.filename).toBe("cert.pdf");
    expect(loaded.body.toString()).toBe("PDF-CONTENT");

    // Another tenant cannot read it.
    const org2 = await prisma.organization.create({ data: { name: "Org2" } });
    const intruder: AuthContext = { userId: "x", organizationId: org2.id, role: "OWNER", siteIds: [] };
    await expect(loadFile(prisma, storage, intruder, id)).rejects.toThrow(/not found/i);
  });
});
