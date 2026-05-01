import { LitElement, html, css } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import hrvSvg from "./assets/card.svg?raw";

class HRVCard extends LitElement {
  config: any;
  hass: any;

  setConfig(config: any) {
    this.config = config;
  }

  // -------------------------
  // Helpers
  // -------------------------

  private getState(entity: string): number {
    const raw = this.hass?.states?.[entity]?.state;
    const num = Number(raw);
    return isNaN(num) ? 0 : num;
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

  const temps = [outdoor, supply, extract, exhaust];

  // -------------------------
  // Dynamic range
  // -------------------------
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);

  // enforce visible spread
  const MIN_VISUAL_RANGE = 1; // °C (tune as needed)
  const range = Math.max(maxTemp - minTemp, MIN_VISUAL_RANGE);

  // -------------------------
  // Normalize (0 = cold, 1 = hot)
  // -------------------------
  const normalizeTemp = (t: number) => (t - minTemp) / range;

  // -------------------------
  // Blue → Red scale
  // -------------------------
  const tempToColor = (t: number) => {
    const r = Math.round(255 * t);
    const g = 0;
    const b = Math.round(255 * (1 - t));
    return `rgb(${r},${g},${b})`;
  };

  // -------------------------
  // Map temps
  // -------------------------
  const outdoorT = normalizeTemp(outdoor);
  const supplyT = normalizeTemp(supply);
  const extractT = normalizeTemp(extract);
  const exhaustT = normalizeTemp(exhaust);

  // -------------------------
  // Helper
  // -------------------------
  const setStop = (el: SVGStopElement, color: string) => {
    el.style.stopColor = color;
    el.style.stopOpacity = "1";
  };

  // -------------------------
  // Gradient 2: outdoor → supply
  // -------------------------
  const grad2 = svg.querySelector("#linearGradient2");
  if (grad2) {
    const stops = grad2.querySelectorAll("stop");

    if (stops[0]) setStop(stops[0] as SVGStopElement, tempToColor(outdoorT));
    if (stops[1]) setStop(stops[1] as SVGStopElement, tempToColor(supplyT));
  }

  // -------------------------
  // Gradient 9: exhaust → extract
  // -------------------------
  const grad9 = svg.querySelector("#linearGradient9");
  if (grad9) {
    const stops = grad9.querySelectorAll("stop");

    if (stops[0]) setStop(stops[0] as SVGStopElement, tempToColor(exhaustT));
    if (stops[1]) setStop(stops[1] as SVGStopElement, tempToColor(extractT));
  }
}

  // -------------------------
  // Render
  // -------------------------

  render() {
    if (!this.hass || !this.config) return html``;

    const get = (e: string) => this.getState(e);

    const supply = get(this.config.supply_temp);
    const extract = get(this.config.extract_temp);
    const outdoor = get(this.config.outdoor_temp);
    const exhaust = get(this.config.exhaust_temp);

    const delta = supply - outdoor;

    return html`
      <ha-card header="HRV System">
        <div class="wrap">

          <!-- INLINE SVG -->
          <div class="svg">
            ${unsafeHTML(hrvSvg)}
          </div>

          <!-- OVERLAY VALUES -->
          <div class="overlay">
            <div class="label outdoor">${outdoor.toFixed(1)}°C</div>
            <div class="label supply">${supply.toFixed(1)}°C</div>
            <div class="label extract">${extract.toFixed(1)}°C</div>
            <div class="label exhaust">${exhaust.toFixed(1)}°C</div>

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
      position: absolute;
      font-size: 14px;
      font-weight: 600;
      // background: rgba(0,0,0,0.6);
      color: white;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .outdoor { top: 9%; left: 4%; }
    .extract { top: 9%; right: 4%; }
    .exhaust { bottom: 27%; left: 4%; }
    .supply { bottom: 27%; right: 4%; }

    .delta {
      position: absolute;
      top: 45%;
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