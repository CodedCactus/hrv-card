// Test setup: stub the Home Assistant web components the card references so
// the element can be instantiated without the full HA runtime.
import { LitElement, html } from "lit";

if (!customElements.get("ha-card")) {
  customElements.define(
    "ha-card",
    class HACardStub extends LitElement {
      render() {
        return html`<slot></slot>`;
      }
    }
  );
}

// jsdom does not implement the canvas 2D API. A minimal no-op context keeps
// the particle/mask code exercised without noisy "not implemented" warnings.
const noop = () => {};

const canvasContext = {
  fillStyle: "",
  save: noop,
  restore: noop,
  setTransform: noop,
  clearRect: noop,
  scale: noop,
  fill: noop,
  beginPath: noop,
  arc: noop,
  getImageData: (_x: number, _y: number, width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
  }),
} as unknown as CanvasRenderingContext2D;

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() =>
    canvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// Lit prints a one-off "dev mode" warning the first time a component renders.
// It is expected under Vitest, so mark it as already issued.
const litGlobal = globalThis as typeof globalThis & {
  litIssuedWarnings?: Set<string>;
};
litGlobal.litIssuedWarnings ??= new Set();
litGlobal.litIssuedWarnings.add("dev-mode");
