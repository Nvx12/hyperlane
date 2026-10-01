import js from '@eslint/js';
import globals from 'globals';

export default [
  // android/ and ios/ hold Capacitor's native projects (and generated copies of the web build).
  { ignores: ['node_modules/', 'dist/', 'dist-app/', 'android/', 'ios/', 'data/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['client/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['client/js/boot.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['client/sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    files: ['server/**/*.js', 'tools/**/*.mjs', 'tests/**/*.js', '*.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // These scripts also send functions to run inside the browser page (Playwright evaluate).
    files: ['tools/**/*.mjs', 'tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['client/js/boot.js'],
    rules: { 'no-var': 'off' }, // ES5 on purpose: must parse in very old browsers to show the upgrade message
  },
];
