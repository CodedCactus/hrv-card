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
      ...(this.config.sensors?.map((s) => s.entity) ?? []),
    ];

    const hasChanged = trackedEntities.some(
      (entity) => previous?.states[entity]?.state !== value.states[entity]?.state
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
      display = isOn ? (isOpening ? "Open" : "On") : (isOpening ? "Closed" : "Off");
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
    const supply = this.getNumericState(this.config.supply_temp);
    const extract = this.getNumericState(this.config.extract_temp);
    const exhaust = this.getNumericState(this.config.exhaust_temp);

    const path1Temps = buildGradientTemps(outdoor, supply);
    const path2Temps = buildGradientTemps(exhaust, extract);

    const allTemps = [...path1Temps, ...path2Temps];
    const minTemp = Math.min(...allTemps);
    const maxTemp = Math.max(...allTemps);
    const range = Math.max(maxTemp - minTemp, 0.1);

    const normalise = (t: number) => (t - minTemp) / range;

    applyGradient(svg, GRADIENT_IDS.path1, path1Temps, normalise);
    applyGradient(svg, GRADIENT_IDS.path2, path2Temps, normalise);
  }

  // ── render helpers ─────────────────────────

  private renderTempLabel(
    cssClass: string,
    entity: string,
    value: number,
    label: string
  ) {
    return html`
      <div
        class="label ${cssClass}"
        title=${label}
        @click=${() => this.handleMoreInfo(entity)}
      >
        ${value.toFixed(1)}°C
      </div>
    `;
  }

  private renderSensorChip(sensor: SensorConfig) {
    const { display, unit, isBinary, isOn } = this.getSensorDisplayInfo(sensor);
    const badgeClass = isBinary ? (isOn ? "badge--on" : "badge--off") : "";
    const label = sensor.label ?? sensor.entity.split(".")[1];

    return html`
      <div
        class="sensor-chip"
        title=${sensor.entity}
        @click=${() => this.handleMoreInfo(sensor.entity)}
      >
        <span class="sensor-label">${label}</span>
        <span class="sensor-value ${badgeClass}">
          ${display}${!isBinary && unit ? ` ${unit}` : ""}
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

          <div class="overlay">
            ${this.renderTempLabel("outdoor", outdoor_temp, this.getNumericState(outdoor_temp), "Outdoor temperature")}
            ${this.renderTempLabel("supply", supply_temp, this.getNumericState(supply_temp), "Supply temperature")}
            ${this.renderTempLabel("extract", extract_temp, this.getNumericState(extract_temp), "Extract temperature")}
            ${this.renderTempLabel("exhaust", exhaust_temp, this.getNumericState(exhaust_temp), "Exhaust temperature")}
          </div>
        </div>

        ${this.renderSensorRow()}
      </ha-card>
    `;
  }

  // ── styles ─────────────────────────────────

  static styles = css`
    ha-card {
      overflow: hidden;
    }
    .mini-header {
      padding: 12px 16px 4px;
      display: flex;
      align-items: center;
    }

    .mini-title {
      font-size: 16px;
      font-weight: 500;
      color: var(--secondary-text-color);
      opacity: 0.9;
    }

    .wrap {
      position: relative;
      width: 100%;
    }

    .svg svg {
      width: 100%;
      height: auto;
      display: block;
    }

    .overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .label {
      pointer-events: auto;
      position: absolute;
      font-size: clamp(12px, 1.2vw, 16px);
      font-weight: 500;
      color: var(--primary-text-color);
      padding: 2px 6px;
      border-radius: 6px;
      cursor: pointer;
    }

    .outdoor { top: 7%; left: 3%; }
    .extract { top: 7%; right: 3%; }
    .exhaust { bottom: 26%; left: 3%; }
    .supply  { bottom: 26%; right: 3%; }

    .sensor-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 12px 12px;
    }

    .sensor-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
      cursor: pointer;
    }

    .sensor-label {
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    .sensor-value {
      font-size: 13px;
      font-weight: 600;
    }

    .badge--on {
      background: var(--success-color, #4caf50);
      color: var(--primary-background-color, #fff);
    }

    .badge--off {
      background: var(--disabled-background-color, rgba(0, 0, 0, 0.2));
      color: var(--disabled-text-color, var(--primary-text-color, #000));
    }

    .badge--on,
    .badge--off {
      padding: 2px 6px;
      border-radius: 10px;
    }
  `;
}

// ─────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────

if (!customElements.get("hrv-card")) {
  customElements.define("hrv-card", HRVCard);
}

window.customCards ??= [];
window.customCards.push({
  type: "hrv-card",
  name: "HRV Card",
  description: "Heat Recovery Ventilation visualization card",
  preview: true,
});