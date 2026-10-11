import { type TemplateResult, LitElement, html, css } from "lit";
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

  /** Cached references to the live <stop> elements inside this card's SVG. */
  private _gradientStops?: GradientStops;

  /**
   * All tracked entity IDs. Any state change triggers a re-render; temp entity
   * changes also update the SVG gradients (via updated()).
   * Computed once in setConfig.
   */
  private _trackedEntities: string[] = [];

  // ── hass accessor ──────────────────────────

  set hass(value: HomeAssistant) {
    const previous = this._hass;
    this._hass = value;

    if (!this.config || !this.hasUpdated) {
      this.requestUpdate();
      return;
    }

    const hasChanged = this._trackedEntities.some(
      (e) => previous?.states[e]?.state !== value.states[e]?.state
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
    // Clone the module-level parsed SVG and insert it once, imperatively.
    // Lit will never touch this node again.
    const svgClone = _svgTemplate.cloneNode(true) as SVGSVGElement;
    const container = this.renderRoot.querySelector<HTMLElement>(".svg-container");
    container?.appendChild(svgClone);

    // Cache the stop elements directly so future updates are O(1) attribute sets.
    this._gradientStops = queryGradientStops(svgClone);

    // Apply initial gradient colours if hass data is already available.
    if (this._hass) this.updateSvgGradients();
  }

  protected updated(changedProps: Map<string, unknown>): void {
    if (changedProps.has("_hass")) this.updateSvgGradients();
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
    const { display, unit, isBinary, isOn } = this.getSensorDisplayInfo(sensor);
    const label =
      sensor.label ??
      (sensor.entity.split(".").pop() ?? sensor.entity).replace(/_/g, " ");

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

    /* ── Wrap + svg-container ─────────────────── */

    .wrap {
      position: relative;
      width: 100%;
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