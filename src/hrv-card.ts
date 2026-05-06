import { LitElement, html, css } from "lit";
import hrvSvg from "./assets/card.svg?raw";

/**
 * -------------------------
 * Home Assistant types
 * -------------------------
 */

interface HomeAssistantState {
  state: string;
  attributes?: Record<string, unknown>;
}

interface HomeAssistant {
  states: Record<string, HomeAssistantState | undefined>;
}

/**
 * -------------------------
 * Card config
 * -------------------------
 */

export interface HRVCardConfig {
  title?: string;

  // --- fixed HRV thermal model ---
  outdoor_temp: string;
  supply_temp: string;
  extract_temp: string;
  exhaust_temp: string;

  // --- generic sensors ---
  sensors: SensorConfig[];
}

interface SensorConfig {
  entity: string;
  label?: string;

  /** optional hint for binary formatting */
  format?: "binary" | "text";

  /** optional override */
  unit?: string;
}

/**
 * -------------------------
 * Component
 * -------------------------
 */

class HRVCard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object }
    };
  }

  hass?: HomeAssistant;
  config?: HRVCardConfig;

  /**
   * -------------------------
   * Config validation
   * -------------------------
   */
  setConfig(config: HRVCardConfig) {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid card configuration");
    }

    const required = [
      "outdoor_temp",
      "supply_temp",
      "extract_temp",
      "exhaust_temp"
    ] as const;

    for (const key of required) {
      if (!config[key]) {
        throw new Error(
          `HRV Card requires: ${required.join(", ")}`
        );
      }
    }

    if (!Array.isArray(config.sensors)) {
      throw new Error("HRV Card requires sensors array");
    }

    this.config = { ...config };
  }

  getCardSize() {
    return 3;
  }

  /**
   * -------------------------
   * Helpers
   * -------------------------
   */

  private renderTempLabel(
    cls: string,
    entity: string,
    value: number,
    label?: string
  ) {
    return html`
        <div
          class="label ${cls}"
          title=${label ?? entity}
          @click=${() => this.handleClick(entity)}
        >
          ${value.toFixed(1)}°C
        </div>
      `;
  }

  private getState(entity: string): number {
    const raw = this.hass?.states?.[entity]?.state;
    const num = Number(raw);
    return Number.isNaN(num) ? 0 : num;
  }

  private formatValue(value: string, isBinary: boolean): string {
    if (isBinary) return value;

    const num = Number(value);
    if (Number.isNaN(num)) return value;

    return num.toFixed(1);
  }

  private getDeviceClass(entity: string): string | undefined {
    return (this.hass?.states?.[entity]?.attributes as any)
      ?.device_class;
  }

  private handleClick(entity: string) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: entity },
        bubbles: true,
        composed: true
      })
    );
  }

  /**
   * -------------------------
   * Lifecycle
   * -------------------------
   */

  firstUpdated() {
    const container = this.renderRoot.querySelector("#svgContainer");
    if (container) {
      container.innerHTML = hrvSvg;
    }

    this.updateSvgColors();
  }

  updated(changedProps: Map<string, unknown>) {
    if (!changedProps.has("hass")) return;

    const oldHass = changedProps.get("hass") as HomeAssistant | undefined;

    if (!oldHass || !this.hass || !this.config) {
      this.updateSvgColors();
      return;
    }

    const entities = [
      this.config.outdoor_temp,
      this.config.supply_temp,
      this.config.extract_temp,
      this.config.exhaust_temp
    ];

    const hasChanged = entities.some((entity) => {
      return (
        oldHass.states[entity]?.state !==
        this.hass?.states[entity]?.state
      );
    });

    if (hasChanged) {
      this.updateSvgColors();
    }
  }

  /**
   * -------------------------
   * SVG coloring (HRV model unchanged)
   * -------------------------
   */

  private updateSvgColors() {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg || !this.config) return;

    const get = (e: string) => this.getState(e);

    const outdoor = get(this.config.outdoor_temp);
    const supply = get(this.config.supply_temp);
    const extract = get(this.config.extract_temp);
    const exhaust = get(this.config.exhaust_temp);

    const lerp = (a: number, b: number, t: number) =>
      a + (b - a) * t;

    const path1Temps = [
      outdoor,
      lerp(outdoor, supply, 0.33),
      lerp(outdoor, supply, 0.66),
      supply
    ];

    const path2Temps = [
      exhaust,
      lerp(exhaust, extract, 0.33),
      lerp(exhaust, extract, 0.66),
      extract
    ];

    const allTemps = [...path1Temps, ...path2Temps];

    const minTemp = Math.min(...allTemps);
    const maxTemp = Math.max(...allTemps);
    const range = Math.max(maxTemp - minTemp, 0.1);

    const normalize = (t: number) => (t - minTemp) / range;

    const tempToColor = (t: number) => {
      const colors: [number, number, number][] = [
        [59, 76, 192],
        [120, 180, 220],
        [245, 160, 105],
        [180, 4, 38]
      ];

      t = Math.min(1, Math.max(0, t));

      const segments = colors.length - 1;
      const scaled = t * segments;

      const i = Math.floor(scaled);
      const f = scaled - i;

      const a = colors[i];
      const b = colors[Math.min(i + 1, segments)];

      const lerpC = (x: number, y: number) =>
        Math.round(x + (y - x) * f);

      return `rgb(${lerpC(a[0], b[0])},${lerpC(
        a[1],
        b[1]
      )},${lerpC(a[2], b[2])})`;
    };

    const applyGradient = (id: string, temps: number[]) => {
      const grad = svg.querySelector(
        `#${id}`
      ) as SVGLinearGradientElement | null;

      if (!grad) return;

      grad.innerHTML = "";

      temps.forEach((t, i) => {
        const stop = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "stop"
        );

        const offset = (i / (temps.length - 1)) * 100;

        stop.setAttribute("offset", `${offset}%`);
        stop.setAttribute(
          "stop-color",
          tempToColor(normalize(t))
        );

        grad.appendChild(stop);
      });
    };

    applyGradient("gradientPath1", path1Temps);
    applyGradient("gradientPath2", path2Temps);
  }

  /**
   * -------------------------
   * Sensor row (generic + device_class aware)
   * -------------------------
   */

  private renderSensorRow() {
    const sensors = this.config?.sensors ?? [];
    if (!sensors.length) return html``;

    return html`
      <div class="sensor-row">
        ${sensors.map((s) => {
      const state =
        this.hass?.states?.[s.entity]?.state ?? "—";

      const unit =
        s.unit ??
        (this.hass?.states?.[s.entity]?.attributes as any)
          ?.unit_of_measurement ??
        "";

      const deviceClass = this.getDeviceClass(s.entity);

      const isBinary =
        s.format === "binary" ||
        state === "on" ||
        state === "off";

      const isOpening = deviceClass === "opening";

      const display = isBinary
        ? state === "on"
          ? isOpening
            ? "Open"
            : "On"
          : isOpening
            ? "Closed"
            : "Off"
        : this.formatValue(state, isBinary);

      const showBadge = isBinary;

      const isOn = state === "on";

      const badgeClass = showBadge
        ? isOn
          ? "badge--on"
          : "badge--off"
        : "";

      return html`
            <div
              class="sensor-chip"
              @click=${() => this.handleClick(s.entity)}
              title=${s.entity}
            >
              <span class="sensor-label">
                ${s.label ?? s.entity.split(".")[1]}
              </span>

              <span class="sensor-value ${badgeClass}">
                ${display}${!isBinary && unit ? ` ${unit}` : ""}
              </span>
            </div>
          `;
    })}
      </div>
    `;
  }

  /**
   * -------------------------
   * Render
   * -------------------------
   */

  render() {
    if (!this.hass || !this.config) return html``;

    const get = (e: string) => this.getState(e);

    const outdoor = get(this.config.outdoor_temp);
    const supply = get(this.config.supply_temp);
    const extract = get(this.config.extract_temp);
    const exhaust = get(this.config.exhaust_temp);

    return html`
      <ha-card>
        <div class="mini-header">
          <span class="mini-title">
            ${this.config.title || "HRV System"}
          </span>
        </div>

        <div class="wrap">
          <div class="svg" id="svgContainer"></div>

          <div class="overlay">
            ${this.renderTempLabel("outdoor", this.config!.outdoor_temp, outdoor, "Outdoor temperature")}
            ${this.renderTempLabel("supply", this.config!.supply_temp, supply, "Supply temperature")}
            ${this.renderTempLabel("extract", this.config!.extract_temp, extract, "Extract temperature")}
            ${this.renderTempLabel("exhaust", this.config!.exhaust_temp, exhaust, "Exhaust temperature")}
          </div>
        </div>

        ${this.renderSensorRow()}
      </ha-card>
    `;
  }

  /**
   * -------------------------
   * Styles
   * -------------------------
   */

  static styles = css`
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
      font-size: 16px;
      font-weight: 500;
      color: var(--primary-text-color);
      padding: 2px 6px;
      border-radius: 6px;
      cursor: pointer;
    }

    .outdoor { top: 7%; left: 3%; }
    .extract { top: 7%; right: 3%; }
    .exhaust { bottom: 26%; left: 3%; }
    .supply { bottom: 26%; right: 3%; }

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
      background: #4caf50;
      color: white;
      padding: 2px 6px;
      border-radius: 10px;
    }

    .badge--off {
      background: rgba(0,0,0,0.2);
      padding: 2px 6px;
      border-radius: 10px;
    }
  `;
}

if (!customElements.get("hrv-card")) {
  customElements.define("hrv-card", HRVCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "hrv-card",
  name: "HRV Card",
  description: "Heat Recovery Ventilation visualization card",
  preview: true
});