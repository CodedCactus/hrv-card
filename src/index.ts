import "./hrv-card";
import { VERSION } from "./version";

window.customCards ??= [];
window.customCards.push({
  type: "hrv-card",
  name: "HRV Card",
  description: "Heat Recovery Ventilation visualization card",
  preview: true,
});

console.info(
    `%c HRV-CARD %c v${VERSION} `,
    "color: orange; font-weight: bold; background: black",
    "color: white; font-weight: bold; background: dimgray"
);