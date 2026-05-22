import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Strip crossorigin so Electron's file:// URL doesn't trigger CORS on assets.
const removeHtmlCrossorigin = {
  name: 'remove-crossorigin',
  transformIndexHtml(html) {
    return html.replace(/ crossorigin(?:="[^"]*")?/g, '')
  },
}

export default defineConfig({
  plugins: [react(), removeHtmlCrossorigin],
  base: './',
  define: {
    // Expose app version to the renderer (used by Footer)
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
})
