import eslintPluginLit from "eslint-plugin-lit";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "vite.config.ts", "vitest.config.ts"],
  },
  eslintPluginLit.configs["flat/recommended"],
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: ["./tsconfig.json"],
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // Match tsconfig's strictness
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          caughtErrors: "all",
          vars: "all",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      // Lit best practices
      "lit/no-this-assign-in-render": "error",
      "lit/no-template-bind": "warn",
      "lit/no-template-map": "warn",
      "lit/prefer-static-styles": "warn",
      // Keep the build deterministic
      "no-console": "off",
    },
  },
  eslintConfigPrettier,
);