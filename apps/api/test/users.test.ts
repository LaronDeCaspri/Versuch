import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, login, prisma, resetDb, seedFixture, type Fixture } from "./helpers.js";

async function createUser(cookie: string, body: Record<string, unknown>) {
  return (await app()).inject({ method: "POST", url: "/users", headers: { cookie }, payload: body });
}

describe("user management (OWNER only)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("forbids non-owners from listing or creating users", async () => {
    await seedFixture();
    const tech = await login("tech@org.sa");
    expect((await (await app()).inject({ method: "GET", url: "/users", headers: { cookie: tech } })).statusCode).toBe(403);
    expect((await createUser(tech, { email: "x@org.sa", name: "X", password: "password1", role: "VIEWER", siteIds: [] })).statusCode).toBe(403);
  });

  it("creates a user, lists it, and rejects a duplicate email", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    const res = await createUser(owner, { email: "mgr@org.sa", name: "Manager", password: "password1", role: "MANAGER", siteIds: [fx.siteAId] });
    expect(res.statusCode).toBe(201);
    expect(res.json().siteIds).toEqual([fx.siteAId]);

    const list = await (await app()).inject({ method: "GET", url: "/users", headers: { cookie: owner } });
    expect(list.json().map((u: { email: string }) => u.email)).toContain("mgr@org.sa");

    const dup = await createUser(owner, { email: "mgr@org.sa", name: "Dup", password: "password1", role: "VIEWER", siteIds: [] });
    expect(dup.statusCode).toBe(409);
  });

  it("rejects a too-short password", async () => {
    await seedFixture();
    const owner = await login("owner@org.sa");
    expect((await createUser(owner, { email: "a@org.sa", name: "A", password: "short", role: "VIEWER", siteIds: [] })).statusCode).toBe(400);
  });

  it("stops an owner from removing their own owner access (last-owner safety)", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    const res = await (await app()).inject({
      method: "PATCH",
      url: `/users/${fx.ownerId}`,
      headers: { cookie: owner },
      payload: { role: "VIEWER" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a created VIEWER can log in and only sees assigned sites", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    await (await app()).inject({
      method: "POST",
      url: "/assets",
      headers: { cookie: owner },
      payload: { siteId: fx.siteBId, tag: "FP-B", name: "Pump", assetType: "fire_pump", criticality: "LIFE_SAFETY" },
    });
    await createUser(owner, { email: "client@org.sa", name: "Client", password: "password1", role: "VIEWER", siteIds: [fx.siteBId] });

    const viewer = await login("client@org.sa", "password1");
    const assets = await (await app()).inject({ method: "GET", url: "/assets", headers: { cookie: viewer } });
    expect(assets.json().map((a: { tag: string }) => a.tag)).toEqual(["FP-B"]);
  });
});

describe("audit log", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  async function seedAssetDuty(cookie: string, fx: Fixture): Promise<string> {
    const res = await (await app()).inject({
      method: "POST",
      url: "/assets",
      headers: { cookie },
      payload: { siteId: fx.siteAId, tag: "FP-1", name: "Pump", assetType: "fire_pump", criticality: "LIFE_SAFETY" },
    });
    return res.json().duties[0].assetDutyId as string;
  }

  it("records access to records and lets an owner read the log", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    const dutyId = await seedAssetDuty(owner, fx);
    await (await app()).inject({ method: "GET", url: `/asset-duties/${dutyId}/records`, headers: { cookie: owner } });

    const audit = await (await app()).inject({ method: "GET", url: "/audit", headers: { cookie: owner } });
    expect(audit.statusCode).toBe(200);
    const entry = audit.json().find((e: { action: string; entityId: string }) => e.action === "VIEW" && e.entityId === dutyId);
    expect(entry).toBeDefined();
    expect(entry.userName).toBe("Owner");
  });

  it("forbids a technician from reading the audit log", async () => {
    await seedFixture();
    const tech = await login("tech@org.sa");
    expect((await (await app()).inject({ method: "GET", url: "/audit", headers: { cookie: tech } })).statusCode).toBe(403);
  });
});
