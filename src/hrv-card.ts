import { LitElement, html, css } from "lit";
import hrvSvg from "./assets/card.svg?raw";

class HRVCard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object }
    };
  }

  hass: any;
  config: any;

  // -------------------------
  // Config
  // -------------------------

  setConfig(config: any) {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid card configuration");
    }

    if (
      !config.outdoor_temp ||
      !config.supply_temp ||
      !config.extract_temp ||
      !config.exhaust_temp
    ) {
      throw new Error(
        "HRV Card requires outdoor_temp, supply_temp, extract_temp, and exhaust_temp"
      );
    }

    this.config = { ...config };
  }

  getCardSize() {
    return 3;
  }

  // -------------------------
  // Helpers
  // -------------------------

  private getState(entity: string): number {
    const raw = this.hass?.states?.[entity]?.state;
    const num = Number(raw);
    return isNaN(num) ? 0 : num;
  }

  private handleClick(entity: string) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: entity },
        bubbles: true,
        composed: true,
      })
    );
  }

  // -------------------------
  // Lifecycle
  // -------------------------

  firstUpdated() {
    const container = this.renderRoot.querySelector("#svgContainer");
    if (container) {
      container.innerHTML = hrvSvg;
    }

    this.updateSvgColors();
  }

  updated(changedProps: Map<string, any>) {
    if (!changedProps.has("hass")) return;

    const oldHass = changedProps.get("hass");
    if (!oldHass) {
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
        this.hass.states[entity]?.state
      );
    });

    if (hasChanged) {
      this.updateSvgColors();
    }
  }

  // -------------------------
  // SVG Coloring
  // -------------------------

  private updateSvgColors() {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg) return;

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
      const colors = [
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

      const lerp = (x: number, y: number) =>
        Math.round(x + (y - x) * f);

      return `rgb(${lerp(a[0], b[0])},${lerp(a[1], b[1])},${lerp(a[2], b[2])})`;
    };

    const applyGradient = (id: string, temps: number[]) => {
      const grad = svg.querySelector(`#${id}`) as SVGLinearGradientElement;
      if (!grad) return;

      grad.innerHTML = "";

      temps.forEach((t, i) => {
        const stop = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "stop"
        );

        const offset = (i / (temps.length - 1)) * 100;

        stop.setAttribute("offset", `${offset}%`);
        stop.setAttribute("stop-color", tempToColor(normalize(t)));

        grad.appendChild(stop);
      });
    };

    applyGradient("gradientPath1", path1Temps);
    applyGradient("gradientPath2", path2Temps);
  }

  // -------------------------
  // Render
  // -------------------------

  render() {
    if (!this.hass || !this.config) {
      return html``;
    }

    const get = (e: string) => this.getState(e);

    const supply = get(this.config.supply_temp);
    const extract = get(this.config.extract_temp);
    const outdoor = get(this.config.outdoor_temp);
    const exhaust = get(this.config.exhaust_temp);

    return html`
      <ha-card header="${this.config.title || "HRV System"}">
        <div class="wrap">

          <!-- SVG injected once -->
          <div class="svg" id="svgContainer"></div>

          <!-- Overlay values -->
          <div class="overlay">
            <div class="label outdoor" @click=${() => this.handleClick(this.config.outdoor_temp)}>
              ${outdoor.toFixed(1)}°C
            </div>
            <div class="label supply" @click=${() => this.handleClick(this.config.supply_temp)}>
              ${supply.toFixed(1)}°C
            </div>
            <div class="label extract" @click=${() => this.handleClick(this.config.extract_temp)}>
              ${extract.toFixed(1)}°C
            </div>
            <div class="label exhaust" @click=${() => this.handleClick(this.config.exhaust_temp)}>
              ${exhaust.toFixed(1)}°C
            </div>
          </div>

        </div>
      </ha-card>
    `;
  }

  // -------------------------
  // Styles
  // -------------------------

  static styles = css`
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
      font-size: 14px;
      font-weight: 600;
      color: white;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .label:hover {
      color: rgb(186, 186, 186);
    }

    .outdoor { top: 9%; left: 4%; }
    .extract { top: 9%; right: 4%; }
    .exhaust { bottom: 27%; left: 4%; }
    .supply { bottom: 27%; right: 4%; }
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