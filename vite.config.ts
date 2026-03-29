import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Set to `/<repo-name>/` when deploying to GitHub Pages (see `.github/workflows/deploy-pages.yml`). */
function viteBase(): string {
  let b = (process.env.BASE_PATH ?? '/').trim()
  if (!b || b === '/') return '/'
  if (!b.startsWith('/')) b = `/${b}`
  return b.endsWith('/') ? b : `${b}/`
}

const base = viteBase()

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Piano Learner',
        short_name: 'PianoLearner',
        description: 'Learn piano with MIDI files, piano roll, and practice modes',
        theme_color: '#1a1a24',
        background_color: '#12121a',
        display: 'standalone',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
})
