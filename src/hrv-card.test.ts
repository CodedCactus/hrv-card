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

const makeParticle = (): any => ({
  progress: 0.5,
  speed: 0,
  size: 4,
  pathIndex: 0,
  offset: 0,
  trail: Array.from({ length: 24 }, () => ({
    progress: 0,
    offset: 0,
    time: 0,
  })),
  trailHead: 0,
  trailCount: 0,
});

const packMask = (cells: number[]): Uint8Array => {
  const bitmap = new Uint8Array(Math.ceil(cells.length / 8));
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) bitmap[i >> 3] |= 1 << (i & 7);
  }
  return bitmap;
};

describe("HRVCard", () => {
  it("reports sizing for masonry and Sections layouts", () => {
    const el = document.createElement("probe-hrv-card") as any;

    expect(el.getCardSize()).toBe(2);
    expect(el.getGridOptions()).toEqual({
      columns: 12,
      rows: "auto",
      min_columns: 6,
      max_columns: 12,
    });
    expect(el.getLayoutOptions()).toEqual({
      grid_columns: 12,
      grid_rows: "auto",
      grid_min_columns: 6,
      grid_max_columns: 12,
    });

    el.setConfig({ ...CONFIG, sensors: [{ entity: "sensor.flow" }] });
    expect(el.getCardSize()).toBe(3);
  });

  it("provides a visual editor and a valid stub configuration", () => {
    const Card = customElements.get("hrv-card") as any;
    const editor = Card.getConfigElement();

    expect(editor.tagName.toLowerCase()).toBe("hrv-card-editor");

    const stub = Card.getStubConfig(
      makeHass({ out: 5, sup: 30, ext: 22, exh: 10 }),
      [
        "sensor.outdoor_temp",
        "sensor.supply_temp",
        "sensor.extract_temp",
        "sensor.exhaust_temp",
      ],
      []
    );
    expect(stub).toEqual({
      outdoor_temp: "sensor.outdoor_temp",
      supply_temp: "sensor.supply_temp",
      extract_temp: "sensor.extract_temp",
      exhaust_temp: "sensor.exhaust_temp",
    });
  });

  it("emits config changes from the visual editor", async () => {
    const editor = document.createElement("hrv-card-editor") as any;
    document.body.appendChild(editor);
    editor.hass = makeHass({ out: 5, sup: 30, ext: 22, exh: 10 });
    editor.setConfig({ ...CONFIG, title: "Existing", sensors: [] });
    await editor.updateComplete;

    expect(editor.shadowRoot.querySelectorAll("ha-entity-picker").length).toBe(4);

    let emitted: any;
    editor.addEventListener("config-changed", (event: any) => {
      emitted = event.detail.config;
    });

    const outdoorPicker = editor.shadowRoot.querySelectorAll(
      "ha-entity-picker"
    )[0];
    outdoorPicker.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: "sensor.new_outdoor" },
        bubbles: true,
        composed: true,
      })
    );
    expect(emitted?.outdoor_temp).toBe("sensor.new_outdoor");

    editor.shadowRoot.querySelector("button.add-sensor").click();
    await editor.updateComplete;
    expect(editor.shadowRoot.querySelectorAll(".sensor-card").length).toBe(1);

    const sensorPicker = editor.shadowRoot.querySelector(
      ".sensor-card ha-entity-picker"
    );
    sensorPicker.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: "sensor.humidity" },
        bubbles: true,
        composed: true,
      })
    );
    expect(emitted?.sensors?.[0]?.entity).toBe("sensor.humidity");

    const sensorCard = editor.shadowRoot.querySelector(".sensor-card");
    const formatSelect = sensorCard.querySelector(
      ".select-field select"
    ) as HTMLSelectElement;
    formatSelect.value = "number";
    formatSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await editor.updateComplete;

    const decimalsField = editor.shadowRoot.querySelector(
      ".decimals-field"
    ) as HTMLInputElement;
    expect(decimalsField).toBeTruthy();
    decimalsField.value = "2";
    decimalsField.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    expect(emitted?.sensors?.[0]?.decimals).toBe(2);
    editor.remove();
  });

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

  it("rebuilds the canvas and resumes animation after reconnect", async () => {
    const el = await createCard();
    expect(el._engine._canvas).toBeTruthy();
    expect(el._engine._canvas.parentNode.tagName).toBe("foreignObject");

    const particle = makeParticle();
    el._engine._particles = [particle];

    el.remove();
    expect(el._engine._canvas).toBeUndefined();
    expect(el._engine._particles).toContain(particle);

    document.body.appendChild(el);
    expect(el._engine._canvas).toBeTruthy();
    expect(el._engine._canvas.parentNode.tagName).toBe("foreignObject");
    expect(el._engine._animationFrame).toBeDefined();
    expect(el._engine._particles).toContain(particle);
    el.remove();
  });

  it("applies animation config changes without a hass update", async () => {
    const el = await createCard();
    expect(el._engine._animationFrame).toBeDefined();

    el.setConfig({ ...CONFIG, animation: false });
    await el.updateComplete;
    expect(el._engine._animationFrame).toBeUndefined();

    el.setConfig({ ...CONFIG, animation: true });
    await el.updateComplete;
    expect(el._engine._animationFrame).toBeDefined();
    el.remove();
  });

  it("pauses animation when reduced motion is requested", async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (() => media) as typeof window.matchMedia;

    try {
      const el = await createCard();
      expect(el._engine._animationFrame).toBeDefined();

      const setReducedMotion = (matches: boolean) => {
        (media as { matches: boolean }).matches = matches;
        for (const listener of listeners) {
          listener({ matches, media: media.media } as MediaQueryListEvent);
        }
      };

      setReducedMotion(true);
      expect(el._engine._animationFrame).toBeUndefined();

      setReducedMotion(false);
      expect(el._engine._animationFrame).toBeDefined();
      el.remove();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("pauses animation while the card is offscreen or the page is hidden", async () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }

    const g = globalThis as Record<string, unknown>;
    const originalObserver = g.IntersectionObserver;
    g.IntersectionObserver = MockIntersectionObserver;
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");

    try {
      const el = await createCard();
      expect(el._engine._animationFrame).toBeDefined();

      const particle = makeParticle();
      el._engine._particles = [particle];

      observerCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
      expect(el._engine._animationFrame).toBeUndefined();
      expect(el._engine._particles).toContain(particle);

      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
      expect(el._engine._animationFrame).toBeDefined();
      expect(el._engine._particles).toContain(particle);

      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(el._engine._animationFrame).toBeUndefined();
      expect(el._engine._particles).toContain(particle);

      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(el._engine._animationFrame).toBeDefined();
      expect(el._engine._particles).toContain(particle);
      el.remove();
    } finally {
      if (hiddenDescriptor) {
        Object.defineProperty(document, "hidden", hiddenDescriptor);
      }
      if (originalObserver === undefined) {
        delete g.IntersectionObserver;
      } else {
        g.IntersectionObserver = originalObserver;
      }
    }
  });

  it("parses the crossing mask path from the SVG", async () => {
    const el = await createCard();
    expect(el._engine._maskPath).toBeTruthy();
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

  it("falls back to Home Assistant's configured temperature unit", async () => {
    const el = document.createElement("probe-hrv-card") as any;
    document.body.appendChild(el);
    el.setConfig(CONFIG);

    const hass = makeHass({ out: 68, sup: 86, ext: 72, exh: 50 });
    hass.states["sensor.out"].attributes = {};
    el.hass = { ...hass, config: { unit_system: { temperature: "°F" } } };
    await el.updateComplete;

    expect(el.shadowRoot.querySelector(".outdoor .temp-unit")?.textContent).toBe("°F");

    el.hass = { ...hass, config: { unit_system: { temperature: "°C" } } };
    await el.updateComplete;

    expect(el.shadowRoot.querySelector(".outdoor .temp-unit")?.textContent).toBe("°C");
    el.remove();
  });

  it("treats empty states as unavailable but keeps genuine zero", async () => {
    const el = document.createElement("probe-hrv-card") as any;
    document.body.appendChild(el);
    el.setConfig({ ...CONFIG, sensors: [{ entity: "sensor.flow" }] });

    const empty = makeHass({ out: 5, sup: 30, ext: 22, exh: 10 });
    empty.states["sensor.out"].state = "";
    empty.states["sensor.sup"].state = "   ";
    empty.states["sensor.flow"] = { state: "", attributes: {} };
    el.hass = empty;
    await el.updateComplete;

    expect(el.shadowRoot.querySelector(".outdoor .temp-value")?.textContent).toBe("—");
    expect(el.shadowRoot.querySelector(".supply .temp-value")?.textContent).toBe("—");
    expect(el.shadowRoot.querySelector(".sensor-value")?.textContent?.trim()).toBe("—");
    expect(el.readFlowTemps()).toBeNull();

    const zero = makeHass({ out: 0, sup: 0, ext: 0, exh: 0 });
    zero.states["sensor.flow"] = { state: "0", attributes: {} };
    el.hass = zero;
    await el.updateComplete;

    expect(el.shadowRoot.querySelector(".outdoor .temp-value")?.textContent).toBe("0.0");
    expect(el.shadowRoot.querySelector(".sensor-value")?.textContent?.trim()).toBe("0.0");
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

  it("renders text sensors verbatim and numbers with configured decimals", async () => {
    const el = document.createElement("probe-hrv-card") as any;
    document.body.appendChild(el);
    el.setConfig({
      ...CONFIG,
      sensors: [
        { entity: "sensor.mode", format: "text" },
        { entity: "sensor.flow", format: "number", decimals: 2 },
        { entity: "sensor.auto", decimals: 3 },
      ],
    });

    const hass = makeHass({ out: 5, sup: 30, ext: 22, exh: 10 });
    hass.states["sensor.mode"] = { state: "42", attributes: {} };
    hass.states["sensor.flow"] = { state: "12.345", attributes: {} };
    hass.states["sensor.auto"] = { state: "1.23456", attributes: {} };
    el.hass = hass;
    await el.updateComplete;

    const values = [...el.shadowRoot.querySelectorAll(".sensor-value")].map(
      (node: Element) => node.textContent?.trim()
    );
    expect(values).toEqual(["42", "12.35", "1.235"]);
    el.remove();
  });

  it("classifies coordinates against the bit-packed crossing mask", async () => {
    const el = await createCard();
    // 3x3 mask packed into bits; 1 = masked (particle hidden).
    el._engine._maskBitmap = packMask([1, 0, 1, 0, 1, 1, 0, 1, 1]);
    el._engine._maskBitmapWidth = 3;
    el._engine._maskBitmapHeight = 3;
    el._engine._maskOriginX = 10;
    el._engine._maskOriginY = 5;

    expect(el._engine._isInMask(10, 5)).toBe(true);
    expect(el._engine._isInMask(11, 5)).toBe(false);
    expect(el._engine._isInMask(12, 5)).toBe(true);
    expect(el._engine._isInMask(12, 7)).toBe(true);
    expect(el._engine._isInMask(9, 5)).toBe(false);
    expect(el._engine._isInMask(13, 5)).toBe(false);
    expect(el._engine._isInMask(10, 8)).toBe(false);
    el.remove();
  });
});
