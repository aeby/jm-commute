import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@jobmate\/commute\/node$/u,
        replacement: fileURLToPath(
          new URL('./packages/commute/src/node.ts', import.meta.url),
        ),
      },
      {
        find: /^@jobmate\/commute$/u,
        replacement: fileURLToPath(
          new URL('./packages/commute/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@commute-internal\/(.*)$/u,
        replacement: fileURLToPath(
          new URL('./packages/commute/src/$1', import.meta.url),
        ),
      },
      {
        find: '@core',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
    ],
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/public/generated/**'],
  },
});
