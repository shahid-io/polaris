import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

/**
 * One flat config for the whole workspace.
 *
 * A single root config rather than one per package: the rules that matter here are the same
 * everywhere, and five near-identical files would drift the moment one of them was edited.
 * Where a package genuinely differs — only `apps/web` is a React app — that is expressed as
 * a scoped block below rather than as a separate file.
 *
 * Replaces `next lint`, which Next 16 removed. That command had been failing outright, and
 * because CI never ran it the failure went unnoticed.
 *
 * ### Held at ESLint 9 on purpose
 * ESLint 10 is out, and `eslint-config-next@16.3.0` declares `eslint: ">=9.0.0"`, so it
 * installs cleanly and then dies on the first file: the parser it bundles builds a scope
 * manager without the `addGlobals` method ESLint 10 calls, and the config registers 1174
 * globals. The peer range is simply wider than the support. Revisit when
 * `eslint-config-next` names ESLint 10 explicitly.
 */

/**
 * Next's own rules, confined to the web app.
 *
 * Two adjustments to what the package ships:
 *
 * 1. **Scoped.** Of its four blocks, two carry no `files` key, so they would otherwise apply
 *    to the NestJS API and the three domain packages — reporting missing React imports in
 *    files that have never seen JSX. Rewriting `files` on every block keeps them where they
 *    belong.
 * 2. **`next/typescript` dropped.** It registers the `@typescript-eslint` plugin, which is
 *    already registered workspace-wide below, and ESLint rejects a plugin defined twice.
 *    Dropping Next's copy rather than the shared one means every package is held to the same
 *    TypeScript rules instead of the web app quietly diverging.
 * 3. **Its parser removed**, so the whole workspace is parsed by one. `eslint-config-next`
 *    bundles its own `typescript-eslint`, which pnpm resolves to a different version from
 *    the one at the root. The rules then walk an AST built by a different version than they
 *    were compiled against, and `no-unused-vars` dies on `node.params is not iterable`. One
 *    parser for every file removes the class of problem rather than this instance of it.
 */
const nextRules = nextCoreWebVitals
  .filter((config) => config.name !== 'next/typescript')
  .map(({ languageOptions, ...config }) => ({
    ...config,
    files: ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'],
    ...(languageOptions
      ? {
          languageOptions: Object.fromEntries(
            Object.entries(languageOptions).filter(([key]) => key !== 'parser'),
          ),
        }
      : {}),
  }));

export default tseslint.config(
  {
    // Build output and generated artefacts. Linting these reports thousands of problems in
    // code nobody wrote.
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.turbo/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextRules,

  {
    // Node scripts — fixture recording, the demo capture, GIF encoding. These are real Node
    // programs rather than bundled source, so they need Node's globals declared.
    files: ['**/*.mjs', '**/scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'],
    rules: {
      /**
       * Checks that `<a>` elements do not point at routes the Pages Router would own. This
       * app is App Router only, so the rule has no directory to read and prints a warning
       * about a missing `pages/` on every run — noise about an absence that is correct.
       */
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  {
    rules: {
      /**
       * An unused parameter prefixed with an underscore is a deliberate signal that a
       * signature is being honoured without using every argument — `(_query, ctx)` in a
       * provider adapter, for instance. Reporting those trains people to ignore the rule.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
