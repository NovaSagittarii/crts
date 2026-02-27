import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsconfigProjects = ['./tsconfig.json', './tsconfig.client.json'];
const tsFiles = ['**/*.{ts,tsx,mts,cts}'];

// `typescript-eslint` publishes config arrays that may include some entries
// without `files` restrictions. Ensure typed rules only apply to TS sources.
const recommendedTypeChecked = tseslint.configs.recommendedTypeChecked.map(
  (config) => ({
    ...config,
    files: config.files ?? tsFiles,
  }),
);

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'conway-rts/**', '.planning/**'],
  },

  js.configs.recommended,

  ...recommendedTypeChecked,

  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        project: tsconfigProjects,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Prefer the TS-aware version when type-checking.
      'no-unused-vars': 'off',
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

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
  },
  {
    files: [
      'apps/server/**/*.{ts,tsx}',
      'packages/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.vitest,
      },
    },
  },
);
