import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      ".claude/**",
      "build/**",
      "dist/**",
      "releases/**",
      "server-swift/**",
      "clients/chrome/lib/**",
      "clients/chrome/dist/**",
    ],
  },

  js.configs.recommended,

  // Chrome extension — browser JS loaded via <script src>, cross-file globals
  {
    files: ["clients/chrome/**/*.js"],
    ignores: ["clients/chrome/lib/**"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions, chrome: "readonly" },
      parserOptions: { sourceType: "script", ecmaVersion: 2022 },
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  // Chrome extension native host (Node CommonJS)
  {
    files: ["clients/chrome/native-host/**/*.cjs"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "commonjs", ecmaVersion: 2022 },
    },
  },

  // Chrome extension build script (Node)
  {
    files: ["clients/chrome/build.js"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
  },

  // Node scripts (ESM)
  {
    files: ["scripts/**/*.mjs", "*.config.js", "*.config.mjs"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
  },

  prettier,
];
