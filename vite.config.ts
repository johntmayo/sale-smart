import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pagesBase = process.env.PAGES_BASE

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use /repo-name/ on GitHub Pages; keep relative paths for local preview.
  base: pagesBase ?? './',
})
