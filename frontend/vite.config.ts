import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    minify: false,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
