import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    root: './',
    // интеграционные поднимают базу и фейковый YAZIO — им нужно больше времени
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
