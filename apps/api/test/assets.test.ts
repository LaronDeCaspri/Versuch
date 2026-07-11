import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, login, prisma, resetDb, seedFixture } from "./helpers.js";

async function createPump(cookie: string, siteId: string, tag: string, commissionedOn: string | null) {
  return (await app()).inject({
    method: "POST",
    url: "/assets",
    headers: { cookie },
    payload: {
      siteId,
      tag,
      name: "Fire pump",
      assetType: "fire_pump",
      criticality: "LIFE_SAFETY",
      ...(commissionedOn ? { commissionedOn } : {}),
    },
  });
}

describe("asset register", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates an asset and instantiates its matching statutory duties with derived status", async () => {
    const fx = await seedFixture();
    const cookie = await login("owner@org.sa");
    const res = await createPump(cookie, fx.siteAId, "FP-1", "2019-01-01");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.duties).toHaveLength(1);
    expect(body.duties[0].isStatutory).toBe(true);
    // Commissioned 2019, never inspected → NEVER_DONE.
    expect(body.duties[0].status).toBe("NEVER_DONE");
  });

  it("rejects a duplicate tag within the same site", async () => {
    const fx = await seedFixture();
    const cookie = await login("owner@org.sa");
    await createPump(cookie, fx.siteAId, "FP-1", null);
    const dup = await createPump(cookie, fx.siteAId, "FP-1", null);
    expect(dup.statusCode).toBe(409);
  });

  it("allows the same tag on different sites", async () => {
    const fx = await seedFixture();
    const cookie = await login("owner@org.sa");
    expect((await createPump(cookie, fx.siteAId, "FP-1", null)).statusCode).toBe(201);
    expect((await createPump(cookie, fx.siteBId, "FP-1", null)).statusCode).toBe(201);
  });

  it("forbids a TECHNICIAN from creating assets", async () => {
    const fx = await seedFixture();
    const cookie = await login("tech@org.sa");
    const res = await createPump(cookie, fx.siteAId, "FP-1", null);
    expect(res.statusCode).toBe(403);
  });

  it("scopes the dashboard to sites the technician can access", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    await createPump(owner, fx.siteAId, "FP-A", "2019-01-01");
    await createPump(owner, fx.siteBId, "FP-B", "2019-01-01");

    const tech = await login("tech@org.sa");
    const res = await (await app()).inject({ method: "GET", url: "/assets", headers: { cookie: tech } });
    const tags = res.json().map((a: { tag: string }) => a.tag);
    expect(tags).toEqual(["FP-A"]); // technician only sees Site A
  });

  it("filters the dashboard by criticality", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    await createPump(owner, fx.siteAId, "FP-A", null);
    const res = await (await app()).inject({
      method: "GET",
      url: "/assets?criticality=NON_CRITICAL",
      headers: { cookie: owner },
    });
    expect(res.json()).toHaveLength(0);
  });
});
