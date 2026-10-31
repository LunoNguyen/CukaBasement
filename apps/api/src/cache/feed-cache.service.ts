import { createHash, randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Redis } from 'ioredis'
import { CONFIG, type Config } from '../config/config'

/** Short enough that counters and presigned URLs (10 min) stay fresh without an invalidation. */
export const FEED_CACHE_TTL_SEC = 45
/** Holds a random token replaced on every bump; cache keys embed it, so a bump orphans every entry at once. */
export const FEED_GEN_KEY = 'cuka:feed:gen'
const ENTRY_PREFIX = 'cuka:feed:v1:'
const WARN_EVERY_MS = 60_000

/** What jobs need to invalidate the public lists (the worker passes FeedCache itself). */
export interface FeedGen {
  bump(): Promise<void>
}

/**
 * Redis cache for public, viewer-independent list pages (home feed, search, tag pages). Fail-open: with Redis
 * disabled, unreachable or slow, every call falls through to `compute` and a warning is logged at most once a minute.
 *
 * Invalidation is a generation token: `bump()` after any change that can alter a list (moderation, edits and deletes
 * of listed posts, profile changes shown on cards, worker variant publishes) replaces it, and entries under the old
 * token just expire. A bump that cannot reach Redis is remembered and retried on reconnect; until it lands this
 * process serves no cached entry, so a hidden post cannot come back from the cache.
 */
@Injectable()
export class FeedCache implements FeedGen, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('FeedCache')
  private readonly client: Redis | null
  private pendingBump = false
  private lastWarnAt = 0

  constructor(@Inject(CONFIG) config: Config) {
    this.client = config.redis.disabled
      ? null
      : new Redis(config.redis.url, {
          lazyConnect: true,
          connectTimeout: 1000,
          commandTimeout: 250,
          // Commands fail at once while disconnected instead of queueing behind a reconnect.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => Math.min(times * 200, 5000),
        })
    this.client?.on('error', (err: Error) => this.warn(err))
    this.client?.on('ready', () => void this.flushBump())
  }

  onModuleInit(): void {
    // Not awaited: the app starts (and serves from Mongo) whether or not Redis is up.
    this.client?.connect().catch((err: Error) => this.warn(err))
  }

  onModuleDestroy(): void {
    this.client?.disconnect()
  }

  /** True once connected; for tests and diagnostics. */
  get ready(): boolean {
    return this.client?.status === 'ready'
  }

  /**
   * The cached JSON of `compute()` under (`kind`, `params`); `params` must hold everything the result depends on.
   * Errors from `compute` propagate and are not cached. `ttlSeconds` overrides the default lifetime (bumps still drop it).
   */
  async wrap<T>(kind: string, params: unknown, compute: () => Promise<T>, ttlSeconds = FEED_CACHE_TTL_SEC): Promise<T> {
    const c = this.usable()
    if (!c) return compute()
    let key: string
    try {
      const gen = await c.get(FEED_GEN_KEY)
      if (!gen) {
        // First use or an evicted token: start a fresh generation, never reuse entries of an old one.
        await c.set(FEED_GEN_KEY, randomUUID(), 'NX')
        return compute()
      }
      key = `${ENTRY_PREFIX}${gen}:${kind}:${createHash('sha256').update(JSON.stringify(params)).digest('hex')}`
      const hit = await c.get(key)
      if (hit !== null) return JSON.parse(hit) as T
    } catch (err) {
      this.warn(err as Error)
      return compute()
    }
    const value = await compute()
    c.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch((err: Error) => this.warn(err))
    return value
  }

  /** Invalidates every cached list. Never throws. */
  async bump(): Promise<void> {
    if (!this.client) return
    this.pendingBump = true
    await this.flushBump()
  }

  private async flushBump(): Promise<void> {
    if (!this.pendingBump || this.client?.status !== 'ready') return
    try {
      await this.client.set(FEED_GEN_KEY, randomUUID())
      this.pendingBump = false
    } catch (err) {
      this.warn(err as Error)
    }
  }

  /** The client when it can serve cached entries right now. */
  private usable(): Redis | null {
    if (this.client?.status !== 'ready') return null
    if (this.pendingBump) {
      void this.flushBump()
      return null
    }
    return this.client
  }

  private warn(err: Error): void {
    const now = Date.now()
    if (now - this.lastWarnAt < WARN_EVERY_MS) return
    this.lastWarnAt = now
    this.logger.warn(`Redis unavailable, serving lists from MongoDB: ${err.message}`)
  }
}
