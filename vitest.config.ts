import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@preload': resolve('src/preload'),
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/unit/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'out/**', 'dist/**']
  }
})
