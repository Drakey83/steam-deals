// Lint rules for the whole project. `npm run lint`.
// The main goal is catching mistakes plain JavaScript lets through: undefined names (a missing import),
// unused imports/variables, unreachable code, accidental globals.
const js = require("@eslint/js");
const globals = require("globals");

const shared = {
  ...js.configs.recommended.rules,
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-constant-condition": ["error", { checkLoops: false }],
  eqeqeq: ["error", "smart"],
  "no-var": "error",
  "prefer-const": "error",
};

module.exports = [
  { ignores: ["node_modules/**", "release/**", "web/public/**", "web/api/_lib/core.js", "web/.vercel/**", "docs/**"] },
  {
    // The UI: browser ES modules.
    files: ["src/renderer/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser } },
    rules: shared,
  },
  {
    // The website's browser API layer (defines window.steamDeals): ES modules.
    files: ["web/src/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser } },
    rules: shared,
  },
  {
    // Shared core: CommonJS in Node and a plain script in the browser.
    files: ["src/shared/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: { ...globals.browser, ...globals.node } },
    rules: shared,
  },
  {
    // Electron main process, preload, Vercel functions, tooling: CommonJS on Node.
    files: ["src/main/**/*.js", "src/preload.js", "web/api/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: { ...globals.node } },
    rules: shared,
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } },
    rules: shared,
  },
];
