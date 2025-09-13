/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  test: {
    // This config is used for the default (node) test project
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}'],
    testTimeout: 30000,
    hookTimeout: 60000,
    projects: [
      // Node tests (default)
      {
        test: {
          environment: 'node',
          globals: true,
          include: ['src/**/*.{test,spec}.{ts,js}'],
          testTimeout: 30000,
          hookTimeout: 60000,
        }
      },
      // Storybook tests (browser)
      {
        extends: true,
        plugins: [
        // The plugin will run tests for the stories defined in your Storybook config
        // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
        storybookTest({
          configDir: path.join(dirname, '.storybook')
        })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: 'playwright',
            instances: [{
              browser: 'chromium'
            }]
          },
          setupFiles: ['.storybook/vitest.setup.ts']
        }
      }
    ]
  }
});