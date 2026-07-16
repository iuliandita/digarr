import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Fallbacks ('dev'/'local') must stay in sync with src/version.ts.
  define: {
    'process.env.DIGARR_GIT_SHA': JSON.stringify(process.env.DIGARR_GIT_SHA ?? 'dev'),
    'process.env.DIGARR_CHANNEL': JSON.stringify(process.env.DIGARR_CHANNEL ?? 'local'),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  root: '.',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'index.html'),
        spotifyBridge: path.resolve(__dirname, 'spotify-embed-bridge.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    alias: { '@': path.resolve(__dirname, './src') },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/web/**/*.tsx',
        'src/index.ts',
        'src/**/types.ts',
        'src/**/*.d.ts',
        'src/core/i18n/messages/**',
        'src/db/schema.ts',
        'src/server/openapi.ts',
        'drizzle/**',
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 78,
      },
    },
  },
})
