import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    globals: true,
    setupFiles: ["./src/setup-test.ts"],
  },
  resolve: {
    // Vite's `?raw` import must work in tests too.
    conditions: ["browser"],
  },
});