import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "dist/**",
      "releases/**",
      "server/**/*.js",
      "server/**/*.js.map",
      "clients/chrome/lib/**",
      "clients/chrome/dist/**",
      "**/package-lock.json",
    ],
  },

  js.configs.recommended,

  // TypeScript (server/)
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    files: ["server/**/*.ts"],
  })),

  // Server source (Node runtime)
  {
    files: ["server/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        { "ts-ignore": "allow-with-description", minimumDescriptionLength: 0 },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },

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
