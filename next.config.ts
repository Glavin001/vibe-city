import type { NextConfig } from "next";
const path = require('path')
const CopyWebpackPlugin = require('copy-webpack-plugin')

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ['three'],
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve?.fallback || {}),
      fs: false,
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer'),
      assert: require.resolve('assert'),
    };

    // Provide globals for buffer/process if needed by deps
    config.plugins = config.plugins || [];
    const webpack = require('webpack');
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser',
      }),
    )

    // Copy ONNX Runtime and VAD assets to public/vad/ so runtime can fetch them at '/vad/'
    config.plugins.push(
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'node_modules/onnxruntime-web/dist/*.wasm',
            to: '../public/vad/[name][ext]',
          },
          {
            from: 'node_modules/onnxruntime-web/dist/*.mjs',
            to: '../public/vad/[name][ext]',
          },
          {
            from: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
            to: '../public/vad/[name][ext]',
          },
          {
            from: 'node_modules/@ricky0123/vad-web/dist/*.onnx',
            to: '../public/vad/[name][ext]',
          },
        ],
      })
    )

    // Alias Node-only deps to browser shims
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'mahler-wasm': path.resolve(__dirname, 'src/shims/mahler-wasm.ts'),
      'timers/promises': path.resolve(__dirname, 'src/shims/timers-promises.ts'),
    }

    return config;
  },
};

export default nextConfig;
