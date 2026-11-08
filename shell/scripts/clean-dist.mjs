// Empties dist/ before a build. Neither tsc nor copy-pages.mjs deletes anything, so a module or a page removed from src/
// would otherwise stay in dist/, and be packed into the asar (a page there stays loadable in the gb-dialog partition).
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

rmSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'), { recursive: true, force: true })
