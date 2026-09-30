import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'cdk.out/**', 'dist/**', 'coverage/**', 'pnpm-lock.yaml']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      'no-console': 'off',
      eqeqeq: ['error', 'always']
    }
  },
  {
    // Console output is the entire point of the validation scripts.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off'
    }
  }
);
