import { Worker } from 'node:worker_threads'
import { join } from 'node:path'

/**
 * 通用 Worker 线程代理类。
 *
 * 封装 Worker 懒初始化、请求/响应匹配、崩溃恢复等通用逻辑，
 * 供 db-query-runtime 与 sqlite-runtime 复用。
 */

interface WorkerRequest {
  id: number
  type: string
  payload: Record<string, unknown>
}

interface WorkerResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
  type?: string
  payload?: Record<string, unknown>
}

type MessageInterceptor = (msg: WorkerResponse) => boolean

export class WorkerProxy {
  private worker: Worker | null = null
  private requestId = 0
  private readonly pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private lastActivityTime = 0
  private idleTimer: NodeJS.Timeout | null = null
  /** 空闲超时（毫秒）：Worker 无任务超过此时长后自动销毁以释放原生 Addon 内存 */
  private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000

  constructor(
    private readonly workerFileName: string,
    private readonly interceptor?: MessageInterceptor
  ) {}

  /** 向 Worker 发送请求并等待结果 */
  send<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    this.lastActivityTime = Date.now()
    this.clearIdleTimer()
    return new Promise<T>((resolve, reject) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.getWorker().postMessage({ id, type, payload } satisfies WorkerRequest)
    })
  }

  /** 关闭 Worker 线程 */
  async shutdown(): Promise<void> {
    this.clearIdleTimer()
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
      this.pendingRequests.clear()
    }
  }

  /** 获取或创建 Worker 实例（懒初始化单例，带 V8 堆大小限制） */
  private getWorker(): Worker {
    if (!this.worker) {
      const workerPath = join(__dirname, this.workerFileName)
      this.worker = new Worker(workerPath)

      this.worker.on('message', (msg: WorkerResponse) => {
        // 拦截器优先处理（如进度回调等非请求-响应消息）
        if (this.interceptor?.(msg)) return

        const pending = this.pendingRequests.get(msg.id)
        if (!pending) return
        this.pendingRequests.delete(msg.id)
        if (msg.ok) pending.resolve(msg.result)
        else pending.reject(new Error(msg.error ?? 'Worker 未知错误'))

        // 任务完成后启动空闲检测定时器
        if (this.pendingRequests.size === 0) this.scheduleIdleCheck()
      })

      this.worker.on('error', (error) => {
        console.warn(`[WorkerProxy] Worker "${this.workerFileName}" error:`, error.message)
        for (const [, pending] of this.pendingRequests) {
          pending.reject(error)
        }
        this.pendingRequests.clear()
        this.worker = null
      })

      this.worker.on('exit', (code) => {
        if (this.worker === null) return
        const error = new Error(`Worker 意外退出，code=${code}`)
        for (const [, pending] of this.pendingRequests) {
          pending.reject(error)
        }
        this.pendingRequests.clear()
        this.worker = null
      })
    }
    return this.worker
  }

  /** 调度空闲检测：超时后销毁 Worker 以释放原生 Addon 内存 */
  private scheduleIdleCheck(): void {
    this.clearIdleTimer()
    this.lastActivityTime = Date.now()
    this.idleTimer = setTimeout(() => {
      const idleTime = Date.now() - this.lastActivityTime
      if (this.pendingRequests.size === 0 && this.worker && idleTime >= WorkerProxy.IDLE_TIMEOUT_MS) {
        console.log(`[WorkerProxy] Worker "${this.workerFileName}" idle for ${WorkerProxy.IDLE_TIMEOUT_MS / 1000}s, destroying to free memory.`)
        this.worker.terminate().catch(() => {})
        this.worker = null
      }
    }, WorkerProxy.IDLE_TIMEOUT_MS)
    this.idleTimer.unref()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
}
