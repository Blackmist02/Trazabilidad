import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// Sitio de proyecto en GitHub Pages: https://blackmist02.github.io/Trazabilidad/
const base = process.env.BASE_PATH ?? '/Trazabilidad/';

export default defineConfig({
  base,
  // zxing + supabase-js ocupan la mayor parte; el service worker los guarda en caché tras la primera carga.
  build: { chunkSizeWarningLimit: 1100 },
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)}`),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Trazabilidad · Escáner de stand',
        short_name: 'Trazabilidad',
        description: 'Registro de visitas al stand mediante el QR de la credencial.',
        lang: 'es-CL',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // El motor OCR (~6 MB) no se precarga: se guarda en caché la primera vez que se usa.
        globIgnores: ['ocr/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 10 } },
          },
        ],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
