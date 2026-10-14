// ─────────────────────────────────────────────
// Pure colour utilities
// ─────────────────────────────────────────────

/** Cool-to-warm colour ramp (blue → light blue → orange → red). */
export const COLOR_STOPS: [number, number, number][] = [
  [59, 76, 192],
  [120, 180, 220],
  [245, 160, 105],
  [180, 4, 38],
];

export type RGB = [number, number, number];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(lerp(a, b, t));
}

/**
 * Map a normalised value (0–1, clamped) to an RGB colour string by interpolating
 * along the cool-to-warm ramp.
 */
export function tempToColor(normalised: number): string {
  const t = clamp(normalised);
  const segments = COLOR_STOPS.length - 1;
  const scaled = t * segments;
  const i = Math.floor(scaled);
  const f = scaled - i;

  const a = COLOR_STOPS[i];
  const b = COLOR_STOPS[Math.min(i + 1, segments)];

  return `rgb(${lerpChannel(a[0], b[0], f)},${lerpChannel(a[1], b[1], f)},${lerpChannel(a[2], b[2], f)})`;
}

/**
 * Build the 4 stop temperatures for a gradient between `start` and `end`.
 * Stops sit at 0%, 33%, 66%, 100% of the span.
 */
export function buildGradientTemps(
  start: number,
  end: number
): [number, number, number, number] {
  return [start, lerp(start, end, 0.33), lerp(start, end, 0.66), end];
}