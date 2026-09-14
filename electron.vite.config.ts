import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@preload': resolve('src/preload'),
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
