import { LitElement, html, css } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
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
    this.updateSvgColors();
  }

  updated() {
    this.updateSvgColors();
  }

  private updateSvgColors() {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg) return;

    // -------------------------
    // Read sensors
    // -------------------------
    const outdoor = this.getState(this.config.outdoor_temp);
    const supply = this.getState(this.config.supply_temp);
    const extract = this.getState(this.config.extract_temp);
    const exhaust = this.getState(this.config.exhaust_temp);

    // -------------------------
    // Create 4-point "flow gradients"
    // (this is your original design restored)
    // -------------------------
    const lerp = (a: number, b: number, t: number) =>
      a + (b - a) * t;

    // -------------------------
    // Flow 1: outdoor → supply (TL → BR)
    // -------------------------
    const path1Temps = [
      outdoor,
      lerp(outdoor, supply, 0.33),
      lerp(outdoor, supply, 0.66),
      supply
    ];

    // -------------------------
    // Flow 2: extract → exhaust (TR → BL)
    // -------------------------
    const path2Temps = [
      exhaust,
      lerp(exhaust, extract, 0.33),
      lerp(exhaust, extract, 0.66),
      extract
    ];

    const allTemps = [...path1Temps, ...path2Temps];

    // -------------------------
    // Shared normalization (important for correct color comparison)
    // -------------------------
    const minTemp = Math.min(...allTemps);
    const maxTemp = Math.max(...allTemps);

    const range = Math.max(maxTemp - minTemp, 0.1);

    const normalize = (t: number) => (t - minTemp) / range;

    // -------------------------
    // Original blue → red mapping
    // -------------------------
    const tempToColor = (t: number) => {
      const colors = [
        [59, 76, 192],    // cold
        [120, 180, 220],  // cool
        [245, 160, 105],  // warm
        [180, 4, 38]      // hot
      ];

      // clamp 0–1
      t = Math.min(1, Math.max(0, t));

      const segments = colors.length - 1;
      const scaled = t * segments;

      const i = Math.floor(scaled);
      const f = scaled - i;

      const a = colors[i];
      const b = colors[Math.min(i + 1, segments)];

      const lerp = (x: number, y: number) => Math.round(x + (y - x) * f);

      const r = lerp(a[0], b[0]);
      const g = lerp(a[1], b[1]);
      const b2 = lerp(a[2], b[2]);

      return `rgb(${r},${g},${b2})`;
    };

    // -------------------------
    // Build 4-stop gradient
    // -------------------------
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

    // -------------------------
    // Apply to SVG
    // -------------------------
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

    const delta = supply - outdoor;
    const header = this.config.title || "HRV System";

    return html`
      <ha-card header="${header}">
        <div class="wrap">

          <!-- INLINE SVG -->
          <div class="svg">
            ${unsafeHTML(hrvSvg)}
          </div>

          <!-- OVERLAY VALUES -->
          <div class="overlay">
            <div class="label outdoor" @click=${() => this.handleClick(this.config.outdoor_temp)}>${outdoor.toFixed(1)}°C</div>
            <div class="label supply" @click=${() => this.handleClick(this.config.supply_temp)}>${supply.toFixed(1)}°C</div>
            <div class="label extract" @click=${() => this.handleClick(this.config.extract_temp)}>${extract.toFixed(1)}°C</div>
            <div class="label exhaust" @click=${() => this.handleClick(this.config.exhaust_temp)}>${exhaust.toFixed(1)}°C</div>

            <div class="delta">
              Δ ${delta.toFixed(1)}°C
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
      // background: rgba(0,0,0,0.6);
      color: white;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .label:hover {
      color: rgb(186, 186, 186)
    }

    .outdoor { top: 9%; left: 4%; }
    .extract { top: 9%; right: 4%; }
    .exhaust { bottom: 27%; left: 4%; }
    .supply { bottom: 27%; right: 4%; }

    .delta {
      position: absolute;
      top: 30%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 14px;
      font-weight: bold;
      background: rgba(0,0,0,0.75);
      color: white;
      padding: 4px 8px;
      border-radius: 6px;
    }
  `;
}

customElements.define("hrv-card", HRVCard);

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