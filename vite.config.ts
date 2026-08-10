import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

/**
 * `base` — под GitHub Pages: project page живёт в `/<repo>/`, а не в корне.
 * Переопределяется переменной `BASE_PATH`, чтобы локальный `dev`/`preview`
 * (и любой другой хостинг) работали от корня без правки конфига.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
})
