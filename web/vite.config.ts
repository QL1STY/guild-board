import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // Vitest loads every stylesheet as an empty one, except those a test reads as text: `import css from './x.css?raw'`.
  test: { include: ['src/**/*.test.ts'], environment: 'node', css: { include: [/\.css\?raw$/] } },
})
