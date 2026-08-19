import { describe, expect, it } from "vitest";
import { applyControlCurve } from "./controls";

describe("applyControlCurve", () => {
  it("keeps small inputs inside the dead zone still", () => {
    expect(applyControlCurve(12, 18, 240)).toBe(0);
  });

  it("reaches full speed at the outer control range", () => {
    expect(applyControlCurve(240, 18, 240)).toBe(1);
    expect(applyControlCurve(400, 18, 240)).toBe(1);
  });

  it("uses a softer response through the middle of the range", () => {
    const middle = applyControlCurve(120, 18, 240);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(0.5);
  });
});
