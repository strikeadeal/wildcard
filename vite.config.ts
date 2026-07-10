/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Precache the self-hosted display font so it works fully offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // iOS snapshots the splash image at install time from the DOM/meta tag,
        // not the SW cache — keep these heavy, install-only assets out of every
        // client's precache.
        globIgnores: ['**/splash-*.png']
      },
      manifest: {
        name: 'WILDCARD — the classic card game',
        short_name: 'WILDCARD',
        description: 'Play the classic card game online with friends. No ads, no accounts.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#123026',
        theme_color: '#123026',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  test: { include: ['tests/**/*.test.ts'] }
});
