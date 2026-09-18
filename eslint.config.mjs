import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/**', 'node_modules/**', 'artifacts/**', '.harness/**', 'scenarios/**', 'public/**'] },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
