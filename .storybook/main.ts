import type { StorybookConfig } from "@storybook/nextjs-vite";
import type { InlineConfig } from 'vite';

const config: StorybookConfig = {
  "stories": [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@chromatic-com/storybook",
    "@storybook/addon-docs",
    "@storybook/addon-onboarding",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest"
  ],
  "framework": {
    "name": "@storybook/nextjs-vite",
    "options": {}
  },
  // Fine-tune Vite to ensure Web Workers (ESM) and large deps like transformers.js work well
  // with the Storybook Vite builder.
  async viteFinal(config) {
    // Ensure workers use ESM format
    const viteConfig = config as unknown as InlineConfig;
    viteConfig.worker = viteConfig.worker ?? {};
    viteConfig.worker.format = 'es';

    // Exclude heavy lib from optimizeDeps pre-bundling to avoid issues in workers
    viteConfig.optimizeDeps = viteConfig.optimizeDeps ?? {};
    const exclude = new Set([...(viteConfig.optimizeDeps.exclude || []), '@huggingface/transformers']);
    viteConfig.optimizeDeps.exclude = Array.from(exclude);

    // Target modern output so WebGPU/ESM features are preserved
    viteConfig.build = viteConfig.build ?? {};
    viteConfig.build.target = 'esnext';

    return viteConfig as unknown as typeof config;
  },
  "staticDirs": [
    "../public"
  ]
};
export default config;
