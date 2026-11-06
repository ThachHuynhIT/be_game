// Lint for api/, src/, test/ and the tooling scripts: ESLint + typescript-eslint recommended rules only (no style rules;
// formatting belongs to Prettier). Violations that existed when lint was introduced are recorded in
// eslint-suppressions.json, so only new ones fail CI (`npm run lint`). Fix one and run `npm run lint:prune`.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config({ ignores: ["node_modules/**", "coverage/**"] }, js.configs.recommended, ...tseslint.configs.recommended, {
  languageOptions: { globals: globals.node },
  rules: {
    // `_name` marks a parameter or binding that is unused on purpose (e.g. describe.each callbacks).
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
  },
});
