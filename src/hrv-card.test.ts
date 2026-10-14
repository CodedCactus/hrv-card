import { describe, it, expect, beforeAll } from "vitest";
import "./hrv-card";

type TempSnapshot = { out: number; sup: number; ext: number; exh: number };

const CONFIG = {
  outdoor_temp: "sensor.out",
  supply_temp: "sensor.sup",
  extract_temp: "sensor.ext",
  exhaust_temp: "sensor.exh",
};

const makeHass = (t: TempSnapshot) => ({
  states: {
    "sensor.out": { state: String(t.out), attributes: { unit_of_measurement: "°C" } },
    "sensor.sup": { state: String(t.sup), attributes: { unit_of_measurement: "°C" } },
    "sensor.ext": { state: String(t.ext), attributes: { unit_of_measurement: "°C" } },
    "sensor.exh": { state: String(t.exh), attributes: { unit_of_measurement: "°C" } },
    "light.unrelated": { state: "off", attributes: {} },
  } as Record<string, { state: string; attributes: Record<string, unknown> }>,
});

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
  g.cancelAnimationFrame ??= (id: number) => clearTimeout(id);
  g.Path2D ??= class {};

  // jsdom does not implement SVG geometry measurement.
  const svgProto =
    (g.SVGPathElement as { prototype: Record<string, unknown> } | undefined)
      ?.prototype ??
    (g.SVGElement as { prototype: Record<string, unknown> } | undefined)?.prototype;
  if (svgProto) {
    svgProto.getTotalLength ??= () => 1000;
    svgProto.getPointAtLength ??= (len: number) => ({ x: len, y: 0 });
  }
});

// Subclass only to observe render counts; the card class is registered by the
// import side effect and is not otherwise exported.
const ProbeCard = class extends (customElements.get("hrv-card") as any) {
  renderCount = 0;
  render(): unknown {
    this.renderCount++;
    return super.render();
  }
};
if (!customElements.get("probe-hrv-card")) {
  customElements.define("probe-hrv-card", ProbeCard as unknown as CustomElementConstructor);
}

const stopColor = (el: any, gradientId: string, index: number): string | null =>
  el.shadowRoot.querySelectorAll(`#${gradientId} stop`)[index]?.getAttribute("stop-color") ??
  null;

const createCard = async (config: unknown = CONFIG): Promise<any> => {
  const el = document.createElement("probe-hrv-card") as any;
  document.body.appendChild(el);
  el.setConfig(config);
  el.hass = makeHass({ out: 5, sup: 30, ext: 22, exh: 10 });
  await el.updateComplete;
  return el;
};

describe("HRVCard", () => {
  it("updates SVG gradients when a tracked temperature changes", async () => {
    const el = await createCard();
    const before = stopColor(el, "gradientPath1", 1);

    // Shifting the path-2 temps moves the global range, so path-1 stops recolor.
    el.hass = makeHass({ out: 5, sup: 30, ext: 40, exh: 25 });
    await el.updateComplete;

    expect(stopColor(el, "gradientPath1", 1)).not.toBe(before);
    el.remove();
  });

  it("skips re-rendering when only untracked entities change", async () => {
    const el = await createCard();
    const rendersBefore = el.renderCount;

    const next = makeHass({ out: 5, sup: 30, ext: 22, exh: 10 });
    next.states["light.unrelated"] = { state: "on", attributes: {} };
    el.hass = next;
    await el.updateComplete;

    expect(el.renderCount).toBe(rendersBefore);
    el.remove();
  });

  it("re-renders when a sensor chip's unit attribute changes", async () => {
    const el = document.createElement("probe-hrv-card") as any;
    document.body.appendChild(el);
    el.setConfig({ ...CONFIG, sensors: [{ entity: "sensor.flow" }] });

    const first = makeHass({ out: 5, sup: 30, ext: 22, exh: 10 });
    first.states["sensor.flow"] = { state: "42", attributes: { unit_of_measurement: "m³/h" } };
    el.hass = first;
    await el.updateComplete;

    const rendersBefore = el.renderCount;
    const second = makeHass({ out: 5, sup: 30, ext: 22, exh: 10 });
    second.states["sensor.flow"] = { state: "42", attributes: { unit_of_measurement: "m3/h" } };
    el.hass = second;
    await el.updateComplete;

    expect(el.renderCount).toBe(rendersBefore + 1);
    el.remove();
  });

  it("rebuilds the canvas and restarts animation after reconnect", async () => {
    const el = await createCard();
    expect(el._canvas).toBeTruthy();
    expect(el._canvas.parentNode.tagName).toBe("foreignObject");

    el.remove();
    expect(el._canvas).toBeUndefined();

    document.body.appendChild(el);
    expect(el._canvas).toBeTruthy();
    expect(el._canvas.parentNode.tagName).toBe("foreignObject");
    expect(el._animationFrame).toBeDefined();
    el.remove();
  });

  it("applies animation config changes without a hass update", async () => {
    const el = await createCard();
    expect(el._animationFrame).toBeDefined();

    el.setConfig({ ...CONFIG, animation: false });
    await el.updateComplete;
    expect(el._animationFrame).toBeUndefined();

    el.setConfig({ ...CONFIG, animation: true });
    await el.updateComplete;
    expect(el._animationFrame).toBeDefined();
    el.remove();
  });

  it("parses the crossing mask path from the SVG", async () => {
    const el = await createCard();
    expect(el._maskPath).toBeTruthy();
    el.remove();
  });

  it("rejects malformed sensor config", () => {
    const el = document.createElement("probe-hrv-card") as any;
    expect(() => el.setConfig({ ...CONFIG, sensors: "nope" })).toThrow(/sensors/);
    expect(() => el.setConfig({ ...CONFIG, sensors: [{ label: "x" }] })).toThrow(/entity/);
    expect(() => el.setConfig({ ...CONFIG, sensors: [{ entity: "  " }] })).toThrow(/entity/);
  });

  it("renders temperature labels with the entity's unit", async () => {
    const el = document.createElement("probe-hrv-card") as any;
    document.body.appendChild(el);
    el.setConfig(CONFIG);
    const hass = makeHass({ out: 68, sup: 86, ext: 72, exh: 50 });
    hass.states["sensor.out"].attributes = { unit_of_measurement: "°F" };
    el.hass = hass;
    await el.updateComplete;

    expect(el.shadowRoot.querySelector(".outdoor .temp-unit")?.textContent).toBe("°F");
    el.remove();
  });

  it("renders labels and chips as accessible buttons", async () => {
    const el = document.createElement("probe-hrv-card") as any;
    document.body.appendChild(el);
    el.setConfig({ ...CONFIG, sensors: [{ entity: "sensor.flow" }] });
    el.hass = makeHass({ out: 5, sup: 30, ext: 22, exh: 10 });
    await el.updateComplete;

    expect(el.shadowRoot.querySelectorAll("button.label").length).toBe(4);
    const chip = el.shadowRoot.querySelector("button.sensor-chip");
    expect(chip).toBeTruthy();
    expect(chip?.getAttribute("type")).toBe("button");
    el.remove();
  });
});
