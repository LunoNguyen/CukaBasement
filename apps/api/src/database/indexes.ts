import type mongoose from 'mongoose'

/**
 * Builds every index declared by the registered models (including unique and TTL indexes,
 * which each schema file declares itself) and drops indexes no longer declared.
 */
export async function ensureIndexes(conn: mongoose.Connection): Promise<void> {
  for (const model of Object.values(conn.models)) {
    await model.syncIndexes()
  }
}
