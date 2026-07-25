import { useEffect, useState, useCallback } from 'react'
import {
  ArrowsClockwise,
  CircleNotch,
  Database,
  MagnifyingGlass,
  Prohibit,
  Rows,
  Trash,
  X
} from '@phosphor-icons/react'
import type { DatabaseConnection, ProcessItem } from '@/shared/connections'
import { useConfirmDialog } from './ConfirmDialog'
import { useToast } from '../contexts/ToastContext'

interface ProcessListDialogProps {
  connection: DatabaseConnection
  onClose: () => void
}

export default function ProcessListDialog({ connection, onClose }: ProcessListDialogProps) {
  const [loading, setLoading] = useState(true)
  const [killingId, setKillingId] = useState<string | number | null>(null)
  const [processes, setProcesses] = useState<ProcessItem[]>([])
  const [search, setSearch] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [rawSql, setRawSql] = useState('')

  const { confirm, confirmDialog } = useConfirmDialog()
  const { showToast } = useToast()

  const fetchProcesses = useCallback(async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const res = await window.omnidb.connections.getProcessList(connection.id)
      if (res.success && res.processes) {
        setProcesses(res.processes)
        if (res.rawSql) setRawSql(res.rawSql)
      } else {
        setErrorMsg(res.message || '获取活动进程失败')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  useEffect(() => {
    void fetchProcesses()
  }, [fetchProcesses])

  const handleKill = async (proc: ProcessItem) => {
    const confirmed = await confirm({
      title: '终止活动进程',
      message: `确定要终止进程 ID【${proc.id}】吗？`,
      detail: `对应用户: ${proc.user || '-'} | 客户端: ${proc.host || '-'} | 正在运行: ${proc.info ? proc.info.slice(0, 100) : proc.command || '-'}`,
      confirmLabel: '确认终止'
    })
    if (!confirmed) return

    setKillingId(proc.id)
    try {
      const res = await window.omnidb.connections.killProcess(connection.id, proc.id)
      if (res.success) {
        showToast('success', res.message || `进程 ${proc.id} 已成功终止`)
        void fetchProcesses()
      } else {
        showToast('error', res.message || `终止进程 ${proc.id} 失败`)
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setKillingId(null)
    }
  }

  const filtered = processes.filter((p) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      String(p.id).toLowerCase().includes(q) ||
      (p.user && p.user.toLowerCase().includes(q)) ||
      (p.host && p.host.toLowerCase().includes(q)) ||
      (p.db && p.db.toLowerCase().includes(q)) ||
      (p.command && p.command.toLowerCase().includes(q)) ||
      (p.info && p.info.toLowerCase().includes(q))
    );
  })

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="dialog-card process-list-dialog"
          style={{ width: '90%', maxWidth: 1100, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="dialog-header">
            <div className="dialog-header-title">
              <Rows weight="fill" className="dialog-header-icon" />
              <div>
                <h2>活动会话与进程 · {connection.name}</h2>
                <p>
                  引擎: {connection.engine} | 主机: {connection.host}:{connection.port || '-'} | 当前管理连接包含的所有实时进程
                </p>
              </div>
            </div>
            <button type="button" className="dialog-close-btn" onClick={onClose} aria-label="关闭">
              <X />
            </button>
          </header>

          <div className="process-list-toolbar" style={{ padding: '12px 20px', display: 'flex', gap: 12, alignItems: 'center', background: 'var(--bg-subtle, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
            <label className="connection-search" style={{ flex: 1, margin: 0 }}>
              <MagnifyingGlass />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索进程 ID、用户、主机、数据库或 SQL..."
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => void fetchProcesses()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {loading ? <CircleNotch className="database-load-spinner" /> : <ArrowsClockwise />}
              刷新
            </button>
          </div>

          <div className="dialog-body" style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
            {loading && !processes.length ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
                <CircleNotch size={32} className="database-load-spinner" style={{ margin: '0 auto 12px' }} />
                <p>正在读取活动进程数据...</p>
              </div>
            ) : errorMsg ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>
                <Prohibit size={36} style={{ margin: '0 auto 12px' }} />
                <p>{errorMsg}</p>
                {rawSql && <code style={{ display: 'block', marginTop: 12, padding: 8, background: '#fef2f2', borderRadius: 4, fontSize: 12 }}>{rawSql}</code>}
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
                <Database size={36} style={{ margin: '0 auto 12px' }} />
                <p>{search ? '没有找到匹配的进程' : '暂无其他活动进程'}</p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--table-header-bg, #f1f5f9)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', width: 90 }}>ID</th>
                    <th style={{ padding: '8px 12px', width: 120 }}>用户</th>
                    <th style={{ padding: '8px 12px', width: 140 }}>客户端主机</th>
                    <th style={{ padding: '8px 12px', width: 120 }}>数据库</th>
                    <th style={{ padding: '8px 12px', width: 100 }}>状态/命令</th>
                    <th style={{ padding: '8px 12px', width: 90 }}>耗时 (s)</th>
                    <th style={{ padding: '8px 12px' }}>执行 SQL / 详细信息</th>
                    <th style={{ padding: '8px 12px', width: 90, textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((proc) => {
                    const isKilling = killingId === proc.id
                    return (
                      <tr key={String(proc.id)} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{proc.id}</td>
                        <td style={{ padding: '8px 12px' }}>{proc.user || '-'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{proc.host || '-'}</td>
                        <td style={{ padding: '8px 12px' }}>{proc.db || '-'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span className={`status-badge ${(proc.command || '').toLowerCase().includes('query') ? 'active' : ''}`} style={{ padding: '2px 6px', borderRadius: 4, background: '#e0e7ff', color: '#3730a3', fontSize: 11 }}>
                            {proc.command || proc.state || 'active'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{proc.time ?? 0}s</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', color: proc.info ? 'var(--text-color)' : 'var(--text-muted)' }}>
                          {proc.info || proc.command || '-'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={isKilling}
                            onClick={() => void handleKill(proc)}
                            title={`终止进程 ${proc.id}`}
                            style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ef4444', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer' }}
                          >
                            {isKilling ? <CircleNotch className="database-load-spinner" /> : <Trash size={14} />}
                            终止
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <footer className="dialog-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-subtle, #f8fafc)', borderTop: '1px solid var(--border-color, #e2e8f0)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
              共 {processes.length} 个进程{search && `（已过滤出 ${filtered.length} 个）`}
            </span>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              关闭
            </button>
          </footer>
        </div>
      </div>
      {confirmDialog}
    </>
  )
}
