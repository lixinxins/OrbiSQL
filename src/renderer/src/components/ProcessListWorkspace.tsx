import { useEffect, useState, useCallback } from 'react'
import {
  ArrowsClockwise,
  CircleNotch,
  Database,
  MagnifyingGlass,
  Prohibit,
  Rows,
  Trash
} from '@phosphor-icons/react'
import type { ProcessItem } from '@/shared/connections'
import { useConfirmDialog } from './ConfirmDialog'
import { useToast } from '../contexts/ToastContext'

interface ProcessListWorkspaceProps {
  connectionId: number
  connectionName: string
  engine?: string
  active?: boolean
}

export default function ProcessListWorkspace({
  connectionId,
  connectionName,
  engine = 'Database',
  active = true
}: ProcessListWorkspaceProps) {
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
      const res = await window.omnidb.connections.getProcessList(connectionId)
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
  }, [connectionId])

  useEffect(() => {
    if (active) {
      void fetchProcesses()
    }
  }, [active, fetchProcesses])

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
      const res = await window.omnidb.connections.killProcess(connectionId, proc.id)
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
    )
  })

  return (
    <div
      className={`process-workspace query-workspace${active ? ' active' : ''}`}
      style={{
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-color, #ffffff)',
        overflow: 'hidden'
      }}
    >
      {/* 顶部工具栏：独立页头部信息、搜索框与刷新按钮 */}
      <div
        className="process-workspace-toolbar"
        style={{
          padding: '12px 20px',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          background: 'var(--bg-subtle, #f8fafc)',
          borderBottom: '1px solid var(--border-color, #e2e8f0)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Rows size={20} weight="bold" style={{ color: 'var(--primary-color, #6366f1)' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-color)' }}>
              活动进程与会话 · {connectionName}
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
              引擎: {engine} | 实时会话管理与慢查询监控
            </span>
          </div>
        </div>

        <label className="connection-search" style={{ flex: 1, margin: 0, maxWidth: 450, marginLeft: 'auto' }}>
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
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', cursor: 'pointer' }}
        >
          {loading ? <CircleNotch className="database-load-spinner" /> : <ArrowsClockwise />}
          刷新
        </button>
      </div>

      {/* 进程数据表格内容区域（无任何 SQL 编辑框） */}
      <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        {loading && !processes.length ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
            <CircleNotch size={36} className="database-load-spinner" style={{ margin: '0 auto 12px' }} />
            <p>正在获取实时活动进程列表...</p>
          </div>
        ) : errorMsg ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#ef4444' }}>
            <Prohibit size={40} style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: 14, fontWeight: 500 }}>{errorMsg}</p>
            {rawSql && (
              <code style={{ display: 'inline-block', marginTop: 12, padding: '6px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, fontSize: 12 }}>
                {rawSql}
              </code>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
            <Database size={40} style={{ margin: '0 auto 12px' }} />
            <p>{search ? '未找到符合条件的活动进程' : '当前暂无活动客户端进程'}</p>
          </div>
        ) : (
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--table-header-bg, #f1f5f9)', textAlign: 'left', position: 'sticky', top: 0, zIndex: 2 }}>
                <th style={{ padding: '10px 14px', width: 100 }}>ID</th>
                <th style={{ padding: '10px 14px', width: 130 }}>用户</th>
                <th style={{ padding: '10px 14px', width: 150 }}>客户端主机</th>
                <th style={{ padding: '10px 14px', width: 130 }}>数据库</th>
                <th style={{ padding: '10px 14px', width: 110 }}>状态/命令</th>
                <th style={{ padding: '10px 14px', width: 100 }}>耗时 (s)</th>
                <th style={{ padding: '10px 14px' }}>执行 SQL / 详细信息</th>
                <th style={{ padding: '10px 14px', width: 100, textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((proc) => {
                const isKilling = killingId === proc.id
                return (
                  <tr key={String(proc.id)} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>{proc.id}</td>
                    <td style={{ padding: '10px 14px' }}>{proc.user || '-'}</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>{proc.host || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>{proc.db || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 4,
                          background: (proc.command || '').toLowerCase().includes('query') ? '#e0e7ff' : '#f1f5f9',
                          color: (proc.command || '').toLowerCase().includes('query') ? '#3730a3' : '#475569',
                          fontSize: 11,
                          fontWeight: 500
                        }}
                      >
                        {proc.command || proc.state || 'active'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>{proc.time ?? 0}s</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', color: proc.info ? 'var(--text-color)' : 'var(--text-muted)' }}>
                      {proc.info || proc.command || '-'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <button
                        type="button"
                        disabled={isKilling}
                        onClick={() => void handleKill(proc)}
                        title={`终止进程 ${proc.id}`}
                        style={{
                          padding: '4px 10px',
                          fontSize: 12,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: '#ef4444',
                          background: '#fef2f2',
                          border: '1px solid #fca5a5',
                          borderRadius: 4,
                          cursor: 'pointer'
                        }}
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

      {/* 底部状态栏 */}
      <div
        style={{
          padding: '10px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-subtle, #f8fafc)',
          borderTop: '1px solid var(--border-color, #e2e8f0)',
          fontSize: 12,
          color: 'var(--text-muted, #64748b)'
        }}
      >
        <span>
          共 <strong>{processes.length}</strong> 个进程{search && `（已筛选出 ${filtered.length} 个）`}
        </span>
        <span>连接 ID: {connectionId}</span>
      </div>

      {confirmDialog}
    </div>
  )
}
