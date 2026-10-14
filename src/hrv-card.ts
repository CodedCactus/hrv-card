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
    if (
      this._hass &&
      this._flowPaths &&
      this._canvas &&
      this.config?.animation !== false
    ) {
      this.startParticleAnimation();
    }
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

      // Mask path from SVG (defines crossing region where path 1 goes under path 2).
      const maskPathData = `m 1273.9551,128.39258 c -32.0637,0.58284 -64.2021,4.24638 -95.177,12.74756 -27.6382,7.50585 -54.2017,18.53026 -79.8197,31.25211 -3.304,1.61358 -6.583,3.1479 -9.8971,4.64693 -9.4165,4.22773 -18.8683,8.37419 -28.2909,12.58876 -173.97544,77.35812 -347.94584,154.7278 -521.92448,232.07869 -14.0354,6.10129 -28.11932,12.11071 -42.47092,17.43595 -2.33738,0.86672 -4.90909,1.79684 -7.25,2.62304 -12.65767,4.43483 -25.45548,8.30162 -38.63813,11.06951 -1.20711,0.23826 -2.51848,0.51874 -3.7589,0.75152 -3.92058,0.76101 -7.86027,1.42066 -11.81,2.01101 -1.15512,0.15932 -2.40872,0.35404 -3.57538,0.50199 -10.0584,1.34122 -20.21971,2.07689 -30.39554,2.4725 -16.58735,0.63549 -33.28867,0.38907 -49.92752,0.39986 -104.49023,-0.1153 -208.98047,-0.23191 -313.470702,-0.34701 -0.04109,38 -0.08391,76 -0.125,114 115.416492,0.12179 230.833112,0.24509 346.249572,0.32646 33.67553,-0.39328 67.41881,-3.8015 100.17893,-11.78258 37.57577,-9.01861 73.71283,-23.09878 108.98499,-38.71061 34.56098,-15.29015 69.06914,-30.70181 103.60763,-46.04392 148.81735,-66.1912 297.63855,-132.37436 446.45345,-198.5706 8.8478,-4.44955 17.7053,-8.88423 26.7012,-13.0293 14.7424,-6.76223 30.0891,-12.8361 46.0066,-16.45024 4.5508,-1.05413 9.1445,-1.91596 13.7571,-2.65132 1.3173,-0.18921 2.8678,-0.44145 4.281,-0.62112 11.9581,-1.65321 24.0653,-2.27661 36.0838,-2.57239 15.8342,-0.35647 31.6733,-0.12099 47.5098,-0.16931 94.9851,0.0316 189.9703,0.0688 284.9555,0.10501 0.011,-38 0.028,-76 0.039,-114 -109.1867,-0.0375 -218.3735,-0.0809 -327.5601,-0.075 -0.2391,0.004 -0.4781,0.008 -0.7172,0.0125`;
      this._maskPath = new Path2D(maskPathData);

      if (this.config?.animation !== false) {
        this.startParticleAnimation();
      }
    }

    // Apply initial gradient colours if hass data is already available.
    if (this._hass) this.updateSvgGradients();
  }

  protected updated(changedProps: Map<string, unknown>): void {
    // Consumed: the update that shouldUpdate let through is now complete.
    this._trackedStateChanged = false;

    if (changedProps.has("_hass")) {
      this.updateSvgGradients();
      // Start/stop particle animation based on data availability and config.
      const animationEnabled = this.config?.animation !== false;
      if (
        animationEnabled &&
        this._hass &&
        this._flowPaths &&
        this._canvas &&
        !this._animationFrame
      ) {
        this.startParticleAnimation();
      } else if (!animationEnabled || !this._hass) {
        if (this._animationFrame) {
          this.stopParticleAnimation();
        }
      }
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
    const dt = (now - this._lastFrameTime) / 1000; // seconds
    this._lastFrameTime = now;

    this.updateParticles(dt);
    this.renderParticles();

    this._animationFrame = requestAnimationFrame(this.animateParticles);
  };

  private updateParticles(dt: number): void {
    if (!this._flowPaths || !this._gradientStops || !this.config) return;

    const outdoor = this.getNumericState(this.config.outdoor_temp);
    const supply  = this.getNumericState(this.config.supply_temp);
    const extract = this.getNumericState(this.config.extract_temp);
    const exhaust = this.getNumericState(this.config.exhaust_temp);

    if (outdoor === null || supply === null || extract === null || exhaust === null) {
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
    for (const p of this._particles) {
      // Add current position to trail before updating progress.
      p.trail.unshift({ progress: p.progress, offset: p.offset });
      // Keep trail length limited (max 8 segments).
      if (p.trail.length > 8) p.trail.pop();

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

      // Use mask path for precise clipping: path 1 (index 0) goes under path 2 in crossing.
      // The mask path (path9) defines the filled region where crossing occurs.
      // Do check in viewBox coordinates (without DPR transform).
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
      // Render trail (oldest first).
      for (let i = p.trail.length - 1; i >= 0; i--) {
        const t = p.trail[i];
        const trailProgress = 1 - i / (p.trail.length - 1);
        const opacity = 0.1 * trailProgress;
        const size = p.size * (0.5 + 0.5 * trailProgress);
        renderParticle(t.progress, t.offset, size, opacity, p.pathIndex);
      }

      // Render main particle (head).
      renderParticle(p.progress, p.offset, p.size, 0.4, p.pathIndex);
    }
  }

  // ── SVG gradients ──────────────────────────

  private updateSvgGradients(): void {
    if (!this.config || !this._gradientStops) return;

    const outdoor = this.getNumericState(this.config.outdoor_temp);
    const supply  = this.getNumericState(this.config.supply_temp);
    const extract = this.getNumericState(this.config.extract_temp);
    const exhaust = this.getNumericState(this.config.exhaust_temp);

    // If any temperature is unavailable, leave the gradients in their last
    // known state rather than collapsing them around a bogus 0.
    if (outdoor === null || supply === null || extract === null || exhaust === null) {
      return;
    }

    const path1Temps = buildGradientTemps(outdoor, supply);
    // Path 2 runs right-to-left (extract→exhaust), so args are swapped.
    const path2Temps = buildGradientTemps(exhaust, extract);

    const allTemps = [...path1Temps, ...path2Temps];
    const minTemp  = Math.min(...allTemps);
    const maxTemp  = Math.max(...allTemps);
    const range    = Math.max(maxTemp - minTemp, 0.1);
    const normalise = (t: number) => (t - minTemp) / range;

    applyGradientToStops(this._gradientStops.path1, path1Temps, normalise);
    applyGradientToStops(this._gradientStops.path2, path2Temps, normalise);
  }

  // ── render helpers ─────────────────────────

  private renderLabel(
    cssClass: string,
    entity: string,
    value: number | null,
    label: string,
    unit: string = "°C",
    decimals: number = 1
  ) {
    const text = value === null ? "—" : value.toFixed(decimals);

    return html`
      <div
        class="label ${cssClass}"
        title=${label}
        @click=${() => this.handleMoreInfo(entity)}
      >
        <span class="temp-row"><span class="temp-value">${text}</span><span class="temp-unit">${unit}</span></span>
        <span class="temp-name">${label}</span>
      </div>
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

    return html`
      <div
        class="sensor-chip"
        title=${sensor.entity}
        @click=${() => this.handleMoreInfo(sensor.entity)}
      >
        ${isBinary ? html`<span class="sensor-dot ${dotClass}"></span>` : ""}
        <span class="sensor-label">${label}</span>
        <span class="sensor-value ${isBinary ? (isOn ? "badge--on" : "badge--off") : ""}">
          ${display}${!isBinary && unit ? html`<span class="sensor-unit"> ${unit}</span>` : ""}
        </span>
      </div>
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
    }

    .label:hover .temp-value {
      opacity: 0.75;
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