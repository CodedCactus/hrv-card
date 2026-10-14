import { type TemplateResult, LitElement, html, css, type PropertyValues } from "lit";
import hrvSvg from "./assets/card.svg?raw";
import { tempToColor, buildGradientTemps } from "./color";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface HomeAssistantState {
  state: string;
  attributes?: Record<string, unknown>;
}

interface HomeAssistant {
  states: Record<string, HomeAssistantState | undefined>;
}

export interface HRVCardConfig {
  title?: string;
  outdoor_temp: string;
  supply_temp: string;
  extract_temp: string;
  exhaust_temp: string;
  sensors?: SensorConfig[];
  animation?: boolean; // enable/disable flow animation (default: true)
}

interface SensorConfig {
  entity: string;
  label?: string;
  format?: "binary" | "text" | "number";
  unit?: string;
  decimals?: number;
}

interface SensorDisplayInfo {
  display: string;
  unit: string;
  isBinary: boolean;
  isOn: boolean;
  isHeat: boolean;
}

/** The four flow temperatures read from hass. */
interface FlowTemps {
  outdoor: number;
  supply: number;
  extract: number;
  exhaust: number;
}

/** Gradient stop temperatures plus a shared 0–1 normaliser. */
interface FlowGradient {
  path1Temps: [number, number, number, number];
  path2Temps: [number, number, number, number];
  normalise: (t: number) => number;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const REQUIRED_CONFIG_KEYS = [
  "outdoor_temp",
  "supply_temp",
  "extract_temp",
  "exhaust_temp",
] as const satisfies ReadonlyArray<keyof HRVCardConfig>;

const GRADIENT_IDS = {
  path1: "gradientPath1",
  path2: "gradientPath2",
} as const;

// ─────────────────────────────────────────────
// Module-level SVG cache
// ─────────────────────────────────────────────

/**
 * Parse the SVG string once at module load and cache the resulting element.
 * Every card instance clones this node rather than re-parsing the string.
 */
const _svgTemplate = ((): SVGSVGElement => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(hrvSvg, "image/svg+xml");
  return doc.querySelector("svg") as SVGSVGElement;
})();

// ─────────────────────────────────────────────
// Gradient stop references (per card instance)
// ─────────────────────────────────────────────

/** Holds direct references to the 4 stop elements inside each gradient. */
interface GradientStops {
  path1: SVGStopElement[];
  path2: SVGStopElement[];
}

/** Particle flowing along a path. */
interface Particle {
  progress: number;      // 0–1 along path
  speed: number;         // progress per frame
  size: number;          // particle radius
  pathIndex: 0 | 1;      // which path (0=path1, 1=path2)
  offset: number;        // perpendicular offset from path center (-1 to 1)
  trail: TrailPoint[];   // fading trail positions
}

/** A single point in the particle's trail. */
interface TrailPoint {
  progress: number;  // progress along path
  offset: number;    // perpendicular offset
  time: number;      // performance.now() when the point was recorded
}

function queryGradientStops(svg: SVGSVGElement): GradientStops {
  const stopsOf = (id: string): SVGStopElement[] =>
    Array.from(svg.querySelectorAll<SVGStopElement>(`#${id} stop`));
  return {
    path1: stopsOf(GRADIENT_IDS.path1),
    path2: stopsOf(GRADIENT_IDS.path2),
  };
}

/**
 * Update the stop colours for one gradient by mutating only `stop-color`
 * attributes on the already-live stop elements.  No innerHTML, no queries.
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

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

class HRVCard extends LitElement {
  static get properties() {
    return {
      _hass: { type: Object, state: true },
      config: { type: Object },
    };
  }

  private _hass?: HomeAssistant;
  config?: HRVCardConfig;

  /** Cloned SVG element; owns the flow paths, gradient stops, and canvas. */
  private _svg?: SVGSVGElement;

/** Cached references to the live <stop> elements inside this card's SVG. */
  private _gradientStops?: GradientStops;

  /** Cached SVG path elements for particle animation. */
  private _flowPaths?: [SVGPathElement, SVGPathElement];

  /** Precomputed path points for fast interpolation. */
  private _pathPoints: { points: { x: number; y: number; tx: number; ty: number }[]; length: number }[] = [];

  /** Canvas for particle rendering. */
  private _canvas?: HTMLCanvasElement;
  private _canvasCtx?: CanvasRenderingContext2D;

  /** Mask path for canvas clipping (from SVG mask - crossing region). */
  private _maskPath?: Path2D;

  /** Particle animation state. */
  private _particles: Particle[] = [];
  private _animationFrame?: number;
  private _lastFrameTime = 0;
  private _pathLengths: [number, number] = [0, 0];

  /**
   * All tracked entity IDs. Hass updates that change none of these (nor any
   * sensor chip's unit/device-class attribute) are filtered out in
   * shouldUpdate. Computed once in setConfig.
   */
  private _trackedEntities: string[] = [];

  /** True when the latest hass assignment changed data the card displays. */
  private _trackedStateChanged = true;

  // ── hass accessor ──────────────────────────

  set hass(value: HomeAssistant) {
    const previous = this._hass;
    this._hass = value;

    // The reactive assignment schedules an update; shouldUpdate decides whether
    // it renders. The first assignment always renders so the card shows its
    // initial state (including "—" for not-yet-available entities).
    if (previous === undefined) {
      this._trackedStateChanged = true;
      return;
    }

    // OR-accumulate: several hass assignments can land between two update
    // cycles, and once any tracked change arrives the next cycle must render.
    this._trackedStateChanged ||= this._hasTrackedDataChanged(previous, value);
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  /**
   * True when the previous → current hass transition changed any data the card
   * displays: a tracked entity's state, or a sensor chip's unit/device class.
   */
  private _hasTrackedDataChanged(
    previous: HomeAssistant,
    current: HomeAssistant
  ): boolean {
    return this._trackedEntities.some((entity) => {
      const prevState = previous.states[entity];
      const currState = current.states[entity];
      if (prevState?.state !== currState?.state) return true;
      return (
        prevState?.attributes?.unit_of_measurement !==
          currState?.attributes?.unit_of_measurement ||
        prevState?.attributes?.device_class !== currState?.attributes?.device_class
      );
    });
  }

  // ── config ─────────────────────────────────

  setConfig(config: HRVCardConfig): void {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid card configuration.");
    }

    for (const key of REQUIRED_CONFIG_KEYS) {
      const value = config[key];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(
          `HRV Card is missing required field: "${key}". Required fields: ${REQUIRED_CONFIG_KEYS.join(", ")}.`
        );
      }
    }

    if (config.sensors !== undefined && !Array.isArray(config.sensors)) {
      throw new Error('HRV Card "sensors" must be a list.');
    }

    for (const [index, sensor] of (config.sensors ?? []).entries()) {
      const entity = (sensor as { entity?: unknown } | null)?.entity;
      if (typeof entity !== "string" || entity.trim() === "") {
        throw new Error(
          `HRV Card sensor at index ${index} is missing a valid "entity".`
        );
      }
    }

    this.config = { ...config };

    // Cache tracked entities so the hass setter never allocates on each call.
    this._trackedEntities = [
      config.outdoor_temp,
      config.supply_temp,
      config.extract_temp,
      config.exhaust_temp,
      ...(config.sensors?.map((s) => s.entity) ?? []),
    ];
  }

  /** Approximate rendered row count; used by HA's card-size layout system. */
  getCardSize(): number {
    // Header (1) + SVG/overlay block (1) + sensor row (1 when configured).
    return 2 + (this.config?.sensors?.length ? 1 : 0);
  }

  // ── state helpers ──────────────────────────

  /**
   * Read an entity's state as a number.
   * Returns `null` when the entity is missing or its state is not numeric,
   * so callers can distinguish "unavailable" from a genuine `0`.
   */
  private getNumericState(entity: string): number | null {
    const raw = this._hass?.states?.[entity]?.state;
    if (raw === undefined || raw === null) return null;
    const num = Number(raw);
    return Number.isNaN(num) ? null : num;
  }

  private getEntityAttribute<T>(entity: string, attribute: string): T | undefined {
    return this._hass?.states?.[entity]?.attributes?.[attribute] as T | undefined;
  }

  // ── sensor display ─────────────────────────

  private getSensorDisplayInfo(sensor: SensorConfig): SensorDisplayInfo {
    const state = this._hass?.states?.[sensor.entity]?.state ?? "—";
    const unit =
      sensor.unit ??
      this.getEntityAttribute<string>(sensor.entity, "unit_of_measurement") ??
      "";
    const deviceClass = this.getEntityAttribute<string>(sensor.entity, "device_class");

    const isBinary =
      sensor.format === "binary" || state === "on" || state === "off";
    const isOpening = deviceClass === "opening";
    const isHeat = deviceClass === "heat";
    const isOn = state === "on";

    let display: string;
    if (isBinary) {
      display = isOn
        ? (isOpening ? "Open"   : "On")
        : (isOpening ? "Closed" : "Off");
    } else if (sensor.format === "number") {
      const num = Number(state);
      const decimals = sensor.decimals ?? 1;
      display = Number.isNaN(num) ? state : num.toFixed(decimals);
    } else {
      const num = Number(state);
      display = Number.isNaN(num) ? state : num.toFixed(1);
    }

    return { display, unit, isBinary, isOn, isHeat };
  }

  // ── event dispatch ─────────────────────────

  private handleMoreInfo(entity: string): void {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: entity },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ── lifecycle ──────────────────────────────

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    // Only re-render when the config changed or a tracked entity's displayed
    // data actually changed. HA replaces the whole hass object on every state
    // change anywhere in the instance, so without this gate the card would
    // re-render on unrelated updates.
    if (changedProps.has("config")) return true;
    if (changedProps.has("_hass")) return this._trackedStateChanged;
    return true;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // The shadow DOM (SVG, paths, stops) survives a disconnect, but
    // disconnectedCallback tears the canvas down; rebuild it when re-attached.
    this._ensureCanvas();
    this._syncAnimationState();
  }

  /**
   * Create the canvas (inside an SVG <foreignObject>) if it is missing or was
   * detached by disconnectedCallback. Idempotent — safe to call from both
   * firstUpdated and connectedCallback.
   */
  private _ensureCanvas(): void {
    if (this._canvas?.parentNode) return; // already wired into the SVG
    if (!this._svg) return;

    // Drop any stale wrapper left behind by a previous cycle (defensive).
    this._svg.querySelector("foreignObject")?.remove();

    const wrapper = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "foreignObject"
    );
    wrapper.setAttribute("width", "100%");
    wrapper.setAttribute("height", "100%");
    wrapper.setAttribute("x", "0");
    wrapper.setAttribute("y", "0");
    wrapper.setAttribute("pointer-events", "none");

    const htmlCanvas = document.createElement("canvas");
    htmlCanvas.style.width = "100%";
    htmlCanvas.style.height = "100%";
    htmlCanvas.style.display = "block";
    wrapper.appendChild(htmlCanvas);

    this._svg.appendChild(wrapper);
    this._canvas = htmlCanvas;
    this._canvasCtx = htmlCanvas.getContext("2d")!;
  }

  protected firstUpdated(): void {
    // Clone the module-level parsed SVG and insert it once, imperatively.
    // Lit will never touch this node again.
    const svgClone = _svgTemplate.cloneNode(true) as SVGSVGElement;
    const container = this.renderRoot.querySelector<HTMLElement>(".svg-container");
    container?.appendChild(svgClone);
    this._svg = svgClone;

    // Cache the stop elements directly so future updates are O(1) attribute sets.
    this._gradientStops = queryGradientStops(svgClone);

    // Cache the flow path elements for particle animation.
    const path1 = svgClone.querySelector<SVGPathElement>("#path10");
    const path2 = svgClone.querySelector<SVGPathElement>("#path11");
    if (path1 && path2) {
      this._flowPaths = [path1, path2];
      this._pathLengths = [path1.getTotalLength(), path2.getTotalLength()];

      // Precompute path points for fast interpolation.
      const SAMPLE_COUNT = 100;
      for (let i = 0; i < 2; i++) {
        const path = this._flowPaths[i];
        const length = this._pathLengths[i];
        const points: { x: number; y: number; tx: number; ty: number }[] = [];
        for (let j = 0; j <= SAMPLE_COUNT; j++) {
          const progress = j / SAMPLE_COUNT;
          const len = progress * length;
          const pt = path.getPointAtLength(len);
          const nextLen = Math.min(len + 1, length);
          const nextPt = path.getPointAtLength(nextLen);
          const dx = nextPt.x - pt.x;
          const dy = nextPt.y - pt.y;
          const tangentLen = Math.hypot(dx, dy) || 1;
          points.push({ x: pt.x, y: pt.y, tx: dx / tangentLen, ty: dy / tangentLen });
        }
        this._pathPoints.push({ points, length });
      }

      // Create canvas inside SVG (as sibling to paths) for perfect alignment.
      this._ensureCanvas();

      // The crossing region is the black cutout path inside <mask id="curveMask">
      // (path 1 goes under path 2 there). Parse its `d` from the SVG so the two
      // definitions cannot drift apart; if it is missing, particles are simply
      // not clipped rather than the card failing.
      const maskPathData = svgClone
        .querySelector<SVGPathElement>('#curveMask path[fill="#000000"]')
        ?.getAttribute("d");
      if (maskPathData) this._maskPath = new Path2D(maskPathData);

      this._syncAnimationState();
    }

    // Apply initial gradient colours if hass data is already available.
    if (this._hass) this.updateSvgGradients();
  }

  protected updated(changedProps: Map<string, unknown>): void {
    // Consumed: the update that shouldUpdate let through is now complete.
    this._trackedStateChanged = false;

    if (changedProps.has("_hass")) {
      this.updateSvgGradients();
    }
    // React to data *and* config changes, so toggling `animation` in the card
    // editor takes effect immediately without waiting for a state update.
    if (changedProps.has("_hass") || changedProps.has("config")) {
      this._syncAnimationState();
    }
  }

  /** Start or stop the flow animation to match the current config and data. */
  private _syncAnimationState(): void {
    const canAnimate =
      this.config?.animation !== false &&
      !!this._hass &&
      !!this._flowPaths &&
      !!this._canvas;

    if (canAnimate && !this._animationFrame) {
      this.startParticleAnimation();
    } else if (!canAnimate && this._animationFrame) {
      this.stopParticleAnimation();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopParticleAnimation();
    // Remove the whole <foreignObject> wrapper; the rest of the shadow DOM
    // (SVG, paths, gradient stops) is preserved and reused on reconnect.
    this._svg?.querySelector("foreignObject")?.remove();
    this._canvas = undefined;
    this._canvasCtx = undefined;
  }

  // ── Particle animation ────────────────────────

  private startParticleAnimation(): void {
    if (this._animationFrame) return;
    this._lastFrameTime = performance.now();
    this.animateParticles();
  }

  private stopParticleAnimation(): void {
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = undefined;
      this._particles = [];
    }
    this._clearCanvas();
  }

  /** Wipe the canvas backing store regardless of the current transform. */
  private _clearCanvas(): void {
    const { _canvas, _canvasCtx } = this;
    if (!_canvas || !_canvasCtx) return;
    _canvasCtx.save();
    _canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
    _canvasCtx.clearRect(0, 0, _canvas.width, _canvas.height);
    _canvasCtx.restore();
  }

  private animateParticles = (): void => {
    const now = performance.now();
    // Clamp the timestep so a suspended tab (rAF pauses) resuming after a long
    // gap does not fling every particle past the end of its path.
    const dt = Math.min((now - this._lastFrameTime) / 1000, 0.05);
    this._lastFrameTime = now;

    this.updateParticles(dt, now);
    this.renderParticles();

    this._animationFrame = requestAnimationFrame(this.animateParticles);
  };

  private updateParticles(dt: number, now: number): void {
    if (!this._flowPaths) return;

    // No temperatures => nothing to visualize; clear the field.
    if (!this.readFlowTemps()) {
      this._particles = [];
      return;
    }

    // Spawn new particles periodically (~12 per second per path).
    const spawnChance = 0.20 * dt * 60;
    const PARTICLE_SPEED = 0.2; // progress per second (constant for all particles)
    const MAX_OFFSET = 0.8; // keep particles away from stroke edges (0.7 = 70% of half-width)
    for (let pathIndex = 0; pathIndex < 2; pathIndex++) {
      if (Math.random() < spawnChance) {
        const size = 3 + Math.random() * 2;
        // Spawn biased towards center of stroke, clamped away from edges.
        const rawOffset = Math.random() * 2 - 1; // -1 to 1
        const biasedOffset = Math.sign(rawOffset) * Math.pow(Math.abs(rawOffset), 1.5); // bias toward 0
        const offset = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, biasedOffset)); // clamp
        this._particles.push({
          progress: 0,
          speed: PARTICLE_SPEED,
          size,
          pathIndex: pathIndex as 0 | 1,
          offset,
          trail: [],
        });
      }
    }

    // Update existing particles.
    // Trail length is pruned by elapsed time (not frame count) so it looks the
    // same at 30, 60 or 144 Hz; the hard cap only bounds very high refresh
    // rates and a long hidden-tab gap.
    const TRAIL_DURATION_MS = 120;
    const MAX_TRAIL_POINTS = 24;
    const trailCutoff = now - TRAIL_DURATION_MS;
    for (const p of this._particles) {
      // Add current position to trail before updating progress.
      p.trail.unshift({ progress: p.progress, offset: p.offset, time: now });
      while (p.trail.length > 1 && p.trail[p.trail.length - 1].time < trailCutoff) {
        p.trail.pop();
      }
      if (p.trail.length > MAX_TRAIL_POINTS) p.trail.length = MAX_TRAIL_POINTS;

      p.progress += p.speed * dt;
    }

    // Remove particles that reached the end.
    this._particles = this._particles.filter((p) => p.progress < 1);
  }

  private renderParticles(): void {
    if (!this._canvas || !this._canvasCtx || !this._pathPoints.length) return;

    const ctx = this._canvasCtx;
    const dpr = window.devicePixelRatio || 1;

    // Canvas is inside SVG foreignObject with viewBox coordinates.
    // Use SVG viewBox dimensions directly.
    const VIEWBOX_WIDTH = 1629;
    const VIEWBOX_HEIGHT = 640;

    const width = VIEWBOX_WIDTH * dpr;
    const height = VIEWBOX_HEIGHT * dpr;

    // Resize canvas if needed.
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
      this._canvas.style.width = `${VIEWBOX_WIDTH}px`;
      this._canvas.style.height = `${VIEWBOX_HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Clear first (in viewBox coordinates) so a particle field that just
    // emptied (e.g. temps became unavailable) does not leave stale particles
    // frozen on screen.
    ctx.clearRect(0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT);

    if (!this._particles.length) return;

    const strokeWidth = 90; // matches SVG stroke-width
    const SAMPLE_COUNT = 100;

    /** Get interpolated point and tangent from precomputed path data. */
    const getPathData = (pathIndex: number, progress: number) => {
      const { points } = this._pathPoints[pathIndex];
      const idx = progress * SAMPLE_COUNT;
      const i = Math.floor(idx);
      const f = idx - i;
      const a = points[Math.min(i, SAMPLE_COUNT)];
      const b = points[Math.min(i + 1, SAMPLE_COUNT)];
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        tx: a.tx + (b.tx - a.tx) * f,
        ty: a.ty + (b.ty - a.ty) * f,
      };
    };

    const FADE_IN_END = 0.15;
    const FADE_OUT_START = 0.85;

    const renderParticle = (progress: number, offset: number, size: number, baseOpacity: number, pathIndex: number) => {
      const { x, y, tx, ty } = getPathData(pathIndex, progress);

      // Perpendicular vector: (-ty, tx) rotated 90° CCW from tangent.
      // For consistent spread on both paths, ensure perpendicular points to "left" of flow direction.
      const px = -ty;
      const py = tx;

      const offsetX = px * offset * (strokeWidth / 2);
      const offsetY = py * offset * (strokeWidth / 2);

      let progressOpacity = 1;
      if (progress < FADE_IN_END) {
        progressOpacity = progress / FADE_IN_END;
      } else if (progress > FADE_OUT_START) {
        progressOpacity = (1 - progress) / (1 - FADE_OUT_START);
      }
      const opacity = baseOpacity * progressOpacity;

      const finalX = x + offsetX;
      const finalY = y + offsetY;

      // Use the parsed mask for precise clipping: path 1 (index 0) goes under
      // path 2 at the crossing. The mask geometry is in viewBox coordinates,
      // so reset the transform before the hit-test.
      if (pathIndex === 0 && this._maskPath) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to viewBox coordinates
        if (ctx.isPointInPath(this._maskPath, finalX, finalY)) {
          ctx.restore();
          return; // particle in crossing region, skip it (goes under)
        }
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(finalX, finalY, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fill();
    };

    for (const p of this._particles) {
      // Render trail (oldest first). `trailSpan` is guarded because a particle
      // has a single trail point on its first frame (length - 1 === 0).
      const trailSpan = Math.max(1, p.trail.length - 1);
      for (let i = p.trail.length - 1; i >= 0; i--) {
        const t = p.trail[i];
        const trailProgress = 1 - i / trailSpan;
        const opacity = 0.1 * trailProgress;
        const size = p.size * (0.5 + 0.5 * trailProgress);
        renderParticle(t.progress, t.offset, size, opacity, p.pathIndex);
      }

      // Render main particle (head).
      renderParticle(p.progress, p.offset, p.size, 0.4, p.pathIndex);
    }
  }

  // ── SVG gradients ──────────────────────────

  /**
   * Read the four flow temperatures from hass. Returns null when any is
   * missing or non-numeric, so callers can distinguish "unavailable" from a
   * genuine value.
   */
  private readFlowTemps(): FlowTemps | null {
    if (!this.config) return null;

    const outdoor = this.getNumericState(this.config.outdoor_temp);
    const supply = this.getNumericState(this.config.supply_temp);
    const extract = this.getNumericState(this.config.extract_temp);
    const exhaust = this.getNumericState(this.config.exhaust_temp);

    if (outdoor === null || supply === null || extract === null || exhaust === null) {
      return null;
    }
    return { outdoor, supply, extract, exhaust };
  }

  /**
   * Derive the per-path gradient stop temperatures and a shared normaliser
   * (0–1 across the combined min/max of all stops) from flow temperatures.
   */
  private buildFlowGradient(temps: FlowTemps): FlowGradient {
    const path1Temps = buildGradientTemps(temps.outdoor, temps.supply);
    // Path 2 runs right-to-left (extract→exhaust), so args are swapped.
    const path2Temps = buildGradientTemps(temps.exhaust, temps.extract);

    const allTemps = [...path1Temps, ...path2Temps];
    const minTemp = Math.min(...allTemps);
    const maxTemp = Math.max(...allTemps);
    const range = Math.max(maxTemp - minTemp, 0.1);
    const normalise = (t: number) => (t - minTemp) / range;

    return { path1Temps, path2Temps, normalise };
  }

  private updateSvgGradients(): void {
    if (!this._gradientStops) return;

    const temps = this.readFlowTemps();
    // If any temperature is unavailable, leave the gradients in their last
    // known state rather than collapsing them around a bogus 0.
    if (!temps) return;

    const { path1Temps, path2Temps, normalise } = this.buildFlowGradient(temps);
    applyGradientToStops(this._gradientStops.path1, path1Temps, normalise);
    applyGradientToStops(this._gradientStops.path2, path2Temps, normalise);
  }

  // ── render helpers ─────────────────────────

  private renderLabel(
    cssClass: string,
    entity: string,
    value: number | null,
    label: string,
    decimals: number = 1
  ) {
    const text = value === null ? "—" : value.toFixed(decimals);
    // Show the sensor's own unit (°F users otherwise see a wrong °C label).
    const unit = this.getEntityAttribute<string>(entity, "unit_of_measurement") ?? "°C";

    return html`
      <button
        type="button"
        class="label ${cssClass}"
        title=${label}
        aria-label=${`${label} temperature ${text} ${unit}`}
        @click=${() => this.handleMoreInfo(entity)}
      >
        <span class="temp-row"><span class="temp-value">${text}</span><span class="temp-unit">${unit}</span></span>
        <span class="temp-name">${label}</span>
      </button>
    `;
  }

  private renderSensorChip(sensor: SensorConfig) {
    const { display, unit, isBinary, isOn, isHeat } = this.getSensorDisplayInfo(sensor);
    const label =
      sensor.label ??
      (sensor.entity.split(".").pop() ?? sensor.entity).replace(/_/g, " ");

    const dotClass = isBinary
      ? isHeat && isOn
        ? "dot--heat"
        : isOn
        ? "dot--on"
        : "dot--off"
      : "";

    const valueText = !isBinary && unit ? `${display} ${unit}` : display;

    return html`
      <button
        type="button"
        class="sensor-chip"
        title=${sensor.entity}
        aria-label=${`${label}: ${valueText}`}
        @click=${() => this.handleMoreInfo(sensor.entity)}
      >
        ${isBinary ? html`<span class="sensor-dot ${dotClass}"></span>` : ""}
        <span class="sensor-label">${label}</span>
        <span class="sensor-value ${isBinary ? (isOn ? "badge--on" : "badge--off") : ""}">
          ${display}${!isBinary && unit ? html`<span class="sensor-unit"> ${unit}</span>` : ""}
        </span>
      </button>
    `;
  }

  private renderSensorRow() {
    const sensors = this.config?.sensors ?? [];
    if (!sensors.length) return html``;

    return html`
      <div class="sensor-row">
        ${this._renderSensorChips(sensors)}
      </div>
    `;
  }

  /** Build the chip templates outside the render function so the template
   * expression stays a plain array literal (avoids `.map` in markup). */
  private _renderSensorChips(sensors: SensorConfig[]): TemplateResult[] {
    return sensors.map((s) => this.renderSensorChip(s));
  }

  // ── render ─────────────────────────────────

  render() {
    if (!this._hass || !this.config) return html``;

    const { outdoor_temp, supply_temp, extract_temp, exhaust_temp } = this.config;

    return html`
      <ha-card>
        <div class="mini-header">
          <span class="mini-title">${this.config.title ?? "HRV System"}</span>
        </div>

        <div class="wrap">
          <div class="svg-container"></div>
          <div class="vignette"></div>

          <div class="overlay">
            ${this.renderLabel("outdoor", outdoor_temp, this.getNumericState(outdoor_temp), "Outdoor")}
            ${this.renderLabel("supply",  supply_temp,  this.getNumericState(supply_temp),  "Supply")}
            ${this.renderLabel("extract", extract_temp, this.getNumericState(extract_temp), "Extract")}
            ${this.renderLabel("exhaust", exhaust_temp, this.getNumericState(exhaust_temp), "Exhaust")}

          </div>
        </div>

        ${this.renderSensorRow()}
      </ha-card>
    `;
  }

  // ── styles ─────────────────────────────────

  static styles = css`
    :host {
      font-family: var(--primary-font-family);
      display: block;
    }

    ha-card {
      overflow: hidden;
      border-radius: var(--ha-card-border-radius, var(--card-border-radius, 12px));
      font-family: var(--ha-card-header-font-family, var(--primary-font-family, var(--ha-font-family-body, inherit)));
    }

    /* ── Header ───────────────────────────────── */

    .mini-header {
      padding: 16px 16px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .mini-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--primary-text-color);
    }

    /* ── Wrap + svg-container ─────────────────── */

    .wrap {
      position: relative;
      width: 100%;
    }

    .svg-container {
      z-index: 3;
    }

    .svg-container svg {
      width: 100%;
      height: auto;
      display: block;
    }

    .vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      background:
        radial-gradient(ellipse 55% 60% at 50% 50%, transparent 40%, var(--ha-card-background, var(--card-background-color, #fff)) 100%);
      opacity: 0.12;
    }

    .overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 3;
    }

    /* ── Temperature labels ───────────────────── */

    .label {
      pointer-events: auto;
      position: absolute;
      display: flex;
      flex-direction: column;
      gap: 1px;
      cursor: pointer;
      /* Native <button> reset */
      background: none;
      border: none;
      padding: 0;
      margin: 0;
      font: inherit;
      color: inherit;
      text-align: inherit;
    }

    .label:hover .temp-value {
      opacity: 0.75;
    }

    .label:focus-visible,
    .sensor-chip:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }

    .temp-row {
      display: flex;
      align-items: baseline;
      gap: 2px;
      line-height: 1;
    }

    .temp-value {
      font-size: clamp(14px, 1.5vw, 19px);
      font-weight: 600;
      line-height: 1;
      color: var(--primary-text-color);
      transition: opacity 0.15s ease;
    }

    .temp-unit {
      font-size: clamp(9px, 0.9vw, 12px);
      font-weight: 400;
      color: var(--secondary-text-color);
      line-height: 1;
      align-self: flex-start;
      margin-top: 1px;
    }

    .temp-name {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--secondary-text-color);
      opacity: 0.55;
      line-height: 1;
    }

    .outdoor {
      left: 3%;
      top: calc(21.875% - 4px);
      transform: translateY(-100%);
      align-items: flex-start;
    }
    .extract {
      right: 2.4%;
      top: calc(21.875% - 4px);
      transform: translateY(-100%);
      align-items: flex-end;
    }

    .exhaust {
      left: 3%;
      top: calc(73.594% - 4px);
      transform: translateY(-100%);
      align-items: flex-start;
    }
    .supply {
      right: 2.4%;
      top: calc(73.594% - 4px);
      transform: translateY(-100%);
      align-items: flex-end;
    }

    /* ── Sensor row ───────────────────────────── */

    .sensor-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 16px 16px;
    }

    .sensor-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      border-radius: 20px;
      background: var(--secondary-background-color);
      border: 1px solid var(--divider-color);
      cursor: pointer;
      transition: background 0.15s ease;
      /* Native <button> reset */
      font: inherit;
      color: inherit;
    }

    .sensor-chip:hover {
      background: color-mix(in srgb, var(--primary-color) 8%, var(--secondary-background-color));
    }

    .sensor-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .dot--on  { background: var(--success-color, #4caf50); box-shadow: 0 0 4px var(--success-color, #4caf50); }
    .dot--heat { background: var(--error-color, #f44336); box-shadow: 0 0 4px var(--error-color, #f44336); }
    .dot--off { background: var(--disabled-color, rgba(0,0,0,0.25)); }

    .sensor-label {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      color: var(--secondary-text-color);
    }

    .sensor-value {
      font-size: 12px;
      font-weight: 600;
      color: var(--primary-text-color);
    }

    .sensor-unit {
      font-weight: 400;
      color: var(--secondary-text-color);
    }

    .badge--on {
      color: var(--success-color, #4caf50);
    }

    .badge--off {
      color: var(--disabled-text-color, var(--secondary-text-color));
      opacity: 0.6;
    }
  `;
}

// ─────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────

if (!customElements.get("hrv-card")) {
  customElements.define("hrv-card", HRVCard);
}