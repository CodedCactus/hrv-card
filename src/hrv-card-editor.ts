import { LitElement, html, css } from "lit";
import type { TemplateResult } from "lit";
import { normalizeConfig } from "./config";
import type {
  HRVCardConfig,
  HomeAssistant,
  SensorConfig,
} from "./types";

const REQUIRED_ENTITY_KEYS = [
  "outdoor_temp",
  "supply_temp",
  "extract_temp",
  "exhaust_temp",
] as const;

type RequiredEntityKey = (typeof REQUIRED_ENTITY_KEYS)[number];
type SensorTextField = "label" | "unit" | "decimals";

const FIELD_LABELS: Record<RequiredEntityKey, string> = {
  outdoor_temp: "Outdoor temperature entity",
  supply_temp: "Supply temperature entity",
  extract_temp: "Extract temperature entity",
  exhaust_temp: "Exhaust temperature entity",
};

function cleanSensor(sensor: SensorConfig): SensorConfig {
  const result = { ...sensor };
  if (!result.label) delete result.label;
  if (!result.unit) delete result.unit;
  if (!result.format) delete result.format;
  if (result.decimals === undefined || !Number.isFinite(result.decimals)) {
    delete result.decimals;
  }
  return result;
}

export class HRVCardEditor extends LitElement {
  private _config?: HRVCardConfig;
  private _hass?: HomeAssistant;

  set hass(value: HomeAssistant) {
    this._hass = value;
    this.requestUpdate();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  setConfig(config: HRVCardConfig): void {
    this._config = {
      ...config,
      sensors: config.sensors?.map((sensor) => ({ ...sensor })),
    };
    this.requestUpdate();
  }

  private _fieldValue(event: Event): string {
    return (event.target as HTMLElement & { value: string }).value;
  }

  private _commit(config: HRVCardConfig): void {
    this._config = config;
    this.requestUpdate();

    // Incomplete configs (e.g. a required entity not picked yet) stay local
    // until they become valid, so the card never receives a broken config.
    let normalized: HRVCardConfig;
    try {
      normalized = normalizeConfig(config);
    } catch {
      return;
    }

    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: normalized },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _update(patch: Partial<HRVCardConfig>): void {
    if (!this._config) return;
    this._commit({ ...this._config, ...patch });
  }

  private _onRequiredEntity(key: RequiredEntityKey, event: Event): void {
    const value = (event as CustomEvent<{ value: string }>).detail.value;
    this._update({ [key]: value } as Partial<HRVCardConfig>);
  }

  private _onTitleInput(event: Event): void {
    const title = this._fieldValue(event).trim();
    const next = { ...this._config! };
    if (title) {
      next.title = title;
    } else {
      delete next.title;
    }
    this._commit(next);
  }

  private _onAnimationChange(event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    const next = { ...this._config! };
    if (enabled) {
      delete next.animation;
    } else {
      next.animation = false;
    }
    this._commit(next);
  }

  private _onSensorEntity(index: number, event: Event): void {
    const value = (event as CustomEvent<{ value: string }>).detail.value;
    this._updateSensor(index, { entity: value });
  }

  private _onSensorText(
    index: number,
    field: SensorTextField,
    event: Event
  ): void {
    const raw = this._fieldValue(event);
    if (field === "decimals") {
      const decimals = raw === "" ? undefined : Number(raw);
      this._updateSensor(index, { decimals });
    } else if (field === "label") {
      this._updateSensor(index, { label: raw });
    } else {
      this._updateSensor(index, { unit: raw });
    }
  }

  private _onSensorFormat(index: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const format = value
      ? (value as SensorConfig["format"])
      : undefined;
    this._updateSensor(index, { format });
  }

  private _updateSensor(index: number, patch: Partial<SensorConfig>): void {
    if (!this._config) return;
    const sensors = [...(this._config.sensors ?? [])];
    sensors[index] = cleanSensor({ ...sensors[index], ...patch });
    this._update({ sensors });
  }

  private _addSensor(): void {
    if (!this._config) return;
    this._update({
      sensors: [...(this._config.sensors ?? []), { entity: "" }],
    });
  }

  private _removeSensor(index: number): void {
    if (!this._config) return;
    this._update({
      sensors: (this._config.sensors ?? []).filter((_, i) => i !== index),
    });
  }

  private _renderEntityPicker(
    label: string,
    value: string,
    onChange: (event: Event) => void
  ): TemplateResult {
    return html`
      <ha-entity-picker
        .hass=${this._hass}
        .value=${value}
        .label=${label}
        allow-custom-entity
        @value-changed=${onChange}
      ></ha-entity-picker>
    `;
  }

  private _renderRequiredEntities(config: HRVCardConfig): TemplateResult[] {
    return REQUIRED_ENTITY_KEYS.map((key) =>
      this._renderEntityPicker(FIELD_LABELS[key], config[key], (event) =>
        this._onRequiredEntity(key, event)
      )
    );
  }

  private _renderSensors(sensors: SensorConfig[]): TemplateResult[] {
    return sensors.map(
      (sensor, index) => html`
        <div class="sensor-card">
          <div class="sensor-header">
            <span class="sensor-title">Sensor ${index + 1}</span>
            <button
              type="button"
              class="remove-sensor"
              @click=${() => this._removeSensor(index)}
            >
              Remove
            </button>
          </div>

          ${this._renderEntityPicker(
            "Entity",
            sensor.entity,
            (event) => this._onSensorEntity(index, event)
          )}

          <div class="grid">
            <ha-textfield
              label="Label"
              .value=${sensor.label ?? ""}
              @input=${(event: Event) =>
                this._onSensorText(index, "label", event)}
            ></ha-textfield>
            <ha-textfield
              label="Unit"
              .value=${sensor.unit ?? ""}
              @input=${(event: Event) =>
                this._onSensorText(index, "unit", event)}
            ></ha-textfield>
            <label class="select-field">
              <span>Format</span>
              <select
                .value=${sensor.format ?? ""}
                @change=${(event: Event) =>
                  this._onSensorFormat(index, event)}
              >
                <option value="">Auto</option>
                <option value="number">Number</option>
                <option value="text">Text</option>
                <option value="binary">Binary</option>
              </select>
            </label>
            ${sensor.format === "number"
              ? html`
                  <label class="number-field">
                    <span>Decimal places</span>
                    <input
                      class="decimals-field"
                      type="number"
                      min="0"
                      max="20"
                      step="1"
                      .value=${sensor.decimals === undefined
                        ? ""
                        : String(sensor.decimals)}
                      @input=${(event: Event) =>
                        this._onSensorText(index, "decimals", event)}
                    />
                  </label>
                `
              : ""}
          </div>
        </div>
      `
    );
  }

  render(): TemplateResult {
    if (!this._config) return html``;

    const config = this._config;
    return html`
      <div class="editor">
        <ha-textfield
          label="Card title"
          .value=${config.title ?? ""}
          @input=${this._onTitleInput}
        ></ha-textfield>

        <div class="section-title">Temperature entities</div>
        <div class="grid">
          ${this._renderRequiredEntities(config)}
        </div>

        <ha-formfield label="Show flow animation">
          <ha-switch
            .checked=${config.animation !== false}
            @change=${this._onAnimationChange}
          ></ha-switch>
        </ha-formfield>

        <div class="section-title">Additional sensors</div>
        <p class="help">
          Optional sensors shown in the row below the card.
        </p>
        ${this._renderSensors(config.sensors ?? [])}
        <button type="button" class="add-sensor" @click=${this._addSensor}>
          Add sensor
        </button>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }

    .editor {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 8px 0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }

    ha-entity-picker,
    ha-textfield {
      display: block;
      width: 100%;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--primary-text-color);
    }

    .help {
      margin: -8px 0 0;
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    .sensor-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
    }

    .sensor-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .sensor-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color);
    }

    .select-field,
    .number-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    .select-field select,
    .number-field input {
      box-sizing: border-box;
      width: 100%;
      min-height: 40px;
      padding: 0 8px;
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font: inherit;
    }

    .add-sensor,
    .remove-sensor {
      align-self: flex-start;
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid var(--divider-color);
      border-radius: 16px;
      background: var(--secondary-background-color);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }

    .add-sensor:hover,
    .remove-sensor:hover {
      background: color-mix(in srgb, var(--primary-color) 8%, var(--secondary-background-color));
    }

    .remove-sensor {
      min-height: 28px;
      padding: 0 10px;
      font-size: 12px;
    }
  `;
}

if (!customElements.get("hrv-card-editor")) {
  customElements.define("hrv-card-editor", HRVCardEditor);
}
