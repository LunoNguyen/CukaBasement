import { fileURLToPath, URL } from 'node:url'

import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// The api listens on API_PORT (default 3000), read like the api does: the environment, then the repository root .env.
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const api = `http://localhost:${loadEnv(mode, ROOT, '').API_PORT || 3000}`
  return {
    plugins: [vue(), tailwindcss(), vueDevTools()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // The ES sources, not the CommonJS build: lets the bundle tree-shake what the web never uses (zod schemas).
        '@cuka/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
    },
    server: {
      proxy: { '/api': api, '/og': api },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['test/setup.ts'],
      include: ['test/**/*.test.ts'],
    },
  }
})
