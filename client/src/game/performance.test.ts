import { describe, expect, it } from "vitest";
import { selectPerformanceProfile } from "./performance";

describe("selectPerformanceProfile", () => {
  it("reduces render load for low-memory or low-core devices", () => {
    const profile = selectPerformanceProfile({ deviceMemory: 2, hardwareConcurrency: 4, devicePixelRatio: 3 });

    expect(profile.lowPower).toBe(true);
    expect(profile.starCount).toBe(260);
    expect(profile.hardwareScaling).toBe(1.65);
    expect(profile.leechShapeInterval).toBeCloseTo(1 / 30);
  });

  it("keeps a denser scene on capable devices", () => {
    const profile = selectPerformanceProfile({ deviceMemory: 8, hardwareConcurrency: 8, devicePixelRatio: 2 });

    expect(profile.lowPower).toBe(false);
    expect(profile.starCount).toBe(460);
    expect(profile.hardwareScaling).toBe(1.25);
    expect(profile.leechShapeInterval).toBe(0);
  });
});
