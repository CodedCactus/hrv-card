import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    minify: "terser",
    sourcemap: false,
    cssCodeSplit: false,

    terserOptions: {
      compress: {
        ecma: 2020,
        module: true,          // ES module — enables stricter optimisations
        passes: 3,             // multiple passes squeeze out more
        drop_console: true,
        drop_debugger: true,
        pure_getters: true,    // assume getters have no side-effects
        unsafe_arrows: true,   // convert functions to arrows where safe
        unsafe_methods: true,
        booleans_as_integers: false, // keep true/false for readability in errors
        collapse_vars: true,
        toplevel: true,        // mangle/drop unused top-level vars & fns
      },
      mangle: {
        module: true,
        toplevel: true,        // mangle top-level names — big win for libs
      },
      format: {
        comments: false,       // strip all comments
        ecma: 2020,
      },
    },

    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "hrv-card.js"
    },

    outDir: "dist",
    emptyOutDir: true
  }
});