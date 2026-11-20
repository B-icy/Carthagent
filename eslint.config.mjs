import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Existing violations of these rules are recorded in eslint-suppressions.json;
// only new violations fail. See docs/architecture-boundaries.md and docs/tech-debt.md.
const SHAPE_RULES = {
  complexity: ['error', { max: 15 }],
  'max-depth': ['error', { max: 4 }],
  'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
  'max-params': ['error', { max: 6 }],
  'max-nested-callbacks': ['error', { max: 4 }],
};

// Test modules keep many self-contained, fixture-heavy cases next to each
// other, so they get a larger file budget than production modules.
const TEST_FILES = ['tests/**/*.mjs', 'tools/**/*.test.mjs', 'plugins/*/tests/**/*.{mjs,ts,tsx}'];
const TEST_SHAPE_RULES = { 'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }] };

// Object keys and type members mirror external wire formats (GitHub and
// OpenAI JSON, HTTP headers, error codes), so snake_case and quoted keys are
// allowed there; bindings follow camelCase/PascalCase/UPPER_CASE.
const PROPERTY_SELECTORS = ['objectLiteralProperty', 'objectLiteralMethod', 'typeProperty', 'typeMethod'];
const TS_NAMING = [
  'error',
  { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow', trailingUnderscore: 'allow' },
  { selector: 'import', format: ['camelCase', 'PascalCase'] },
  { selector: 'variable', format: ['camelCase', 'PascalCase', 'UPPER_CASE'], leadingUnderscore: 'allow' },
  { selector: 'function', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
  { selector: 'parameter', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
  { selector: 'classProperty', modifiers: ['static', 'readonly'], format: ['camelCase', 'UPPER_CASE'] },
  { selector: PROPERTY_SELECTORS, format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'], leadingUnderscore: 'allow' },
  { selector: PROPERTY_SELECTORS, modifiers: ['requiresQuotes'], format: null },
  { selector: ['variable', 'parameter'], modifiers: ['destructured'], format: null },
];

const MJS_NAMING = ['error', { properties: 'never', ignoreDestructuring: true, ignoreImports: true, ignoreGlobals: true }];

// Module boundaries; tests/architecture.test.mjs enforces the same layers,
// including dynamic import() calls, which this rule does not inspect.
const PLUGIN_SOURCES = '{mjs,ts,tsx}';
const NO_TEST_OR_TOOL_IMPORTS = {
  regex: '^(\\.\\.?/)+(tests|tools|scenarios)/',
  message: 'Production code must not import tests/, tools/ or scenarios/ (docs/architecture-boundaries.md).',
};
const NO_UI_FRAMEWORK_IMPORTS = {
  regex: '^(@opentui/|solid-js(/|$))',
  message: 'Only the native TUI layer (plugins/carthagent/src/tui.tsx and src/ui/) may import @opentui or solid-js.',
};
const restrictImports = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

const BOUNDARY_CONFIGS = [
  {
    files: ['lib/**/*.mjs'],
    rules: restrictImports(NO_TEST_OR_TOOL_IMPORTS, NO_UI_FRAMEWORK_IMPORTS, {
      regex: '^(\\.\\./)+(bin|extensions)/|^(\\.\\./)+plugins/(?!carthagent/src/server/framing\\.mjs$)',
      message: 'lib/ must not import bin/, extensions/ or plugin modules other than the shared framing contract.',
    }),
  },
  {
    files: ['lib/cloud/**/*.mjs'],
    rules: restrictImports(NO_TEST_OR_TOOL_IMPORTS, NO_UI_FRAMEWORK_IMPORTS, {
      regex: '^\\.\\./',
      message: 'lib/cloud/ is self-contained: import only sibling lib/cloud modules and packages.',
    }),
  },
  {
    files: ['bin/**/*.mjs'],
    rules: restrictImports({ regex: '^\\.\\./(?!lib/)', message: 'bin/ may only import lib/.' }),
  },
  {
    files: [`plugins/carthagent/src/ui/**/*.${PLUGIN_SOURCES}`, 'plugins/carthagent/src/{tui.tsx,bootstrap.ts}', 'plugins/carthagent/tui.ts'],
    rules: restrictImports(NO_TEST_OR_TOOL_IMPORTS, {
      regex: '^(\\.\\.?/)+(src/)?(server/|(index|testing)(\\.[jt]s)?$)',
      message: 'Native UI modules must not import the plugin server layer; share contracts through src/rpc.ts and src/*-rpc.ts.',
    }),
  },
  {
    files: [`plugins/carthagent/src/server/**/*.${PLUGIN_SOURCES}`, 'plugins/carthagent/src/{index,testing}.ts', 'plugins/carthagent/index.ts'],
    rules: restrictImports(NO_TEST_OR_TOOL_IMPORTS, NO_UI_FRAMEWORK_IMPORTS, {
      regex: '^(\\.\\.?/)+(src/)?(ui/|(tui|bootstrap)(\\.tsx?|\\.js)?$)',
      message: 'Plugin server modules must not import the native UI layer.',
    }),
  },
];

export default [
  { ignores: ['vendor/**', 'node_modules/**', 'artifacts/**', '.harness/**', 'scenarios/**', 'public/**'] },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      camelcase: MJS_NAMING,
      ...SHAPE_RULES,
    },
  },
  {
    files: ['plugins/**/*.ts', 'plugins/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...tseslint.configs.recommended[2].rules,
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      '@typescript-eslint/naming-convention': TS_NAMING,
      ...SHAPE_RULES,
    },
  },
  { files: TEST_FILES, rules: TEST_SHAPE_RULES },
  ...BOUNDARY_CONFIGS,
];
