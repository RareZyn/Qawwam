import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Qawwam',
        short_name: 'Qawwam',
        description: 'Habits, money, passwords, to-dos, books and reminders in one place.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#080402',
        theme_color: '#080402',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Quick spend', url: '/money?quick=1' },
          { name: 'Habits', url: '/habits' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Only the Latin font files are needed; skip the other scripts so install stays small.
        globIgnores: ['**/*-cyrillic*', '**/*-greek*', '**/*-vietnamese*', '**/*-latin-ext*'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // The largest chunk is the Firestore SDK itself (offline cache + live listeners), ~165 kB gzipped.
  build: { target: 'es2022', chunkSizeWarningLimit: 600 },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'node',
    env: { VITE_USE_EMULATOR: '1' },
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
