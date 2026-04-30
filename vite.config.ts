import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "hrv-card.js"
    },
    rollupOptions: {
      // Keep Lit external if you want smaller bundle
      external: []
    },
    outDir: "dist",
    emptyOutDir: true
  }
});