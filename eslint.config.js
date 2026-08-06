const js = require("@eslint/js");
const n = require("eslint-plugin-n");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

module.exports = [
  js.configs.recommended,
  n.configs["flat/recommended-script"],
  {
    settings: {
      n: { version: ">=24.0.0" },
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
    },
  },
  {
    // The lint configuration itself requires devDependencies; it never ships.
    files: ["eslint.config.js"],
    rules: {
      "n/no-unpublished-require": "off",
      "n/no-extraneous-require": "off",
    },
  },
  {
    // `build/Release/fs_admin.node` is compiled from the published sources by
    // `npm run build`, and by electron-rebuild when the editor installs this,
    // so it is deliberately absent from `files` and cannot be resolved by a
    // lint run over the checkout.
    files: ["index.js"],
    rules: {
      "n/no-missing-require": "off",
      "n/no-unpublished-require": "off",
    },
  },
  {
    files: ["spec/**"],
    languageOptions: {
      globals: {
        ...globals.jasmine,
      },
    },
    rules: {
      "n/no-unpublished-require": "off",
      "n/no-extraneous-require": "off",
    },
  },
  // Must be last: turns off any lint rules that would conflict with Prettier.
  prettier,
];
