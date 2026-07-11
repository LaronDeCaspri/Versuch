import { describe, expect, it } from "vitest";
import { addDays, asIsoDate, diffDays, isIsoDate, maxDate, todayInRiyadh, toHijri } from "../src/dates.js";

const d = asIsoDate;

describe("isIsoDate", () => {
  it("accepts valid calendar dates", () => {
    expect(isIsoDate("2026-07-11")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });
  it("rejects malformed and rolled-over dates", () => {
    expect(isIsoDate("2026-7-1")).toBe(false);
    expect(isIsoDate("2024-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("nope")).toBe(false);
  });
});

describe("todayInRiyadh", () => {
  it("uses the Riyadh calendar day, not UTC", () => {
    // 2026-07-11 22:30 UTC is already 2026-07-12 in Riyadh (UTC+3).
    expect(todayInRiyadh(new Date("2026-07-11T22:30:00Z"))).toBe("2026-07-12");
    // 2026-07-11 20:00 UTC is 2026-07-11 23:00 Riyadh — still the 11th.
    expect(todayInRiyadh(new Date("2026-07-11T20:00:00Z"))).toBe("2026-07-11");
  });
});

describe("addDays / diffDays", () => {
  it("adds across month and year boundaries", () => {
    expect(addDays(d("2026-01-31"), 1)).toBe("2026-02-01");
    expect(addDays(d("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(d("2026-03-01"), -1)).toBe("2026-02-28");
  });
  it("computes signed differences", () => {
    expect(diffDays(d("2026-07-11"), d("2026-07-01"))).toBe(10);
    expect(diffDays(d("2026-07-01"), d("2026-07-11"))).toBe(-10);
    expect(diffDays(d("2026-07-11"), d("2026-07-11"))).toBe(0);
  });
});

describe("maxDate", () => {
  it("returns the latest date or null", () => {
    expect(maxDate([d("2026-01-01"), d("2026-05-09"), d("2026-03-03")])).toBe("2026-05-09");
    expect(maxDate([])).toBeNull();
  });
});

describe("toHijri", () => {
  it("renders an Um al-Qura date string", () => {
    const s = toHijri(d("2026-07-11"), "en");
    expect(s).toMatch(/1448/); // 2026-07-11 falls in Hijri year 1448.
  });
});
