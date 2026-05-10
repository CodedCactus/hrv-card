import { LitElement, html, css } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import hrvSvg from "./assets/card.svg?raw";

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
  supply_flow?: string;
  exhaust_flow?: string;
  sensors: SensorConfig[];
}

interface SensorConfig {
  entity: string;
  label?: string;
  format?: "binary" | "text";
  unit?: string;
}

interface SensorDisplayInfo {
  display: string;
  unit: string;
  isBinary: boolean;
  isOn: boolean;
}

type RGB = [number, number, number];

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

/** Cool-to-warm colour ramp (blue → light blue → orange → red). */
const COLOR_STOPS: RGB[] = [
  [59, 76, 192],
  [120, 180, 220],
  [245, 160, 105],
  [180, 4, 38],
];

/** SVG viewBox dimensions — must match card.svg */
const SVG_W = 1629;
const SVG_H = 640;

/** Half the stroke-width of the two flow paths in SVG units */
const HALF_STROKE = 45;

/** Path d-strings from card.svg (arrows removed) */
const PATH1_D =
  "m 49.454545,185.45455 309.736315,-0.13621 c 67.2347,0.42883 104.58368,11.78795 162.60635,41.30753 l 540.46499,240.34965 c 86.6087,38.92199 129.7411,49.51111 206.0245,49.02448 l 321.8951,-0.36364";

const PATH2_D =
  "m 1590.2128,185.45455 -309.7363,-0.13621 c -67.2347,0.42883 -104.5836,11.78795 -162.6063,41.30753 L 577.40519,466.97552 C 490.79649,505.89751 447.66409,516.48663 371.38069,516 L 49.485592,515.63636";

/**
 * The mask cutout polygon from card.svg — the black region that hides path1
 * particles where the two flows cross. Coordinates are in SVG units (0..1629 × 0..640).
 *
 * This is the `d` of the black <path> inside <mask id="curveMask">.
 */
const MASK_CUTOUT_D =
  "m 1273.9551,128.39258 c -32.0637,0.58284 -64.2021,4.24638 -95.177,12.74756 -27.6382,7.50585 -54.2017,18.53026 -79.8197,31.25211 -3.304,1.61358 -6.583,3.1479 -9.8971,4.64693 -9.4165,4.22773 -18.8683,8.37419 -28.2909,12.58876 -173.97544,77.35812 -347.94584,154.7278 -521.92448,232.07869 -14.0354,6.10129 -28.11932,12.11071 -42.47092,17.43595 -2.33738,0.86672 -4.90909,1.79684 -7.25,2.62304 -12.65767,4.43483 -25.45548,8.30162 -38.63813,11.06951 -1.20711,0.23826 -2.51848,0.51874 -3.7589,0.75152 -3.92058,0.76101 -7.86027,1.42066 -11.81,2.01101 -1.15512,0.15932 -2.40872,0.35404 -3.57538,0.50199 -10.0584,1.34122 -20.21971,2.07689 -30.39554,2.4725 -16.58735,0.63549 -33.28867,0.38907 -49.92752,0.39986 -104.49023,-0.1153 -208.98047,-0.23191 -313.470702,-0.34701 -0.04109,38 -0.08391,76 -0.125,114 115.416492,0.12179 230.833112,0.24509 346.249572,0.32646 33.67553,-0.39328 67.41881,-3.8015 100.17893,-11.78258 37.57577,-9.01861 73.71283,-23.09878 108.98499,-38.71061 34.56098,-15.29015 69.06914,-30.70181 103.60763,-46.04392 148.81735,-66.1912 297.63855,-132.37436 446.45345,-198.5706 8.8478,-4.44955 17.7053,-8.88423 26.7012,-13.0293 14.7424,-6.76223 30.0891,-12.8361 46.0066,-16.45024 4.5508,-1.05413 9.1445,-1.91596 13.7571,-2.65132 1.3173,-0.18921 2.8678,-0.44145 4.281,-0.62112 11.9581,-1.65321 24.0653,-2.27661 36.0838,-2.57239 15.8342,-0.35647 31.6733,-0.12099 47.5098,-0.16931 94.9851,0.0316 189.9703,0.0688 284.9555,0.10501 0.011,-38 0.028,-76 0.039,-114 -109.1867,-0.0375 -218.3735,-0.0809 -327.5601,-0.075 -0.2391,0.004 -0.4781,0.008 -0.7172,0.0125";

const PARTICLE_COUNT = 55; // per path

// ─────────────────────────────────────────────
// Pure colour utilities
// ─────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** Classic cubic smoothstep — returns 0 at edge0, 1 at edge1, smooth in between. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(lerp(a, b, t));
}

function tempToColor(normalised: number): string {
  const t = clamp(normalised);
  const segments = COLOR_STOPS.length - 1;
  const scaled = t * segments;
  const i = Math.floor(scaled);
  const f = scaled - i;

  const a = COLOR_STOPS[i];
  const b = COLOR_STOPS[Math.min(i + 1, segments)];

  return `rgb(${lerpChannel(a[0], b[0], f)},${lerpChannel(a[1], b[1], f)},${lerpChannel(a[2], b[2], f)})`;
}

function buildGradientTemps(
  start: number,
  end: number
): [number, number, number, number] {
  return [start, lerp(start, end, 0.33), lerp(start, end, 0.66), end];
}

function applyGradient(
  svg: SVGElement,
  gradientId: string,
  temps: number[],
  normalise: (t: number) => number
): void {
  const grad = svg.querySelector<SVGLinearGradientElement>(`#${gradientId}`);
  if (!grad) return;

  grad.innerHTML = "";

  temps.forEach((temp, i) => {
    const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop.setAttribute("offset", `${(i / (temps.length - 1)) * 100}%`);
    stop.setAttribute("stop-color", tempToColor(normalise(temp)));
    grad.appendChild(stop);
  });
}

// ─────────────────────────────────────────────
// Particle colour
// ─────────────────────────────────────────────

/** All particles are white; alpha is handled per-segment in draw(). */
function particleColor(_t: number): RGB {
  return [255, 255, 255];
}

// ─────────────────────────────────────────────
// Path sampler
// ─────────────────────────────────────────────

interface PathSample {
  x: number;
  y: number;
  /** Unit normal perpendicular to the path tangent (points "left" of travel). */
  nx: number;
  ny: number;
}

function samplePath(svgPath: SVGPathElement, t: number): PathSample {
  const totalLen = svgPath.getTotalLength();
  const pt = svgPath.getPointAtLength(t * totalLen);

  const dt = 0.001;
  const t1 = Math.max(t - dt, 0);
  const t2 = Math.min(t + dt, 1);
  const pa = svgPath.getPointAtLength(t1 * totalLen);
  const pb = svgPath.getPointAtLength(t2 * totalLen);

  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const mag = Math.sqrt(dx * dx + dy * dy) || 1;

  return {
    x: pt.x,
    y: pt.y,
    nx: -dy / mag,
    ny:  dx / mag,
  };
}

// ─────────────────────────────────────────────
// Particle
// ─────────────────────────────────────────────

const TAIL_LENGTH = 14;

class Particle {
  t = 0;
  speed = 0;
  lane = 0;      // -1..1 → -HALF_STROKE..+HALF_STROKE in SVG units
  baseSize = 0;
  alpha = 0;
  /** Each entry: [canvasX, canvasY, pathT] – pathT drives color per segment. */
  tail: Array<[number, number, number]> = [];

  constructor(
    readonly svgPath: SVGPathElement,
    private readonly colorFn: (t: number) => RGB
  ) {
    this.reset(true);
  }

  reset(initial: boolean): void {
    this.t        = initial ? Math.random() : 0;
    this.lane     = Math.random() * 2 - 1;
    this.speed    = 0.004 + Math.random() * 0.0005;
    this.baseSize = 1.4 + Math.random() * 1.4;
    this.alpha    = 0.18 + Math.random() * 0.14;
    this.tail     = [];
  }

  update(scaleX: number, scaleY: number): void {
    this.t += this.speed;
    if (this.t > 1) {
      this.reset(false);
      return;
    }

    const s      = samplePath(this.svgPath, this.t);
    const offset = this.lane * HALF_STROKE * 0.88;

    this.tail.unshift([
      (s.x + s.nx * offset) * scaleX,
      (s.y + s.ny * offset) * scaleY,
      this.t,
    ]);
    if (this.tail.length > TAIL_LENGTH) this.tail.pop();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.tail.length < 2) return;

    // Smooth falloff from centre (lane=0) to stroke edge (lane=±1).
    // cos²(|lane| · π/2) = 1 at centre, 0 at edge.
    const edgeFade = Math.pow(Math.cos(Math.abs(this.lane) * Math.PI * 0.5), 2);

    for (let i = 1; i < this.tail.length; i++) {
      const [x0, y0, t0] = this.tail[i - 1];
      const [x1, y1]     = this.tail[i];
      const ratio = 1 - i / this.tail.length;

      // Fade in near the source label (t≈0) and fade out into the destination
      // label (t≈1), so particles look like they stream out of and into the pills.
      const FADE_ZONE = 0.12; // fraction of path length used for each fade
      const endpointFade = Math.min(
        smoothstep(0, FADE_ZONE, t0),          // ramp up from source
        smoothstep(1, 1 - FADE_ZONE, t0)       // ramp down into destination
      );

      const a = this.alpha * edgeFade * endpointFade;
      const [r, g, b] = this.colorFn(t0);

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = `rgba(${r},${g},${b},${a * ratio * 0.8})`;
      ctx.lineWidth   = this.baseSize * ratio;
      ctx.lineCap     = "round";
      ctx.stroke();
    }

    // Bright head — also fades at endpoints
    const [hx, hy, ht] = this.tail[0];
    const FADE_ZONE = 0.12;
    const endpointFade = Math.min(
      smoothstep(0, FADE_ZONE, ht),
      smoothstep(1, 1 - FADE_ZONE, ht)
    );
    const [r, g, b] = this.colorFn(ht);
    ctx.beginPath();
    ctx.arc(hx, hy, this.baseSize * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${this.alpha * edgeFade * endpointFade})`;
    ctx.fill();
  }
}

// ─────────────────────────────────────────────
// Mask path builder
// ─────────────────────────────────────────────

/**
 * Build a canvas Path2D that represents the cutout region from the SVG
 * curveMask, scaled from SVG space to canvas pixel space.
 *
 * The SVG mask shows path1 everywhere EXCEPT inside the black polygon.
 * We replicate this by drawing path1 particles to an offscreen canvas,
 * then erasing the cutout region with `destination-out`, and finally
 * compositing the result onto the main canvas.
 */
function buildMaskCutoutPath(scaleX: number, scaleY: number): Path2D {
  // Parse the SVG path d-string into a Path2D, then apply the scale
  // transform so the shape maps to canvas pixels.
  const raw = new Path2D(MASK_CUTOUT_D);

  // DOMMatrix to scale from SVG units to canvas pixels
  const matrix = new DOMMatrix([scaleX, 0, 0, scaleY, 0, 0]);
  return new Path2D(raw); // we'll apply the transform via ctx.setTransform below
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

  // Particle animation state
  private _canvas?: HTMLCanvasElement;
  private _ctx?: CanvasRenderingContext2D;
  /** Offscreen canvas used to draw path1 particles before masking them */
  private _offscreen?: HTMLCanvasElement;
  private _offCtx?: CanvasRenderingContext2D;
  private _particles: Particle[] = [];
  private _animFrame?: number;
  private _resizeObserver?: ResizeObserver;

  // Hidden SVG used for path sampling (getTotalLength / getPointAtLength)
  private _tmpSvg?: SVGSVGElement;
  private _svgPath1?: SVGPathElement;
  private _svgPath2?: SVGPathElement;
  /** Path2D of the mask cutout in SVG units — rebuilt on resize */
  private _maskPath?: Path2D;

  // ── hass accessor ──────────────────────────

  set hass(value: HomeAssistant) {
    const previous = this._hass;
    this._hass = value;

    if (!this.config || !this.hasUpdated) {
      this.requestUpdate();
      return;
    }

    const trackedEntities = [
      this.config.outdoor_temp,
      this.config.supply_temp,
      this.config.extract_temp,
      this.config.exhaust_temp,
      ...(this.config.supply_flow  ? [this.config.supply_flow]  : []),
      ...(this.config.exhaust_flow ? [this.config.exhaust_flow] : []),
      ...(this.config.sensors?.map((s) => s.entity) ?? []),
    ];

    const hasChanged = trackedEntities.some(
      (entity) =>
        previous?.states[entity]?.state !== value.states[entity]?.state
    );

    if (hasChanged) this.requestUpdate();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  // ── config ─────────────────────────────────

  setConfig(config: HRVCardConfig): void {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid card configuration.");
    }

    for (const key of REQUIRED_CONFIG_KEYS) {
      if (!config[key]) {
        throw new Error(
          `HRV Card is missing required field: "${key}". Required fields: ${REQUIRED_CONFIG_KEYS.join(", ")}.`
        );
      }
    }

    if (!Array.isArray(config.sensors)) {
      throw new Error('HRV Card requires a "sensors" array.');
    }

    this.config = { ...config };
  }

  getCardSize(): number {
    return 3;
  }

  // ── state helpers ──────────────────────────

  private getNumericState(entity: string): number {
    const raw = this._hass?.states?.[entity]?.state;
    const num = Number(raw);
    return Number.isNaN(num) ? 0 : num;
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
    const isOn = state === "on";

    let display: string;
    if (isBinary) {
      display = isOn
        ? (isOpening ? "Open"   : "On")
        : (isOpening ? "Closed" : "Off");
    } else {
      const num = Number(state);
      display = Number.isNaN(num) ? state : num.toFixed(1);
    }

    return { display, unit, isBinary, isOn };
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

  protected firstUpdated(): void {
    this.updateSvgGradients();
    this.initParticleSystem();
  }

  protected updated(changedProps: Map<string, unknown>): void {
    if (changedProps.has("_hass")) {
      this.updateSvgGradients();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.destroyParticleSystem();
  }

  // ── SVG gradients ──────────────────────────

  private updateSvgGradients(): void {
    if (!this.config) return;

    const svg = this.renderRoot.querySelector<SVGElement>("svg");
    if (!svg) return;

    const outdoor = this.getNumericState(this.config.outdoor_temp);
    const supply  = this.getNumericState(this.config.supply_temp);
    const extract = this.getNumericState(this.config.extract_temp);
    const exhaust = this.getNumericState(this.config.exhaust_temp);

    const path1Temps = buildGradientTemps(outdoor, supply);
    const path2Temps = buildGradientTemps(exhaust,  extract);

    const allTemps = [...path1Temps, ...path2Temps];
    const minTemp  = Math.min(...allTemps);
    const maxTemp  = Math.max(...allTemps);
    const range    = Math.max(maxTemp - minTemp, 0.1);

    const normalise = (t: number) => (t - minTemp) / range;

    applyGradient(svg, GRADIENT_IDS.path1, path1Temps, normalise);
    applyGradient(svg, GRADIENT_IDS.path2, path2Temps, normalise);
  }

  // ── Particle system ────────────────────────

  private initParticleSystem(): void {
    const wrap = this.renderRoot.querySelector<HTMLElement>(".wrap");
    if (!wrap) return;

    // Hidden SVG for path measurement (getTotalLength / getPointAtLength)
    const ns = "http://www.w3.org/2000/svg";
    this._tmpSvg = document.createElementNS(ns, "svg") as SVGSVGElement;
    this._tmpSvg.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
    this._tmpSvg.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;";
    document.body.appendChild(this._tmpSvg);

    const makePath = (d: string): SVGPathElement => {
      const p = document.createElementNS(ns, "path") as SVGPathElement;
      p.setAttribute("d", d);
      this._tmpSvg!.appendChild(p);
      return p;
    };

    this._svgPath1 = makePath(PATH1_D);
    this._svgPath2 = makePath(PATH2_D);

    // Pre-build the mask Path2D (in SVG units; we'll scale it at draw time)
    this._maskPath = new Path2D(MASK_CUTOUT_D);

    // Main canvas overlay — sits above the SVG but below the label overlay
    const canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;";
    wrap.appendChild(canvas);
    this._canvas = canvas;
    this._ctx = canvas.getContext("2d") ?? undefined;

    // Offscreen canvas for path1 particles (same size, resized together)
    this._offscreen = document.createElement("canvas");
    this._offCtx = this._offscreen.getContext("2d") ?? undefined;

    const resize = (): void => {
      const r = wrap.getBoundingClientRect();
      canvas.width  = r.width;
      canvas.height = r.height;
      if (this._offscreen) {
        this._offscreen.width  = r.width;
        this._offscreen.height = r.height;
      }
    };
    resize();
    this._resizeObserver = new ResizeObserver(resize);
    this._resizeObserver.observe(wrap);

    // Spawn particles — staggered t so they fill the path immediately.
    // Pre-warm happens lazily on the first frame that has valid dimensions,
    // since getBoundingClientRect() returns 0×0 synchronously in firstUpdated.
    this._particles = [
      ...Array.from({ length: PARTICLE_COUNT }, () =>
        new Particle(this._svgPath1!, particleColor)
      ),
      ...Array.from({ length: PARTICLE_COUNT }, () =>
        new Particle(this._svgPath2!, particleColor)
      ),
    ];

    let warmed = false;

    const loop = (): void => {
      this._animFrame = requestAnimationFrame(loop);
      if (!this._ctx || !this._canvas || !this._offCtx || !this._offscreen) return;

      const { width, height } = this._canvas;
      const r = wrap.getBoundingClientRect();
      const scaleX = r.width  / SVG_W;
      const scaleY = r.height / SVG_H;

      // Defer pre-warm until the wrap has real dimensions (SVG fully laid out).
      // Running it with scale=0 would collapse all tail points to (0,0).
      if (!warmed) {
        if (r.width > 0 && r.height > 0) {
          for (const p of this._particles) {
            for (let step = 0; step < TAIL_LENGTH; step++) p.update(scaleX, scaleY);
          }
          warmed = true;
        } else {
          // Dimensions not ready yet — skip this frame entirely
          return;
        }
      }

      // ── Split particles into path1 (first half) and path2 (second half) ──
      const path1Particles = this._particles.slice(0, PARTICLE_COUNT);
      const path2Particles = this._particles.slice(PARTICLE_COUNT);

      // ── 1. Draw path1 particles to offscreen canvas ──
      this._offCtx.clearRect(0, 0, width, height);
      for (const p of path1Particles) {
        p.update(scaleX, scaleY);
        p.draw(this._offCtx);
      }

      // ── 2. Erase the mask-cutout region from the offscreen canvas ──
      //    The mask cutout is in SVG units; scale it to canvas pixels.
      this._offCtx.save();
      this._offCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      this._offCtx.globalCompositeOperation = "destination-out";
      this._offCtx.fillStyle = "black"; // alpha doesn't matter — GCO erases
      this._offCtx.fill(this._maskPath!);
      this._offCtx.restore();

      // ── 3. Composite to main canvas: path1 first (behind), then path2 ──
      this._ctx.clearRect(0, 0, width, height);

      // Draw masked path1
      this._ctx.drawImage(this._offscreen, 0, 0);

      // Draw path2 on top (no mask needed — it passes in front)
      for (const p of path2Particles) {
        p.update(scaleX, scaleY);
        p.draw(this._ctx);
      }
    };
    loop();
  }

  private destroyParticleSystem(): void {
    if (this._animFrame !== undefined) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = undefined;
    }
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._tmpSvg?.remove();
    this._tmpSvg = undefined;
    this._canvas?.remove();
    this._canvas = undefined;
    this._offscreen = undefined;
    this._offCtx = undefined;
    this._maskPath = undefined;
    this._particles = [];
  }

  // ── render helpers ─────────────────────────

  private renderLabel(
    cssClass: string,
    entity: string,
    value: number,
    label: string,
    unit: string = "°C",
    labelClass: string = "label",
    decimals: number = 1
  ) {
    if (labelClass === "flow-label") {
      // Flow rate pill: compact, monospaced value + unit
      return html`
        <div
          class="flow-label ${cssClass}"
          title=${label}
          @click=${() => this.handleMoreInfo(entity)}
        >
          <span class="flow-value">${value.toFixed(decimals)}</span>
          <span class="flow-unit">${unit}</span>
        </div>
      `;
    }

    // Temperature label: large value + inline unit, small name below
    return html`
      <div
        class="label ${cssClass}"
        title=${label}
        @click=${() => this.handleMoreInfo(entity)}
      >
        <span class="temp-row"><span class="temp-value">${value.toFixed(decimals)}</span><span class="temp-unit">${unit}</span></span>
        <span class="temp-name">${label}</span>
      </div>
    `;
  }

  private renderSensorChip(sensor: SensorConfig) {
    const { display, unit, isBinary, isOn } = this.getSensorDisplayInfo(sensor);
    const label = sensor.label ?? sensor.entity.split(".")[1].replace(/_/g, " ");

    return html`
      <div
        class="sensor-chip"
        title=${sensor.entity}
        @click=${() => this.handleMoreInfo(sensor.entity)}
      >
        ${isBinary ? html`<span class="sensor-dot ${isOn ? "dot--on" : "dot--off"}"></span>` : ""}
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
        ${sensors.map((s) => this.renderSensorChip(s))}
      </div>
    `;
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
          <div class="svg">${unsafeSVG(hrvSvg)}</div>
          <div class="vignette"></div>

          <div class="overlay">
            ${this.renderLabel("outdoor", outdoor_temp, this.getNumericState(outdoor_temp), "Outdoor")}
            ${this.renderLabel("supply",  supply_temp,  this.getNumericState(supply_temp),  "Supply")}
            ${this.renderLabel("extract", extract_temp, this.getNumericState(extract_temp), "Extract")}
            ${this.renderLabel("exhaust", exhaust_temp, this.getNumericState(exhaust_temp), "Exhaust")}

            ${this.config.supply_flow ? this.renderLabel(
              "supply-flow",
              this.config.supply_flow,
              this.getNumericState(this.config.supply_flow),
              "Supply flow",
              this.getEntityAttribute<string>(this.config.supply_flow, "unit_of_measurement") || "m³/h",
              "flow-label",
              0
            ) : ""}

            ${this.config.exhaust_flow ? this.renderLabel(
              "exhaust-flow",
              this.config.exhaust_flow,
              this.getNumericState(this.config.exhaust_flow),
              "Exhaust flow",
              this.getEntityAttribute<string>(this.config.exhaust_flow, "unit_of_measurement") || "m³/h",
              "flow-label",
              0
            ) : ""}
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
      font-family: var(--ha-card-header-font-family, var(--primary-font-family, var(--ha-font-family-body, inherit)));
    }

    /* ── Header ───────────────────────────────── */

    .mini-header {
      padding: 14px 16px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .mini-title {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--secondary-text-color);
      opacity: 0.7;
    }

    /* ── Wrap + vignette ──────────────────────── */

    .wrap {
      position: relative;
      width: 100%;
    }

    .svg svg {
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
      opacity: 0.55;
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
      font-weight: 700;
      line-height: 1;
      color: var(--primary-text-color);
      letter-spacing: -0.02em;
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

    /*
     * SVG viewBox: 1629 × 640. Stroke-width: 90 (half = 45px).
     * Path endpoints:
     *   outdoor : left,  y=185  →  top of stroke = 140/640 = 21.875%
     *   extract : right, y=185  →  same
     *   exhaust : left,  y=516  →  top of stroke = 471/640 = 73.594%
     *   supply  : right, y=516  →  same
     * Labels anchor their bottom edge to the top of the stroke, left/right
     * aligned to the start/end of the path (x≈49 → 3%, x≈1590 → 97.6%).
     * A small gap (4px) keeps them off the stroke.
     */

    /* top stroke — label bottom sits just above the stroke top edge */
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

    /* bottom stroke — label bottom sits just above the stroke top edge */
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

    /* ── Flow labels ──────────────────────────── */

    .flow-label {
      position: absolute;
      display: inline-flex;
      align-items: baseline;
      gap: 3px;
      padding: 3px 8px;
      border-radius: 20px;
      background: var(--ha-card-background, var(--card-background-color, #fff));
      border: 1px solid var(--divider-color, rgba(0,0,0,0.08));
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      pointer-events: auto;
      cursor: pointer;
      transition: box-shadow 0.15s ease;
    }

    .flow-label:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.14);
    }

    .flow-value {
      font-size: clamp(11px, 1.1vw, 14px);
      font-weight: 600;
      color: var(--primary-text-color);
      letter-spacing: -0.01em;
    }

    .flow-unit {
      font-size: clamp(9px, 0.85vw, 11px);
      font-weight: 400;
      color: var(--secondary-text-color);
    }

    .supply-flow  { top: 34%;    left: 3%; }
    .exhaust-flow { bottom: 3%;  left: 3%; }

    /* ── Sensor row ───────────────────────────── */

    .sensor-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px 14px;
    }

    .sensor-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      border-radius: 20px;
      background: var(--secondary-background-color, rgba(0,0,0,0.04));
      border: 1px solid var(--divider-color, rgba(0,0,0,0.06));
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .sensor-chip:hover {
      background: var(--secondary-background-color, rgba(0,0,0,0.08));
    }

    /* Status dot for binary sensors */
    .sensor-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .dot--on  { background: var(--success-color, #4caf50); box-shadow: 0 0 4px var(--success-color, #4caf50); }
    .dot--off { background: var(--disabled-color, rgba(0,0,0,0.25)); }

    .sensor-label {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      color: var(--secondary-text-color);
    }

    .sensor-value {
      font-size: 12px;
      font-weight: 700;
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