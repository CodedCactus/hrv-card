import { buildGradientTemps, tempToColor } from "./color";
import type { FlowTemps } from "./types";

const GRADIENT_IDS = {
  path1: "gradientPath1",
  path2: "gradientPath2",
} as const;

/** Holds direct references to the 4 stop elements inside each gradient. */
export interface GradientStops {
  path1: SVGStopElement[];
  path2: SVGStopElement[];
}

interface FlowGradient {
  path1Temps: [number, number, number, number];
  path2Temps: [number, number, number, number];
  normalise: (t: number) => number;
}

export function queryGradientStops(svg: SVGSVGElement): GradientStops {
  const stopsOf = (id: string): SVGStopElement[] =>
    Array.from(svg.querySelectorAll<SVGStopElement>(`#${id} stop`));
  return {
    path1: stopsOf(GRADIENT_IDS.path1),
    path2: stopsOf(GRADIENT_IDS.path2),
  };
}

/**
 * Update the stop colours for one gradient by mutating only `stop-color`
 * attributes on the already-live stop elements. No innerHTML, no queries.
 */
function applyGradientToStops(
  stops: SVGStopElement[],
  temps: number[],
  normalise: (t: number) => number
): void {
  if (stops.length !== temps.length) {
    throw new Error(
      `Gradient stop/temperature count mismatch: ${stops.length} stops vs ${temps.length} temps.`
    );
  }
  for (let i = 0; i < stops.length; i++) {
    stops[i].setAttribute("stop-color", tempToColor(normalise(temps[i])));
  }
}

/**
 * Derive the per-path gradient stop temperatures and a shared normaliser
 * (0–1 across the combined min/max of all stops) from flow temperatures.
 */
function buildFlowGradient(temps: FlowTemps): FlowGradient {
  const path1Temps = buildGradientTemps(temps.outdoor, temps.supply);
  // Path 2 runs right-to-left (extract→exhaust), so args are swapped.
  const path2Temps = buildGradientTemps(temps.exhaust, temps.extract);

  const allTemps = [...path1Temps, ...path2Temps];
  const minTemp = Math.min(...allTemps);
  const maxTemp = Math.max(...allTemps);
  const range = maxTemp - minTemp || 1;

  return {
    path1Temps,
    path2Temps,
    normalise: (t) => (t - minTemp) / range,
  };
}

/** Apply the current flow temperatures to both SVG gradients. */
export function updateGradients(
  stops: GradientStops,
  temps: FlowTemps
): void {
  const { path1Temps, path2Temps, normalise } = buildFlowGradient(temps);
  applyGradientToStops(stops.path1, path1Temps, normalise);
  applyGradientToStops(stops.path2, path2Temps, normalise);
}
