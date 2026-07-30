import { useState, useMemo, useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Check, CircleNotch, FolderOpen, UploadSimple, Warning, X } from '@phosphor-icons/react'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useToast } from '../contexts/ToastContext'
import type { CreateConnectionInput } from '@/shared/connections'

interface ImportConfigDialogProps {
  initialFilePath?: string
  initialGroups?: Array<{ name: string; category?: 'database' | 'ssh' }>
  initialConnections?: Array<CreateConnectionInput & { groupName?: string }>
  onClose: () => void
}

export default function ImportConfigDialog({
  initialFilePath = '',
  initialGroups = [],
  initialConnections = [],
  onClose
}: ImportConfigDialogProps) {
  const existingConnections = useConnectionStore((s) => s.connections)
  const [filePath, setFilePath] = useState(initialFilePath)
  const [groups, setGroups] = useState(initialGroups)
  const [connections, setConnections] = useState(initialConnections)
  const [loadingFile, setLoadingFile] = useState(false)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set())
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  const existingNames = useMemo(() => new Set(existingConnections.map((c) => c.name)), [existingConnections])

  const parseJsonContent = (text: string, fileName: string) => {
    try {
      const data = JSON.parse(text) as {
        groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
        connections?: Array<CreateConnectionInput & { groupName?: string }>
      }
      if (!Array.isArray(data.connections)) {
        showToast('error', '导入文件格式不合法，未找到有效 connections 列表')
        return
      }
      setFilePath(fileName)
      setGroups(data.groups || [])
      setConnections(data.connections || [])
      setSelectedIndices(new Set(data.connections.map((_, i) => i)))
    } catch (err) {
      showToast('error', '文件解析失败，请选择有效的 JSON 配置文件')
    }
  }

  const handleSelectFile = async () => {
    setLoadingFile(true)
    try {
      if (typeof window.omnidb?.connections?.readImportConfigFile === 'function') {
        const res = await window.omnidb.connections.readImportConfigFile()
        if (res.success && res.filePath && res.connections) {
          setFilePath(res.filePath)
          setGroups(res.groups || [])
          setConnections(res.connections)
          setSelectedIndices(new Set(res.connections.map((_, i) => i)))
        } else if (!res.success && res.message !== '已取消导入') {
          showToast('error', res.message || '读取文件失败')
        }
      } else {
        fileInputRef.current?.click()
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingFile(false)
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      if (content) parseJsonContent(content, file.name)
    }
    reader.readAsText(file, 'utf8')
  }

  useEffect(() => {
    if (connections.length > 0) {
      setSelectedIndices(new Set(connections.map((_, i) => i)))
    }
  }, [connections])

  const analyzedItems = useMemo(() => {
    return connections.map((conn, idx) => {
      const isConflict = existingNames.has(conn.name)
      let resolvedName = conn.name
      if (isConflict) {
        let suffix = 1
        while (existingNames.has(`${conn.name} (${suffix})`)) {
          suffix++
        }
        resolvedName = `${conn.name} (${suffix})`
      }
      return {
        index: idx,
        originalName: conn.name,
        resolvedName,
        isConflict,
        engine: conn.engine,
        host: conn.host || 'localhost',
        port: conn.port || 3306,
        groupName: conn.groupName
      }
    })
  }, [connections, existingNames])

  const toggleSelectAll = () => {
    if (selectedIndices.size === connections.length) {
      setSelectedIndices(new Set())
    } else {
      setSelectedIndices(new Set(connections.map((_, i) => i)))
    }
  }

  const toggleSelectIndex = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleConfirmImport = async () => {
    if (selectedIndices.size === 0) {
      showToast('error', '请至少选择一个连接进行导入')
      return
    }

    setImporting(true)
    try {
      const selectedConns = connections.filter((_, idx) => selectedIndices.has(idx))
      const res = await window.omnidb.connections.importConfig({
        filePath,
        groups,
        connections: selectedConns
      })
      if (res.success) {
        showToast('success', res.message || `成功导入 ${selectedConns.length} 个连接`)
        await useConnectionStore.getState().actions.loadConnections()
        onClose()
      } else {
        showToast('error', res.message || '导入失败')
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <div
        className="connection-dialog import-config-dialog"
        style={{ width: '90%', maxWidth: 750, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dialog-header">
          <span className="dialog-icon">
            <UploadSimple weight="bold" />
          </span>
          <div>
            <h2>导入连接配置预览 (弹窗)</h2>
            <p>先预览检测待导入项，确认后再写入系统数据库</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>

        <div className="dialog-body" style={{ flex: 1, overflow: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 文件信息或选择按钮 */}
          {filePath && connections.length > 0 ? (
            <div style={{ background: 'var(--bg-subtle, #f8fafc)', padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border-color, #e2e8f0)', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ wordBreak: 'break-all', marginBottom: 4 }}>
                  <strong>已解析配置文件:</strong> <code style={{ color: 'var(--primary-color, #6366f1)' }}>{filePath}</code>
                </div>
                <div>
                  共包含 <strong>{connections.length}</strong> 个连接配置及 <strong>{groups.length}</strong> 个数据库分组
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => void handleSelectFile()}
              >
                <FolderOpen />
                重新选择文件
              </button>
            </div>
          ) : (
            <div
              style={{
                border: '2px dashed var(--border-color, #cbd5e1)',
                borderRadius: 12,
                padding: '32px 16px',
                textAlign: 'center',
                background: 'var(--bg-subtle, #f8fafc)',
                cursor: 'pointer'
              }}
              onClick={() => void handleSelectFile()}
            >
              {loadingFile ? (
                <CircleNotch size={36} className="database-load-spinner" style={{ color: 'var(--primary-color, #6366f1)' }} />
              ) : (
                <FolderOpen size={40} style={{ color: 'var(--primary-color, #6366f1)', marginBottom: 8 }} />
              )}
              <strong style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>
                {loadingFile ? '正在读取配置文件…' : '点击选择 JSON 配置文件'}
              </strong>
              <span style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>支持读取并预览 QuillDB 导出的格式化连接备份</span>
            </div>
          )}

          {/* 勾选及冲突检测列表 */}
          {filePath && connections.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>选择导入项 ({selectedIndices.size}/{connections.length})</strong>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '3px 8px', cursor: 'pointer' }}
                  onClick={toggleSelectAll}
                >
                  {selectedIndices.size === connections.length ? '全不选' : '全选'}
                </button>
              </div>

              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 8, padding: 8, background: 'var(--bg-color, #fff)' }}>
                {analyzedItems.map((item) => {
                  const checked = selectedIndices.has(item.index)
                  return (
                    <label
                      key={item.index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: checked ? 'var(--bg-subtle, #f1f5f9)' : 'transparent',
                        cursor: 'pointer',
                        fontSize: 13,
                        marginBottom: 4,
                        borderBottom: '1px solid var(--border-color, #f1f5f9)'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectIndex(item.index)}
                      />
                      <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>{item.originalName}</span>
                      <span style={{ fontSize: 11, padding: '2px 6px', background: '#e0e7ff', color: '#3730a3', borderRadius: 4 }}>{item.engine}</span>

                      {item.isConflict ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            background: '#fef3c7',
                            color: '#d97706',
                            borderRadius: 4,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          <Warning size={12} />
                          名称冲突：导入为「{item.resolvedName}」
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, padding: '2px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 4 }}>
                          新建
                        </span>
                      )}

                      <span style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginLeft: 'auto' }}>
                        {item.host}:{item.port} {item.groupName ? `(${item.groupName})` : ''}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="dialog-footer" style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color, #e2e8f0)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={importing || !filePath || selectedIndices.size === 0}
            onClick={() => void handleConfirmImport()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {importing ? <CircleNotch className="database-load-spinner" /> : <Check />}
            确认导入 ({selectedIndices.size} 项)
          </button>
        </div>
      </div>
    </div>
  )
}
