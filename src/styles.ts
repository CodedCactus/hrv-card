import { css } from "lit";

export const cardStyles = css`
  :host {
    font-family: var(--primary-font-family);
    display: block;
  }

  ha-card {
    overflow: hidden;
    border-radius: var(--ha-card-border-radius, var(--card-border-radius, 12px));
    font-family: var(--ha-card-header-font-family, var(--primary-font-family, var(--ha-font-family-body, inherit)));
  }

  /* ── Header ───────────────────────────────── */

  .mini-header {
    padding: 16px 16px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mini-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--primary-text-color);
  }

  /* ── Wrap + svg-container ─────────────────── */

  .wrap {
    position: relative;
    width: 100%;
  }

  .svg-container svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
    background:
      radial-gradient(ellipse 55% 60% at 50% 50%, transparent 40%, var(--ha-card-background, var(--card-background-color, #fff)) 100%);
    opacity: 0.12;
  }

  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
  }

  /* ── Temperature labels ───────────────────── */

  .label {
    pointer-events: auto;
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 1px;
    cursor: pointer;
    /* Native <button> reset */
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    text-align: inherit;
  }

  .label:hover .temp-value {
    opacity: 0.75;
  }

  .label:focus-visible,
  .sensor-chip:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }

  .temp-row {
    display: flex;
    align-items: baseline;
    gap: 2px;
    line-height: 1;
  }

  .temp-value {
    font-size: clamp(14px, 1.5vw, 19px);
    font-weight: 600;
    line-height: 1;
    color: var(--primary-text-color);
    transition: opacity 0.15s ease;
  }

  .temp-unit {
    font-size: clamp(9px, 0.9vw, 12px);
    font-weight: 400;
    color: var(--secondary-text-color);
    line-height: 1;
    align-self: flex-start;
    margin-top: 1px;
  }

  .temp-name {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--secondary-text-color);
    opacity: 0.55;
    line-height: 1;
  }

  .outdoor {
    left: 3%;
    top: calc(21.875% - 4px);
    transform: translateY(-100%);
    align-items: flex-start;
  }
  .extract {
    right: 2.4%;
    top: calc(21.875% - 4px);
    transform: translateY(-100%);
    align-items: flex-end;
  }

  .exhaust {
    left: 3%;
    top: calc(73.594% - 4px);
    transform: translateY(-100%);
    align-items: flex-start;
  }
  .supply {
    right: 2.4%;
    top: calc(73.594% - 4px);
    transform: translateY(-100%);
    align-items: flex-end;
  }

  /* ── Sensor row ───────────────────────────── */

  .sensor-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 16px 16px;
  }

  .sensor-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 20px;
    background: var(--secondary-background-color);
    border: 1px solid var(--divider-color);
    cursor: pointer;
    transition: background 0.15s ease;
    /* Native <button> reset */
    font: inherit;
    color: inherit;
  }

  .sensor-chip:hover {
    background: color-mix(in srgb, var(--primary-color) 8%, var(--secondary-background-color));
  }

  .sensor-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot--on  { background: var(--success-color, #4caf50); box-shadow: 0 0 4px var(--success-color, #4caf50); }
  .dot--heat { background: var(--error-color, #f44336); box-shadow: 0 0 4px var(--error-color, #f44336); }
  .dot--off { background: var(--disabled-color, rgba(0,0,0,0.25)); }

  .sensor-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--secondary-text-color);
  }

  .sensor-value {
    font-size: 12px;
    font-weight: 600;
    color: var(--primary-text-color);
  }

  .sensor-unit {
    font-weight: 400;
    color: var(--secondary-text-color);
  }

  .badge--on {
    color: var(--success-color, #4caf50);
  }

  .badge--off {
    color: var(--disabled-text-color, var(--secondary-text-color));
    opacity: 0.6;
  }
`;
