import { app } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface MemoryStats {
  rssMB: number
  heapTotalMB: number
  heapUsedMB: number
  externalMB: number
  arrayBuffersMB: number
  timestamp: number
}

export class MemoryMonitorService {
  private timer: NodeJS.Timeout | null = null
  private readonly HEAP_WARN_THRESHOLD_MB = 600

  constructor(
    private readonly onMemoryThresholdExceeded?: () => void
  ) {}

  public start(intervalMs: number = 30_000): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.checkMemory()
    }, intervalMs)
    this.timer.unref()
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  public getMemoryStats(): MemoryStats {
    const mem = process.memoryUsage()
    const toMB = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 100) / 100
    return {
      rssMB: toMB(mem.rss),
      heapTotalMB: toMB(mem.heapTotal),
      heapUsedMB: toMB(mem.heapUsed),
      externalMB: toMB(mem.external),
      arrayBuffersMB: toMB(mem.arrayBuffers || 0),
      timestamp: Date.now()
    }
  }

  private checkMemory(): void {
    const stats = this.getMemoryStats()
    if (stats.heapUsedMB > this.HEAP_WARN_THRESHOLD_MB) {
      console.warn(
        `[MemoryMonitor] High memory usage detected! Heap Used: ${stats.heapUsedMB} MB / RSS: ${stats.rssMB} MB`
      )
      // Force V8 GC if --expose-gc flag was passed
      if (typeof global.gc === 'function') {
        try {
          global.gc()
          console.log('[MemoryMonitor] Explicit global.gc() executed successfully.')
        } catch (err) {
          console.error('[MemoryMonitor] Failed to run global.gc():', err)
        }
      }
      this.onMemoryThresholdExceeded?.()
    }
  }

  public takeHeapSnapshot(): string {
    const v8 = require('node:v8')
    const fileName = `heap-${Date.now()}.heapsnapshot`
    const filePath = join(app.getPath('userData'), fileName)
    const snapshotStream = v8.getHeapSnapshot()
    const chunks: Buffer[] = []
    snapshotStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    snapshotStream.on('end', () => {
      writeFileSync(filePath, Buffer.concat(chunks))
      console.log(`[MemoryMonitor] Heap snapshot saved to ${filePath}`)
    })
    return filePath
  }
}
