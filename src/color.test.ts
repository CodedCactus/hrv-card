import { describe, it, expect } from "vitest";
import {
  COLOR_STOPS,
  lerp,
  clamp,
  tempToColor,
  buildGradientTemps,
} from "./color";

describe("lerp", () => {
  it("interpolates between two values", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it("extrapolates outside [0,1]", () => {
    expect(lerp(0, 10, 1.5)).toBe(15);
    expect(lerp(0, 10, -0.5)).toBe(-5);
  });
});

describe("clamp", () => {
  it("clamps to the default [0,1] range", () => {
    expect(clamp(0.5)).toBe(0.5);
    expect(clamp(-1)).toBe(0);
    expect(clamp(2)).toBe(1);
  });

  it("respects a custom range", () => {
    expect(clamp(5, 0, 100)).toBe(5);
    expect(clamp(-3, 0, 100)).toBe(0);
    expect(clamp(200, 0, 100)).toBe(100);
  });
});

describe("tempToColor", () => {
  it("returns the first stop colour at t=0", () => {
    expect(tempToColor(0)).toBe(
      `rgb(${COLOR_STOPS[0][0]},${COLOR_STOPS[0][1]},${COLOR_STOPS[0][2]})`
    );
  });

  it("returns the last stop colour at t=1", () => {
    expect(tempToColor(1)).toBe(
      `rgb(${COLOR_STOPS[COLOR_STOPS.length - 1][0]},${
        COLOR_STOPS[COLOR_STOPS.length - 1][1]
      },${COLOR_STOPS[COLOR_STOPS.length - 1][2]})`
    );
  });

  it("clamps out-of-range inputs", () => {
    expect(tempToColor(-5)).toBe(tempToColor(0));
    expect(tempToColor(5)).toBe(tempToColor(1));
  });

  it("produces a valid rgb() string", () => {
    expect(tempToColor(0.5)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
});

describe("buildGradientTemps", () => {
  it("returns start and end at the extremes", () => {
    const [first, , , last] = buildGradientTemps(10, 30);
    expect(first).toBe(10);
    expect(last).toBe(30);
  });

  it("interpolates the middle stops", () => {
    const [, second, third,] = buildGradientTemps(0, 30);
    expect(second).toBeCloseTo(9.9, 5);
    expect(third).toBeCloseTo(19.8, 5);
  });

  it("handles equal start/end (flat gradient)", () => {
    const temps = buildGradientTemps(20, 20);
    expect(temps).toEqual([20, 20, 20, 20]);
  });

  it("handles descending spans", () => {
    const [first, , , last] = buildGradientTemps(30, 10);
    expect(first).toBe(30);
    expect(last).toBe(10);
  });
});