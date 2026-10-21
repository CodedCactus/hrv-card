import type { HRVCardConfig } from "./types";

const REQUIRED_CONFIG_KEYS = [
  "outdoor_temp",
  "supply_temp",
  "extract_temp",
  "exhaust_temp",
] as const satisfies ReadonlyArray<keyof HRVCardConfig>;

/** Validate a card configuration and return a normalized copy. */
export function normalizeConfig(config: HRVCardConfig): HRVCardConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid card configuration.");
  }

  for (const key of REQUIRED_CONFIG_KEYS) {
    const value = config[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(
        `HRV Card is missing required field: "${key}". Required fields: ${REQUIRED_CONFIG_KEYS.join(", ")}.`
      );
    }
  }

  if (config.sensors !== undefined && !Array.isArray(config.sensors)) {
    throw new Error('HRV Card "sensors" must be a list.');
  }

  for (const [index, sensor] of (config.sensors ?? []).entries()) {
    const entity = (sensor as { entity?: unknown } | null)?.entity;
    if (typeof entity !== "string" || entity.trim() === "") {
      throw new Error(
        `HRV Card sensor at index ${index} is missing a valid "entity".`
      );
    }
  }

  const sensors = config.sensors?.map((sensor) => ({
    ...sensor,
    entity: sensor.entity.trim(),
  }));

  return {
    ...config,
    outdoor_temp: config.outdoor_temp.trim(),
    supply_temp: config.supply_temp.trim(),
    extract_temp: config.extract_temp.trim(),
    exhaust_temp: config.exhaust_temp.trim(),
    sensors,
  };
}

/** All entity IDs whose state changes should re-render the card. */
export function getTrackedEntities(config: HRVCardConfig): string[] {
  return [
    config.outdoor_temp,
    config.supply_temp,
    config.extract_temp,
    config.exhaust_temp,
    ...(config.sensors?.map((sensor) => sensor.entity) ?? []),
  ];
}
