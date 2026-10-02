import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Where the proxy points. It can be redirected via NEXCANVAS_API.
const apiTarget = process.env.NEXCANVAS_API || 'http://127.0.0.1:8500'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely. In their own file, they stay cached in the browser after an update.
        // pdf.js and the picture export load only when a PDF lies on the board or someone exports.
        manualChunks(id) {
          if (id.includes('node_modules/pdfjs-dist')) return 'pdfjs'
          if (id.includes('node_modules/html-to-image')) return 'export'
          if (id.includes('node_modules')) return 'vendor'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    exclude: ['node_modules/**', 'dist/**'],
  },
  server: {
    // Fixed port: if it is taken, Vite aborts instead of silently falling back to another one.
    port: 5500,
    strictPort: true,
    proxy: {
      // ws: the live connection of a board runs through the same address.
      '/api': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },
  preview: {
    port: 5500,
    strictPort: true,
  },
})
