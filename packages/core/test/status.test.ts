import { describe, expect, it } from "vitest";
import { asIsoDate, type IsoDate } from "../src/dates.js";
import { computeDerived, effectiveRecords, type RecordRef } from "../src/status.js";

const d = asIsoDate;
const TODAY = d("2026-07-11");

function rec(id: string, performedOn: string, supersedesId: string | null = null): RecordRef {
  return { id, performedOn: asIsoDate(performedOn), supersedesId };
}

interface Case {
  commissionedOn: IsoDate | null;
  intervalDays: number;
  graceDays: number;
  records: RecordRef[];
}

function derive(overrides: Partial<Case>) {
  return computeDerived({
    today: TODAY,
    commissionedOn: d("2020-01-01"),
    intervalDays: 365,
    graceDays: 30,
    records: [],
    ...overrides,
  });
}

describe("effectiveRecords", () => {
  it("drops any record that another record supersedes", () => {
    const wrong = rec("a", "2026-01-01");
    const fix = rec("b", "2026-02-01", "a");
    expect(effectiveRecords([wrong, fix]).map((r) => r.id)).toEqual(["b"]);
  });
  it("handles a chain of corrections", () => {
    const r1 = rec("a", "2026-01-01");
    const r2 = rec("b", "2026-02-01", "a");
    const r3 = rec("c", "2026-03-01", "b");
    expect(effectiveRecords([r1, r2, r3]).map((r) => r.id)).toEqual(["c"]);
  });
});

describe("NEVER_DONE — its own category, never OVERDUE", () => {
  it("no records and first interval has lapsed", () => {
    const r = derive({ commissionedOn: d("2020-01-01"), intervalDays: 365, records: [] });
    expect(r.status).toBe("NEVER_DONE");
    expect(r.lastCompletedOn).toBeNull();
    expect(r.nextDueOn).toBe("2020-12-31"); // 2020 is a leap year (366 days).
  });
  it("no records and no commissioning date is still NEVER_DONE", () => {
    const r = derive({ commissionedOn: null, records: [] });
    expect(r.status).toBe("NEVER_DONE");
    expect(r.nextDueOn).toBeNull();
  });
  it("is NEVER_DONE even when within grace of the first due date", () => {
    // First due 2026-07-01, today 2026-07-11: 10 days past, inside 30-day grace,
    // yet with no record it must not read as DUE/OVERDUE.
    const r = derive({ commissionedOn: d("2025-07-01"), intervalDays: 365, graceDays: 30, records: [] });
    expect(r.status).toBe("NEVER_DONE");
  });
});

describe("first cycle, not yet inspected", () => {
  it("is OK when the first due date is far in the future", () => {
    const r = derive({ commissionedOn: d("2026-06-01"), intervalDays: 365, records: [] });
    expect(r.status).toBe("OK");
    expect(r.nextDueOn).toBe("2027-06-01");
  });
  it("is DUE when the first due date is within 30 days", () => {
    const r = derive({ commissionedOn: d("2025-08-01"), intervalDays: 365, records: [] });
    expect(r.nextDueOn).toBe("2026-08-01"); // 21 days out
    expect(r.status).toBe("DUE");
  });
});

describe("status window from last completion", () => {
  it("OK when next due is beyond the 30-day horizon", () => {
    const r = derive({ intervalDays: 365, records: [rec("x", "2026-06-01")] });
    expect(r.nextDueOn).toBe("2027-06-01");
    expect(r.status).toBe("OK");
  });
  it("DUE exactly at the +30 day boundary", () => {
    // next due = today + 30 → DUE (inclusive).
    const r = derive({ intervalDays: 30, records: [rec("x", "2026-07-11")] });
    expect(r.nextDueOn).toBe("2026-08-10");
    expect(r.status).toBe("DUE");
  });
  it("OK at +31 days (just outside the horizon)", () => {
    const r = derive({ intervalDays: 31, records: [rec("x", "2026-07-11")] });
    expect(r.nextDueOn).toBe("2026-08-11");
    expect(r.status).toBe("OK");
  });
  it("DUE when past due but still within grace", () => {
    // next due 2026-07-01, today 2026-07-11 → 10 days late, grace 30 → DUE.
    const r = derive({ intervalDays: 365, graceDays: 30, records: [rec("x", "2025-07-01")] });
    expect(r.nextDueOn).toBe("2026-07-01");
    expect(r.status).toBe("DUE");
  });
  it("DUE exactly at the grace edge (delta === -graceDays)", () => {
    // next due = today - 30, grace 30 → still DUE, not yet OVERDUE.
    const r = derive({ intervalDays: 335, graceDays: 30, records: [rec("x", "2025-07-11")] });
    expect(r.nextDueOn).toBe("2026-06-11");
    expect(r.status).toBe("DUE");
  });
  it("OVERDUE one day past the grace edge", () => {
    // next due = today - 31, grace 30 → OVERDUE.
    const r = derive({ intervalDays: 334, graceDays: 30, records: [rec("x", "2025-07-11")] });
    expect(r.nextDueOn).toBe("2026-06-10");
    expect(r.status).toBe("OVERDUE");
  });
  it("OVERDUE with zero grace the day after due", () => {
    const r = derive({ intervalDays: 30, graceDays: 0, records: [rec("x", "2026-06-10")] });
    expect(r.nextDueOn).toBe("2026-07-10"); // yesterday
    expect(r.status).toBe("OVERDUE");
  });
});

describe("derivation uses only effective records", () => {
  it("ignores a superseded record when computing last completion", () => {
    const r = derive({
      intervalDays: 365,
      records: [rec("wrong", "2026-06-01"), rec("fix", "2025-01-01", "wrong")],
    });
    expect(r.lastCompletedOn).toBe("2025-01-01");
    expect(r.nextDueOn).toBe("2026-01-01");
  });
  it("any result counts as performed (last completion is the latest date)", () => {
    const r = derive({ intervalDays: 365, records: [rec("a", "2025-01-01"), rec("b", "2026-05-01")] });
    expect(r.lastCompletedOn).toBe("2026-05-01");
  });
});
