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

// ─────────────────────────────────────────────
// Pure colour utilities
// ─────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
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
  }

  protected updated(changedProps: Map<string, unknown>): void {
    if (changedProps.has("_hass")) {
      this.updateSvgGradients();
    }
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
      return html`
        <div
          class="flow-label ${cssClass}"
          title=${label}
          @click=${() => this.handleMoreInfo(entity)}
        >
          <div class="flow-bg"></div>
          <span class="flow-value">${value.toFixed(decimals)}</span>
          <span class="flow-unit">${unit}</span>
        </div>
      `;
    }

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
      opacity: 0.3;
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

    /* ── Flow labels ──────────────────────────── */

    .flow-label {
      position: absolute;
      display: inline-flex;
      align-items: flex-end;
      gap: 4px;
      pointer-events: auto;
      cursor: pointer;
      top: 0;
      height: 100%;
      padding-bottom: 6px;
    }

    .flow-bg {
      position: absolute;
      inset-block: 0;
      left: -10px;
      right: -10px;
      border-radius: 0 999px 999px 0;
      background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color, #fff)) 35%, transparent);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid color-mix(in srgb, var(--divider-color, #fff) 20%, transparent);
      border-left: none;
      pointer-events: none;
    }

    .flow-label:hover .flow-bg {
      background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color, #fff)) 55%, transparent);
    }

    .flow-value {
      position: relative;
      font-size: clamp(10px, 1vw, 13px);
      font-weight: 500;
      color: #fff;
      letter-spacing: 0;
      opacity: 0.55;
    }

    .flow-unit {
      position: relative;
      font-size: clamp(8px, 0.8vw, 10px);
      font-weight: 400;
      color: #fff;
      opacity: 0.35;
    }

    .supply-flow {
      left: 3%;
      top: 28.906%;
      height: 14.0625%;
      transform: translateY(-50%);
    }
    .exhaust-flow {
      left: 3%;
      top: 80.625%;
      height: 14.0625%;
      transform: translateY(-50%);
    }

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