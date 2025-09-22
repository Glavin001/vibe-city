/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const includeStorybook = process.env.RUN_STORYBOOK_TESTS === '1';

const nodeProject = {
  test: {
    environment: 'node' as const,
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
};

const projects = [nodeProject];

if (includeStorybook) {
  projects.push({
    extends: true,
    plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook'),
      }),
    ],
    test: {
      name: 'storybook',
      browser: {
        enabled: true,
        headless: true,
        provider: 'playwright',
        instances: [
          {
            browser: 'chromium',
          },
        ],
      },
      setupFiles: ['.storybook/vitest.setup.ts'],
    },
  });
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}'],
    testTimeout: 30000,
    hookTimeout: 60000,
    projects,
  },
});
