import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the `npm run screens*` commands write their pictures: the `screenshots` folder at the root of the repository,
 * which git ignores, or the folder GB_SCREENS_DIR names. Each command makes its own folders inside it; nothing needs to
 * exist first, and the pictures are for looking at, not for a test to compare.
 */
export const SCREENS_OUT = process.env.GB_SCREENS_DIR
  ? path.resolve(process.env.GB_SCREENS_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'screenshots')
