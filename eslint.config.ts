import eslint from '@eslint/js';
import typescriptParser from '@typescript-eslint/parser';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint, { Config } from 'typescript-eslint';

const config: Config = tseslint.config([
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        project: 'tsconfig.json',
      },
    },
    rules: {},
  },
  eslint.configs.recommended,
  eslintPluginPrettierRecommended,
  tseslint.configs.recommended,
  {
    ignores: ['dist/**/*', 'build/**/*'],
  },
]);

export default config;
