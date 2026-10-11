// Test setup: stub the Home Assistant web components the card references so
// the element can be instantiated without the full HA runtime.
import { LitElement, html } from "lit";

if (!customElements.get("ha-card")) {
  customElements.define(
    "ha-card",
    class HACardStub extends LitElement {
      render() {
        return html`<slot></slot>`;
      }
    }
  );
}