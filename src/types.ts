export interface HomeAssistantState {
  state: string;
  attributes?: Record<string, unknown>;
}

export interface HomeAssistant {
  states: Record<string, HomeAssistantState | undefined>;
  config?: {
    unit_system?: {
      temperature?: string;
    };
  };
}

export interface SensorConfig {
  entity: string;
  label?: string;
  format?: "binary" | "text" | "number";
  unit?: string;
  decimals?: number;
}

export interface HRVCardConfig {
  title?: string;
  outdoor_temp: string;
  supply_temp: string;
  extract_temp: string;
  exhaust_temp: string;
  sensors?: SensorConfig[];
  animation?: boolean; // enable/disable flow animation (default: true)
}

export interface SensorDisplayInfo {
  display: string;
  unit: string;
  isBinary: boolean;
  isOn: boolean;
  isHeat: boolean;
}

/** The four flow temperatures read from hass. */
export interface FlowTemps {
  outdoor: number;
  supply: number;
  extract: number;
  exhaust: number;
}
