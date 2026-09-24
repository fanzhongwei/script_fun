import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const configured = '__BASE_PATH__'
const isStatic = process.env.STATIC_EXPORT === '1'
const basePath = isStatic && configured === '/' ? './' : configured

export default defineConfig({
  base: basePath,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:__PORT__',
        changeOrigin: true,
      },
    },
  },
})
