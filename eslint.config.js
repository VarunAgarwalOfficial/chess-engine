import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'engine/target/', 'web/shell/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['web/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
];
