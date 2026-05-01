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
    supply,
    lerp(supply, outdoor, 0.33),
    lerp(supply, outdoor, 0.66),
    outdoor
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

  const range = Math.max(maxTemp - minTemp, 1);

  const normalize = (t: number) => (t - minTemp) / range;

  // -------------------------
  // Original blue → red mapping
  // -------------------------
  const tempToColor = (t: number) => {
    // anchor palette
    const colors = [
      [0, 0, 255],     // blue (T1)
      [0, 255, 255],   // cyan (T2)
      [255, 165, 0],   // orange (T3)
      [255, 0, 0]      // red (T4)
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