// Copies the shell's own dialog pages (src/pages: html, css and the pages' scripts) next to the compiled preload in
// dist/pages, where the guard (gb-dialog) lets them load and the packaging finds them. tsc compiles the preload itself.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'src', 'pages')
const to = join(root, 'dist', 'pages')
mkdirSync(to, { recursive: true })
for (const name of readdirSync(from)) {
  if (/\.(html|css|js)$/.test(name)) cpSync(join(from, name), join(to, name))
}
