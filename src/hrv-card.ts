import { LitElement, html } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { cloneCardSvg, queryFlowPaths, queryMaskElement } from "./card-svg";
import { getTrackedEntities, normalizeConfig } from "./config";
import { queryGradientStops, updateGradients } from "./gradient";
import type { GradientStops } from "./gradient";
import { ParticleEngine } from "./particle-engine";
import {
  getNumericState,
  getSensorDisplayInfo,
  getTemperatureUnit,
} from "./state";
import { cardStyles } from "./styles";
import type {
  FlowTemps,
  HomeAssistant,
  HRVCardConfig,
  SensorConfig,
} from "./types";

export type { HRVCardConfig } from "./types";

class HRVCard extends LitElement {
  static get properties() {
    return {
      _hass: { type: Object, state: true },
      config: { type: Object },
    };
  }

  private _hass?: HomeAssistant;
  private config?: HRVCardConfig;

  /** Cached references to the live <stop> elements inside this card's SVG. */
  private _gradientStops?: GradientStops;

  /** Owns the canvas, mask, particle state, and animation loop. */
  private _engine?: ParticleEngine;

  /**
   * All tracked entity IDs. Hass updates that change none of these (nor any
   * sensor chip's unit/device-class attribute) are filtered out in
   * shouldUpdate. Computed once in setConfig.
   */
  private _trackedEntities: string[] = [];

  /** True when the latest hass assignment changed data the card displays. */
  private _trackedStateChanged = true;

  // ── hass accessor ──────────────────────────

  set hass(value: HomeAssistant) {
    const previous = this._hass;
    this._hass = value;

    // The reactive assignment schedules an update; shouldUpdate decides whether
    // it renders. The first assignment always renders so the card shows its
    // initial state (including "—" for not-yet-available entities).
    if (previous === undefined) {
      this._trackedStateChanged = true;
      return;
    }

    // OR-accumulate: several hass assignments can land between two update
    // cycles, and once any tracked change arrives the next cycle must render.
    this._trackedStateChanged ||= this._hasTrackedDataChanged(previous, value);
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  /**
   * True when the previous → current hass transition changed any data the card
   * displays: a tracked entity's state, or a sensor chip's unit/device class.
   */
  private _hasTrackedDataChanged(
    previous: HomeAssistant,
    current: HomeAssistant
  ): boolean {
    if (
      previous.config?.unit_system?.temperature !==
      current.config?.unit_system?.temperature
    ) {
      return true;
    }

    return this._trackedEntities.some((entity) => {
      const prevState = previous.states[entity];
      const currState = current.states[entity];
      if (prevState?.state !== currState?.state) return true;
      return (
        prevState?.attributes?.unit_of_measurement !==
          currState?.attributes?.unit_of_measurement ||
        prevState?.attributes?.device_class !== currState?.attributes?.device_class
      );
    });
  }

  // ── config ─────────────────────────────────

  setConfig(config: HRVCardConfig): void {
    this.config = normalizeConfig(config);
    // Cache tracked entities so the hass setter never allocates on each call.
    this._trackedEntities = getTrackedEntities(this.config);
  }

  /** Approximate rendered row count; used by HA's masonry card-size system. */
  getCardSize(): number {
    // Header (1) + SVG/overlay block (1) + sensor row (1 when configured).
    return 2 + (this.config?.sensors?.length ? 1 : 0);
  }

  /** Default size and resize limits for HA's Sections view grid. */
  getGridOptions(): {
    columns: number;
    rows: "auto";
    min_columns: number;
    max_columns: number;
  } {
    return {
      columns: 12,
      rows: "auto",
      min_columns: 6,
      max_columns: 12,
    };
  }

  /**
   * Legacy layout hook for older HA versions; mirrors getGridOptions().
   * @deprecated Use getGridOptions() where supported.
   */
  getLayoutOptions(): {
    grid_columns: number;
    grid_rows: "auto";
    grid_min_columns: number;
    grid_max_columns: number;
  } {
    return {
      grid_columns: 12,
      grid_rows: "auto",
      grid_min_columns: 6,
      grid_max_columns: 12,
    };
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

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!changedProps.has("_hass")) return true;
    if (changedProps.has("config")) return true;
    return this._trackedStateChanged;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._engine?.attach();
  }

  protected firstUpdated(): void {
    const container = this.renderRoot.querySelector(".svg-container");
    if (!container) return;

    const svg = cloneCardSvg();
    container.appendChild(svg);
    this._gradientStops = queryGradientStops(svg);

    const flowPaths = queryFlowPaths(svg);
    if (flowPaths) {
      this._engine = new ParticleEngine(
        svg,
        this,
        flowPaths,
        queryMaskElement(svg)
      );
      this._engine.enabled = this.config?.animation !== false;
    }

    this.updateSvgGradients();
  }

  protected updated(changedProps: PropertyValues): void {
    // Consumed: the update that shouldUpdate let through is now complete.
    this._trackedStateChanged = false;

    if (changedProps.has("_hass") || changedProps.has("config")) {
      // A config change can point the card at different entities, so the
      // gradients must be recomputed from the new configuration too.
      if (this._engine) {
        this._engine.enabled = this.config?.animation !== false;
      }
      this.updateSvgGradients();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._engine?.detach();
  }

  // ── gradient data ──────────────────────────

  /**
   * Read the four flow temperatures from hass. Returns null when any is
   * missing or non-numeric, so callers can distinguish "unavailable" from a
   * genuine value.
   */
  private readFlowTemps(): FlowTemps | null {
    if (!this.config) return null;

    const outdoor = getNumericState(this._hass, this.config.outdoor_temp);
    const supply = getNumericState(this._hass, this.config.supply_temp);
    const extract = getNumericState(this._hass, this.config.extract_temp);
    const exhaust = getNumericState(this._hass, this.config.exhaust_temp);

    if (outdoor === null || supply === null || extract === null || exhaust === null) {
      return null;
    }
    return { outdoor, supply, extract, exhaust };
  }

  private updateSvgGradients(): void {
    const temps = this.readFlowTemps();
    if (this._engine) {
      this._engine.hasTemperatures = temps !== null;
    }

    // If any temperature is unavailable, leave the gradients in their last
    // known state rather than collapsing them around a bogus 0.
    if (!this._gradientStops || !temps) return;

    updateGradients(this._gradientStops, temps);
  }

  // ── render helpers ─────────────────────────

  private renderLabel(
    cssClass: string,
    entity: string,
    value: number | null,
    label: string,
    decimals: number = 1
  ): TemplateResult {
    const text = value === null ? "—" : value.toFixed(decimals);
    // Show the sensor's own unit (°F users otherwise see a wrong °C label).
    const unit = getTemperatureUnit(this._hass, entity);
    const ariaLabel = [label, "temperature", text, unit].filter(Boolean).join(" ");

    return html`
      <button
        type="button"
        class="label ${cssClass}"
        title=${label}
        aria-label=${ariaLabel}
        @click=${() => this.handleMoreInfo(entity)}
      >
        <span class="temp-row"><span class="temp-value">${text}</span><span class="temp-unit">${unit}</span></span>
        <span class="temp-name">${label}</span>
      </button>
    `;
  }

  private renderSensorChip(sensor: SensorConfig): TemplateResult {
    const { display, unit, isBinary, isOn, isHeat } = getSensorDisplayInfo(
      this._hass,
      sensor
    );
    const label =
      sensor.label ||
      (sensor.entity.split(".").pop() ?? sensor.entity).replace(/_/g, " ");

    let dotClass = "";
    if (isBinary) {
      dotClass = isHeat && isOn ? "dot--heat" : isOn ? "dot--on" : "dot--off";
    }

    const valueText = !isBinary && unit ? `${display} ${unit}` : display;

    return html`
      <button
        type="button"
        class="sensor-chip"
        title=${sensor.entity}
        aria-label=${`${label}: ${valueText}`}
        @click=${() => this.handleMoreInfo(sensor.entity)}
      >
        ${isBinary ? html`<span class="sensor-dot ${dotClass}"></span>` : ""}
        <span class="sensor-label">${label}</span>
        <span class="sensor-value ${isBinary ? (isOn ? "badge--on" : "badge--off") : ""}">
          ${display}${!isBinary && unit ? html`<span class="sensor-unit"> ${unit}</span>` : ""}
        </span>
      </button>
    `;
  }

  private renderSensorRow(): TemplateResult {
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
    return sensors.map((sensor) => this.renderSensorChip(sensor));
  }

  // ── render ─────────────────────────────────

  render(): TemplateResult {
    if (!this._hass || !this.config) return html``;

    const { outdoor_temp, supply_temp, extract_temp, exhaust_temp } = this.config;

    return html`
      <ha-card>
        <div class="mini-header">
          <span class="mini-title">${this.config.title || "HRV System"}</span>
        </div>

        <div class="wrap">
          <div class="svg-container"></div>
          <div class="vignette"></div>

          <div class="overlay">
            ${this.renderLabel("outdoor", outdoor_temp, getNumericState(this._hass, outdoor_temp), "Outdoor")}
            ${this.renderLabel("supply", supply_temp, getNumericState(this._hass, supply_temp), "Supply")}
            ${this.renderLabel("extract", extract_temp, getNumericState(this._hass, extract_temp), "Extract")}
            ${this.renderLabel("exhaust", exhaust_temp, getNumericState(this._hass, exhaust_temp), "Exhaust")}
          </div>
        </div>

        ${this.renderSensorRow()}
      </ha-card>
    `;
  }

  static styles = cardStyles;
}

// ─────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────

if (!customElements.get("hrv-card")) {
  customElements.define("hrv-card", HRVCard);
}
