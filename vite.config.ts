import { defineConfig } from 'vite';

// Dev server proxies jetsetradio.live so Web Audio can analyse the MP3s (they send no CORS headers).
export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/jsr': {
        target: 'https://jetsetradio.live',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/jsr/, ''),
      },
    },
  },
});
