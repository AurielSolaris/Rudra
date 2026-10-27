// @ts-check
/**
 * ESLint 10 flat config.
 *
 * Type-checked rules are on. They are much of the reason we left Python
 * (PLAN.MD §3): a linter that cannot see types catches typos, while one that can
 * catches unawaited promises, unsafe `any` flowing into a call, and conditionals
 * on a value that can never be falsy.
 *
 * Formatting is Prettier's job, not ESLint's. `eslint-config-prettier` is last
 * so it switches off anything stylistic that would fight the formatter —
 * including our 3-space indent.
 *
 * Uses `defineConfig` from `eslint/config`; `tseslint.config()` is deprecated in
 * favour of it.
 */

import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default defineConfig([
   globalIgnores([
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      // Flutter owns app/; the Dart analyzer lints it.
      'app/**',
      // Vendored agent skills are not ours to lint.
      '.agents/**',
      // This file is not part of any tsconfig project, so type-checked rules
      // cannot run on it. It is `@ts-check`ed instead.
      'eslint.config.mjs',
   ]),

   {
      files: ['**/*.ts'],
      extends: [
         eslint.configs.recommended,
         tseslint.configs.strictTypeChecked,
         tseslint.configs.stylisticTypeChecked,
      ],
      languageOptions: {
         parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
         },
      },
      rules: {
         // ---- Correctness we actually care about ------------------------------
         // A dropped promise in the agent loop is a silently lost turn.
         '@typescript-eslint/no-floating-promises': 'error',
         '@typescript-eslint/no-misused-promises': 'error',
         '@typescript-eslint/await-thenable': 'error',
         '@typescript-eslint/require-await': 'error',

         // Exhaustiveness: the stream-event union must be fully handled.
         '@typescript-eslint/switch-exhaustiveness-check': 'error',

         // Keep `import type` explicit so the emit stays predictable.
         '@typescript-eslint/consistent-type-imports': [
            'error',
            { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
         ],

         '@typescript-eslint/no-unnecessary-condition': [
            'error',
            { allowConstantLoopConditions: true },
         ],

         // Interpolating a number is safe and readable; the rest of the rule
         // (objects, nullables) still applies.
         '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

         // Unused args are fine when prefixed with _, which reads better than
         // deleting a parameter you need for position.
         '@typescript-eslint/no-unused-vars': [
            'error',
            { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
         ],

         // ---- House style -----------------------------------------------------
         // INVARIANT 18 (MAP.txt): stdout belongs to the handshake line alone.
         // The logger writes to stderr; a stray console.log corrupts boot.
         'no-console': 'error',
         eqeqeq: ['error', 'always', { null: 'ignore' }],
         'no-param-reassign': 'error',
         'prefer-const': 'error',
      },
   },

   {
      // The codegen walks untyped JSON Schema by design.
      files: ['tooling/schema-to-dart/**/*.ts'],
      rules: {
         '@typescript-eslint/no-unsafe-member-access': 'off',
         '@typescript-eslint/no-unsafe-assignment': 'off',
         '@typescript-eslint/no-unnecessary-condition': 'off',
      },
   },

   {
      // The smoke runner's entire output is a console report.
      files: ['tooling/smoke/**/*.ts'],
      rules: { 'no-console': 'off' },
   },

   {
      files: ['**/test/**/*.ts', '**/*.test.ts'],
      rules: {
         // Tests assert on shapes the contract already guarantees; that is the
         // point of the assertion, not a redundancy.
         '@typescript-eslint/no-unnecessary-condition': 'off',
         '@typescript-eslint/no-non-null-assertion': 'off',
      },
   },

   prettier,
]);
