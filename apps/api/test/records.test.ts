import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, login, prisma, resetDb, seedFixture, type Fixture } from "./helpers.js";

async function createDuty(cookie: string, fx: Fixture): Promise<string> {
  const res = await (await app()).inject({
    method: "POST",
    url: "/assets",
    headers: { cookie },
    payload: { siteId: fx.siteAId, tag: "FP-1", name: "Pump", assetType: "fire_pump", criticality: "LIFE_SAFETY" },
  });
  return res.json().duties[0].assetDutyId as string;
}

function record(overrides: Record<string, unknown> = {}) {
  return { performedOn: "2026-06-01", performedBy: "Inspector", result: "PASS", ...overrides };
}

describe("record capture", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("submits an immutable record and lists it", async () => {
    const fx = await seedFixture();
    const cookie = await login("owner@org.sa");
    const dutyId = await createDuty(cookie, fx);
    const res = await (await app()).inject({
      method: "POST",
      url: `/asset-duties/${dutyId}/records`,
      headers: { cookie },
      payload: record(),
    });
    expect(res.statusCode).toBe(201);
    const list = await (await app()).inject({ method: "GET", url: `/asset-duties/${dutyId}/records`, headers: { cookie } });
    expect(list.json()).toHaveLength(1);
  });

  it("rejects a malformed performedOn date with 400 (not 500)", async () => {
    const fx = await seedFixture();
    const cookie = await login("owner@org.sa");
    const dutyId = await createDuty(cookie, fx);
    const res = await (await app()).inject({
      method: "POST",
      url: `/asset-duties/${dutyId}/records`,
      headers: { cookie },
      payload: record({ performedOn: "2026-13-40" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not leak another site's defects (site-scoped)", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    // Asset + failing record (raises a defect) on Site B.
    const created = await (await app()).inject({
      method: "POST",
      url: "/assets",
      headers: { cookie: owner },
      payload: { siteId: fx.siteBId, tag: "FP-B", name: "Pump", assetType: "fire_pump", criticality: "LIFE_SAFETY" },
    });
    const dutyId = created.json().duties[0].assetDutyId as string;
    await (await app()).inject({
      method: "POST",
      url: `/asset-duties/${dutyId}/records`,
      headers: { cookie: owner },
      payload: record({ result: "FAIL", findings: "leak" }),
    });

    // Technician is assigned to Site A only.
    const tech = await login("tech@org.sa");
    const res = await (await app()).inject({ method: "GET", url: `/asset-duties/${dutyId}/defects`, headers: { cookie: tech } });
    expect(res.json()).toHaveLength(0);
  });

  it("rejects a future performedOn date", async () => {
    const fx = await seedFixture();
    const cookie = await login("owner@org.sa");
    const dutyId = await createDuty(cookie, fx);
    const res = await (await app()).inject({
      method: "POST",
      url: `/asset-duties/${dutyId}/records`,
      headers: { cookie },
      payload: record({ performedOn: "2099-01-01" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("corrects a record by superseding and refuses a second supersede", async () => {
    const fx = await seedFixture();
    const cookie = await login("owner@org.sa");
    const dutyId = await createDuty(cookie, fx);
    const first = await (await app()).inject({
      method: "POST",
      url: `/asset-duties/${dutyId}/records`,
      headers: { cookie },
      payload: record(),
    });
    const id = first.json().id as string;

    const sup = await (await app()).inject({
      method: "POST",
      url: `/records/${id}/supersede`,
      headers: { cookie },
      payload: record({ performedOn: "2026-06-02", correctionReason: "wrong date" }),
    });
    expect(sup.statusCode).toBe(201);

    const again = await (await app()).inject({
      method: "POST",
      url: `/records/${id}/supersede`,
      headers: { cookie },
      payload: record({ performedOn: "2026-06-03", correctionReason: "again" }),
    });
    expect(again.statusCode).toBe(409);

    const list = await (await app()).inject({ method: "GET", url: `/asset-duties/${dutyId}/records`, headers: { cookie } });
    expect(list.json()).toHaveLength(2); // both survive
  });

  it("raises a defect on FAIL and closes it on a later PASS", async () => {
    const fx = await seedFixture();
    const cookie = await login("owner@org.sa");
    const dutyId = await createDuty(cookie, fx);

    await (await app()).inject({
      method: "POST",
      url: `/asset-duties/${dutyId}/records`,
      headers: { cookie },
      payload: record({ result: "FAIL", findings: "pump seized" }),
    });
    let defects = await (await app()).inject({ method: "GET", url: `/asset-duties/${dutyId}/defects`, headers: { cookie } });
    expect(defects.json()).toHaveLength(1);
    expect(defects.json()[0].status).toBe("OPEN");
    expect(defects.json()[0].severity).toBe("CRITICAL"); // LIFE_SAFETY + FAIL

    await (await app()).inject({
      method: "POST",
      url: `/asset-duties/${dutyId}/records`,
      headers: { cookie },
      payload: record({ performedOn: "2026-06-15", result: "PASS" }),
    });
    defects = await (await app()).inject({ method: "GET", url: `/asset-duties/${dutyId}/defects`, headers: { cookie } });
    expect(defects.json()[0].status).toBe("CLOSED");
    expect(defects.json()[0].closedByRecordId).not.toBeNull();
  });

  it("lets a TECHNICIAN submit but not supersede", async () => {
    const fx = await seedFixture();
    const owner = await login("owner@org.sa");
    const dutyId = await createDuty(owner, fx);
    const tech = await login("tech@org.sa");

    const submit = await (await app()).inject({
      method: "POST",
      url: `/asset-duties/${dutyId}/records`,
      headers: { cookie: tech },
      payload: record(),
    });
    expect(submit.statusCode).toBe(201);
    const id = submit.json().id as string;

    const sup = await (await app()).inject({
      method: "POST",
      url: `/records/${id}/supersede`,
      headers: { cookie: tech },
      payload: record({ correctionReason: "x" }),
    });
    expect(sup.statusCode).toBe(403);
  });
});
