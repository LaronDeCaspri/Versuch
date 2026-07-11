import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, login, prisma, resetDb, seedFixture } from "./helpers.js";

describe("authentication", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("rejects unauthenticated access to protected routes", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong password", async () => {
    await seedFixture();
    const res = await (await app()).inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "owner@org.sa", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("logs in, resolves identity, and logs out", async () => {
    await seedFixture();
    const cookie = await login("owner@org.sa");
    const me = await (await app()).inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe("OWNER");

    const out = await (await app()).inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(200);
    const after = await (await app()).inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });
});
