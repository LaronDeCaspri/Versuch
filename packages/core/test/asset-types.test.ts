import { describe, expect, it } from "vitest";
import { matchAssetType } from "../src/asset-types.js";

describe("matchAssetType", () => {
  it("matches canonical keys and English labels exactly", () => {
    expect(matchAssetType("fire_pump")).toEqual({ key: "fire_pump", exact: true });
    expect(matchAssetType("Fire Pump")).toEqual({ key: "fire_pump", exact: true });
    expect(matchAssetType("DIESEL GENERATOR")).toEqual({ key: "diesel_generator", exact: true });
  });

  it("matches Arabic labels and aliases", () => {
    expect(matchAssetType("مضخة الحريق")).toEqual({ key: "fire_pump", exact: true });
    expect(matchAssetType("genset")).toEqual({ key: "diesel_generator", exact: true });
    expect(matchAssetType("lift")).toEqual({ key: "elevator", exact: true });
  });

  it("fuzzy-matches near-misses and typos", () => {
    const m = matchAssetType("fire pmp");
    expect(m?.key).toBe("fire_pump");
    expect(m?.exact).toBe(false);
    expect(matchAssetType("generatr")?.key).toBe("diesel_generator");
  });

  it("returns null for unmappable input (never silently drops)", () => {
    expect(matchAssetType("banana milkshake")).toBeNull();
    expect(matchAssetType("")).toBeNull();
  });
});
