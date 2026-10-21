import type {
  HomeAssistant,
  SensorConfig,
  SensorDisplayInfo,
} from "./types";

/**
 * Read an entity's state, treating missing, empty, and whitespace-only states
 * as unavailable.
 */
export function getEntityState(
  hass: HomeAssistant | undefined,
  entity: string
): string | undefined {
  const state = hass?.states?.[entity]?.state;
  return typeof state === "string" && state.trim() !== "" ? state : undefined;
}

/** Read an entity's state as a number, or `null` when it is not numeric. */
export function getNumericState(
  hass: HomeAssistant | undefined,
  entity: string
): number | null {
  const raw = getEntityState(hass, entity);
  if (raw === undefined) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

export function getEntityAttribute<T>(
  hass: HomeAssistant | undefined,
  entity: string,
  attribute: string
): T | undefined {
  return hass?.states?.[entity]?.attributes?.[attribute] as T | undefined;
}

/** Prefer the entity's unit, then Home Assistant's configured unit system. */
export function getTemperatureUnit(
  hass: HomeAssistant | undefined,
  entity: string
): string {
  const entityUnit = getEntityAttribute<unknown>(
    hass,
    entity,
    "unit_of_measurement"
  );
  if (typeof entityUnit === "string" && entityUnit.trim()) {
    return entityUnit.trim();
  }

  const systemUnit = hass?.config?.unit_system?.temperature;
  if (typeof systemUnit === "string" && systemUnit.trim()) {
    return systemUnit.trim();
  }

  return "°C";
}

export function getSensorDisplayInfo(
  hass: HomeAssistant | undefined,
  sensor: SensorConfig
): SensorDisplayInfo {
  const state = getEntityState(hass, sensor.entity) ?? "—";
  const unit =
    sensor.unit ??
    getEntityAttribute<string>(hass, sensor.entity, "unit_of_measurement") ??
    "";
  const deviceClass = getEntityAttribute<string>(
    hass,
    sensor.entity,
    "device_class"
  );

  const isBinary =
    sensor.format === "binary" || state === "on" || state === "off";
  const isOpening = deviceClass === "opening";
  const isHeat = deviceClass === "heat";
  const isOn = state === "on";

  let display: string;
  if (isBinary) {
    if (isOn) {
      display = isOpening ? "Open" : "On";
    } else if (state === "off") {
      display = isOpening ? "Closed" : "Off";
    } else {
      display = state;
    }
  } else if (sensor.format === "text") {
    display = state;
  } else {
    const num = Number(state);
    const decimals = sensor.format === "number" ? (sensor.decimals ?? 1) : 1;
    display = Number.isFinite(num) ? num.toFixed(decimals) : state;
  }

  return { display, unit, isBinary, isOn, isHeat };
}
