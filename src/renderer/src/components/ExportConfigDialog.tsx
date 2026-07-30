import { useState, useMemo } from 'react'
import { Check, CircleNotch, DownloadSimple, X } from '@phosphor-icons/react'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useToast } from '../contexts/ToastContext'

interface ExportConfigDialogProps {
  onClose: () => void
}

export default function ExportConfigDialog({ onClose }: ExportConfigDialogProps) {
  const connections = useConnectionStore((s) => s.connections)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(connections.map((c) => c.id)))
  const [includePasswords, setIncludePasswords] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { showToast } = useToast()

  const toggleSelectAll = () => {
    if (selectedIds.size === connections.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(connections.map((c) => c.id)))
    }
  }

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedConnections = useMemo(
    () => connections.filter((c) => selectedIds.has(c.id)),
    [connections, selectedIds]
  )

  const previewJson = useMemo(() => {
    const data = {
      app: 'QuillDB',
      version: '1.0.1',
      exportedAt: new Date().toISOString(),
      connectionsCount: selectedConnections.length,
      connections: selectedConnections.map((c) => ({
        name: c.name,
        engine: c.engine,
        host: c.host,
        port: c.port,
        username: c.username,
        defaultDatabase: c.defaultDatabase,
        savePassword: includePasswords,
        groupName: c.groupName || undefined
      }))
    }
    return JSON.stringify(data, null, 2)
  }, [selectedConnections, includePasswords])

  const handleExport = async () => {
    if (selectedIds.size === 0) {
      showToast('error', '请至少选择一个数据库连接进行导出')
      return
    }

    setExporting(true)
    try {
      const res = await window.omnidb.connections.exportConfig({
        selectedIds: Array.from(selectedIds),
        includePasswords
      })
      if (res.success) {
        showToast('success', res.message || '导出配置文件成功')
        onClose()
      } else if (res.message !== '已取消导出') {
        showToast('error', res.message || '导出配置文件失败')
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="connection-dialog export-config-dialog"
        style={{ width: '90%', maxWidth: 750, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dialog-header">
          <span className="dialog-icon">
            <DownloadSimple weight="bold" />
          </span>
          <div>
            <h2>导出连接配置预览 (弹窗)</h2>
            <p>勾选欲导出的数据库连接与安全配置</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>

        <div className="dialog-body" style={{ flex: 1, overflow: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 安全设置 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-subtle, #f8fafc)', padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border-color, #e2e8f0)' }}>
            <div>
              <strong style={{ fontSize: 13, display: 'block', color: 'var(--text-color)' }}>安全设置</strong>
              <span style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>默认不导出密码；勾选后数据库密码和 SSH 凭据将以明文写入 JSON</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={includePasswords}
                onChange={(e) => setIncludePasswords(e.target.checked)}
              />
              明文包含已保存的密码
            </label>
          </div>

          {/* 勾选列表 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>选择导出的连接 ({selectedIds.size}/{connections.length})</strong>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '3px 8px', cursor: 'pointer' }}
                onClick={toggleSelectAll}
              >
                {selectedIds.size === connections.length ? '全不选' : '全选'}
              </button>
            </div>

            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 8, padding: 8, background: 'var(--bg-color, #fff)' }}>
              {connections.map((c) => {
                const checked = selectedIds.has(c.id)
                return (
                  <label
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: checked ? 'var(--bg-subtle, #f1f5f9)' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                      marginBottom: 2
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelectId(c.id)}
                    />
                    <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>{c.name}</span>
                    <span style={{ fontSize: 11, padding: '2px 6px', background: '#e0e7ff', color: '#3730a3', borderRadius: 4 }}>{c.engine}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginLeft: 'auto' }}>
                      {c.username}@{c.host}:{c.port} {c.groupName ? `(${c.groupName})` : ''}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* JSON Preview Box */}
          <div>
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>导出文件预览 (JSON 摘要)</strong>
            <pre
              style={{
                margin: 0,
                padding: 12,
                maxHeight: 140,
                overflowY: 'auto',
                fontSize: 11,
                fontFamily: 'monospace',
                background: '#0f172a',
                color: '#38bdf8',
                borderRadius: 8
              }}
            >
              {previewJson}
            </pre>
          </div>
        </div>

        <div className="dialog-footer" style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color, #e2e8f0)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={exporting || selectedIds.size === 0}
            onClick={() => void handleExport()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {exporting ? <CircleNotch className="database-load-spinner" /> : <Check />}
            确认导出 ({selectedIds.size} 项)
          </button>
        </div>
      </div>
    </div>
  )
}
