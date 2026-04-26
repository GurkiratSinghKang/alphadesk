import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Round-11 / Z-1 (P0): previously ``src/app/**`` was excluded
      // from coverage measurement entirely, which made the 869-test
      // pass count include ZERO route-level rendering signal —
      // Round-9 reflow + Round-10 mobile/perf fixes shipped without
      // any route-level test ever running. Drop the exclusion so
      // coverage actually surfaces the gap. UI primitives in
      // ``components/ui/**`` stay excluded — those are
      // shadcn/base-ui passthroughs that live their own life.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/__tests__/**', 'src/components/ui/**'],
      reporter: ['text', 'text-summary'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
