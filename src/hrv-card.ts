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

  outdoor_temp: string;
  supply_temp: string;
  extract_temp: string;
  exhaust_temp: string;

  // Optional additional sensors
  supply_flow?: string;
  exhaust_flow?: string;
  bypass?: string;
  heater?: string;
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

    const required: (keyof HRVCardConfig)[] = [
      "outdoor_temp",
      "supply_temp",
      "extract_temp",
      "exhaust_temp"
    ];

    for (const key of required) {
      if (!config[key]) {
        throw new Error(
          `HRV Card requires: ${required.join(", ")}`
        );
      }
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

  private getState(entity: string): number {
    const raw = this.hass?.states?.[entity]?.state;
    const num = Number(raw);
    return Number.isNaN(num) ? 0 : num;
  }

  private getRawState(entity: string): string {
    return this.hass?.states?.[entity]?.state ?? "—";
  }

  private getBinaryState(entity: string): boolean | null {
    const raw = this.hass?.states?.[entity]?.state;
    if (raw === "on") return true;
    if (raw === "off") return false;
    return null;
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
   * SVG coloring
   * -------------------------
   */

  private updateSvgColors() {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg || !this.config) return;

    const outdoor = this.getState(this.config.outdoor_temp);
    const supply = this.getState(this.config.supply_temp);
    const extract = this.getState(this.config.extract_temp);
    const exhaust = this.getState(this.config.exhaust_temp);

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
   * Sensor row rendering
   * -------------------------
   */

  private renderSensorRow() {
    if (!this.config) return html``;

    const { bypass, heater, supply_flow, exhaust_flow } = this.config;
    if (!bypass && !heater && !supply_flow && !exhaust_flow) return html``;

    return html`
    <div class="sensor-row">
      ${bypass
        ? html`
            <div
              class="sensor-chip"
              @click=${() => this.handleClick(bypass)}
              title=${bypass}
            >
              <span class="sensor-label">Bypass</span>
              <span
                class="sensor-value badge ${this.getBinaryState(bypass)
            ? "badge--on"
            : "badge--off"}"
              >
                ${this.getBinaryState(bypass) ? "Open" : "Closed"}
              </span>
            </div>
          `
        : ""}

      ${heater
        ? html`
            <div
              class="sensor-chip"
              @click=${() => this.handleClick(heater)}
              title=${heater}
            >
              <span class="sensor-label">Heater</span>
              <span class="sensor-value">${this.getRawState(heater)}</span>
            </div>
          `
        : ""}

      ${supply_flow
        ? html`
            <div
              class="sensor-chip"
              @click=${() => this.handleClick(supply_flow)}
              title=${supply_flow}
            >
              <span class="sensor-label">Supply</span>
              <span class="sensor-value">
                ${this.getRawState(supply_flow)} m³/h
              </span>
            </div>
          `
        : ""}

      ${exhaust_flow
        ? html`
            <div
              class="sensor-chip"
              @click=${() => this.handleClick(exhaust_flow)}
              title=${exhaust_flow}
            >
              <span class="sensor-label">Exhaust</span>
              <span class="sensor-value">
                ${this.getRawState(exhaust_flow)} m³/h
              </span>
            </div>
          `
        : ""}
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

    const supply = get(this.config.supply_temp);
    const extract = get(this.config.extract_temp);
    const outdoor = get(this.config.outdoor_temp);
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
            <div
              class="label outdoor"
              @click=${() =>
        this.handleClick(this.config!.outdoor_temp)}
            >
              ${outdoor.toFixed(1)}°C
            </div>

            <div
              class="label supply"
              @click=${() =>
        this.handleClick(this.config!.supply_temp)}
            >
              ${supply.toFixed(1)}°C
            </div>

            <div
              class="label extract"
              @click=${() =>
        this.handleClick(this.config!.extract_temp)}
            >
              ${extract.toFixed(1)}°C
            </div>

            <div
              class="label exhaust"
              @click=${() =>
        this.handleClick(this.config!.exhaust_temp)}
            >
              ${exhaust.toFixed(1)}°C
            </div>
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
      letter-spacing: 0.3px;
      text-transform: none;
      line-height: 1;
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
      box-shadow: var(--ha-card-box-shadow, none);
      backdrop-filter: var(--ha-card-backdrop-filter, none);
    }

    .label:hover {
      color: var(--primary-color);
    }

    .outdoor {
      top: 7%;
      left: 3%;
    }

    .extract {
      top: 7%;
      right: 3%;
    }

    .exhaust {
      bottom: 26%;
      left: 3%;
    }

    .supply {
      bottom: 26%;
      right: 3%;
    }

    /* ---- Sensor row ---- */
    .sensor-row {
      display: flex;
      flex-wrap: wrap;
      flex-direction: row;
      gap: 8px;
      padding: 8px 12px 12px;
    }

    .sensor-chip {
      display: flex;
      align-items: center;
      gap: 6px;

      flex: 0 1 auto;        
      min-width: 60px;
      max-width: 100%;

      padding: 6px 10px;
      border-radius: 8px;
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .sensor-chip:hover {
      background: var(--divider-color, rgba(0, 0, 0, 0.12));
    }

    .sensor-icon {
      font-size: 16px;
      line-height: 1;
      flex-shrink: 0;
    }

    .sensor-label {
      font-size: 12px;
      color: var(--secondary-text-color, #888);
      flex: 1;
      white-space: nowrap;
    }

    .sensor-value {
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color, #333);
      white-space: nowrap;
    }

    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 10px;
      white-space: nowrap;
    }

    .badge--on {
      background: var(--success-color, #4caf50);
      color: #fff;
    }

    .badge--off {
      background: var(--disabled-color, rgba(0, 0, 0, 0.2));
      color: var(--secondary-text-color, #888);
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