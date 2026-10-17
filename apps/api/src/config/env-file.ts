import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** The repository root `.env`; this file sits at the same depth in `src/` and `dist/`. */
export const ROOT_ENV_FILE = resolve(__dirname, '../../../../.env')

/**
 * Loads `file` into `process.env` when it exists (variables already set win). Used by the api, the worker and the
 * setup / create-admin scripts so all of them read the same root `.env`. Returns whether a file was loaded.
 */
export function loadEnvFile(file: string = ROOT_ENV_FILE): boolean {
  if (!existsSync(file)) return false
  process.loadEnvFile(file)
  return true
}
