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

  constructor(
    private readonly workerFileName: string,
    private readonly interceptor?: MessageInterceptor
  ) {}

  /** 向 Worker 发送请求并等待结果 */
  send<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.getWorker().postMessage({ id, type, payload } satisfies WorkerRequest)
    })
  }

  /** 关闭 Worker 线程 */
  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
      this.pendingRequests.clear()
    }
  }

  /** 获取或创建 Worker 实例（懒初始化单例） */
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
      })

      this.worker.on('error', (error) => {
        // Worker 崩溃时拒绝所有待处理请求
        for (const [, pending] of this.pendingRequests) {
          pending.reject(error)
        }
        this.pendingRequests.clear()
        this.worker = null
      })

      this.worker.on('exit', (code) => {
        // Worker 因 OOM 或 process.exit() 退出时（可能不触发 error 事件），
        // 必须拒绝所有待处理请求，否则 Promise 将永久 pending 致界面卡死
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
}
