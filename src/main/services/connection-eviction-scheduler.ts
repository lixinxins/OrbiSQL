/**
 * 连接池空闲驱逐调度器。
 *
 * 定期（默认 5 分钟）扫描所有数据库适配器的连接池/客户端缓存，
 * 关闭并移除空闲超过阈值（默认 15 分钟）的池实例，释放 Socket 句柄与原生内存。
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const MAX_IDLE_MS = 15 * 60 * 1000

export class ConnectionEvictionScheduler {
  private timer: NodeJS.Timeout | null = null

  /** 启动定时驱逐（timer.unref() 不阻止进程退出） */
  start(intervalMs: number = CHECK_INTERVAL_MS, maxIdleMs: number = MAX_IDLE_MS): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.evictAll(maxIdleMs).catch((err) => {
        console.warn('[ConnectionEviction] Eviction cycle error:', err)
      })
    }, intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 手动触发一轮全引擎驱逐 */
  async evictAll(maxIdleMs: number = MAX_IDLE_MS): Promise<void> {
    const [
      mysql,
      postgres,
      dm,
      kingbase,
      mssql,
      mongodb,
      clickhouse,
      redis,
      sqlite,
      duckdb
    ] = await Promise.all([
      import('./adapters/mysql-adapter'),
      import('./adapters/postgresql-adapter'),
      import('./adapters/dm-adapter'),
      import('./adapters/kingbase-adapter'),
      import('./adapters/sqlserver-adapter'),
      import('./adapters/mongodb-adapter'),
      import('./adapters/clickhouse-adapter'),
      import('./adapters/redis-adapter'),
      import('./adapters/sqlite-adapter'),
      import('./adapters/duckdb-adapter')
    ])

    const evictors: Array<Promise<void>> = [
      mysql.evictIdleMysqlPools(maxIdleMs),
      postgres.evictIdlePostgresPools(maxIdleMs),
      dm.evictIdleDmPools(maxIdleMs),
      kingbase.evictIdleKbPools(maxIdleMs),
      mssql.evictIdleMssqlPools(maxIdleMs),
      mongodb.evictIdleMongoClients(maxIdleMs),
      clickhouse.evictIdleChClients(maxIdleMs),
      redis.evictIdleRedisClients(maxIdleMs),
      sqlite.evictIdleSqliteHandles(maxIdleMs),
      duckdb.evictIdleDuckDbHandles(maxIdleMs)
    ]
    await Promise.allSettled(evictors)
  }
}

/** 全局单例，供 main 进程直接使用 */
export const connectionEvictionScheduler = new ConnectionEvictionScheduler()
