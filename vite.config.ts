import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    minify: "esbuild",
    sourcemap: false,
    cssCodeSplit: false,

    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "hrv-card.js"
    },

    rollupOptions: {
      output: {
        entryFileNames: "hrv-card.js"
      }
    },

    outDir: "dist",
    emptyOutDir: true
  }
});