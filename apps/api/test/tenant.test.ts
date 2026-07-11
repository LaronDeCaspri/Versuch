import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, login, prisma, resetDb, seedFixture } from "./helpers.js";
import { hashPassword } from "../src/auth/password.js";

describe("cross-tenant isolation", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("never exposes another organization's asset", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    const created = await (await app()).inject({
      method: "POST",
      url: "/assets",
      headers: { cookie: owner },
      payload: { siteId: fx.siteAId, tag: "FP-1", name: "Pump", assetType: "fire_pump", criticality: "LIFE_SAFETY" },
    });
    const assetId = created.json().id;

    // A second org with its own owner.
    const org2 = await prisma.organization.create({ data: { name: "Org2" } });
    await prisma.user.create({
      data: {
        organizationId: org2.id,
        email: "intruder@org2.sa",
        name: "Intruder",
        passwordHash: await hashPassword("secret12345"),
        role: "OWNER",
      },
    });
    const intruder = await login("intruder@org2.sa");

    const res = await (await app()).inject({
      method: "GET",
      url: `/assets/${assetId}`,
      headers: { cookie: intruder },
    });
    expect(res.statusCode).toBe(404);

    const list = await (await app()).inject({ method: "GET", url: "/assets", headers: { cookie: intruder } });
    expect(list.json()).toHaveLength(0);
  });
});
