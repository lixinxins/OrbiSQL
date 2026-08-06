/**
 * 渲染进程统一请求层（优化方案 P1-3）
 *
 * 提供两个能力：
 * - 并发去重：相同 key 的进行中请求共享同一个 Promise，避免重复 IPC；
 * - TTL 缓存：key → 值，过期自动失效。
 *
 * Zustand store 与组件通过 cachedRequest 封装统一的 load* 流程，
 * 避免各组件各自维护 loading/error 与重复请求。
 */

interface CacheEntry {
  value: unknown
  expiresAt: number
}

const ttlCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<unknown>>()

export interface CachedRequestOptions {
  /** 缓存有效期(ms)；0 表示不缓存、仅做并发去重 */
  ttlMs?: number
  /** true 时跳过缓存与进行中去重，强制重新请求 */
  force?: boolean
}

export async function cachedRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CachedRequestOptions = {}
): Promise<T> {
  const { ttlMs = 0, force = false } = options

  if (!force && ttlMs > 0) {
    const hit = ttlCache.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.value as T
  }

  if (!force) {
    const pending = inFlight.get(key)
    if (pending) return pending as Promise<T>
  }

  const promise = fetcher().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key)
  })
  inFlight.set(key, promise)

  const value = await promise
  if (ttlMs > 0) {
    ttlCache.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
  return value
}

/** 使指定 key 的缓存失效（不影响进行中请求） */
export function invalidateCache(key: string): void {
  ttlCache.delete(key)
}

/** 使指定前缀的全部缓存失效 */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of Array.from(ttlCache.keys())) {
    if (key.startsWith(prefix)) ttlCache.delete(key)
  }
}

/** 清空全部缓存与进行中请求引用 */
export function clearRequestCache(): void {
  ttlCache.clear()
  inFlight.clear()
}
