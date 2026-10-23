import "./hrv-card";
import { VERSION } from "./version";

window.customCards ??= [];
window.customCards.push({
  type: "hrv-card",
  name: "HRV Card",
  description:
    "Visualize Heat Recovery Ventilation (HRV/ERV) temperatures and airflow",
  preview: true,
  documentationURL: "https://github.com/CodedCactus/hrv-card#readme",
});

console.info(
  `%c HRV-CARD %c v${VERSION} `,
  "color: orange; font-weight: bold; background: black",
  "color: white; font-weight: bold; background: dimgray",
);
