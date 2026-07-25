import { useState } from 'react'
import {
  ArrowRight,
  CheckCircle,
  Database,
  FileText,
  Rows,
  Table,
  UploadSimple,
  WarningCircle,
  X
} from '@phosphor-icons/react'
import type { PreviewImportResult } from '@/shared/connections'

interface ImportPreviewModalProps {
  data: PreviewImportResult
  onClose: () => void
  onSuccess: () => void
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function ImportPreviewModal({ data, onClose, onSuccess }: ImportPreviewModalProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'mapping'>('preview')
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>(data.initialMapping ?? {})
  const [clearTarget, setClearTarget] = useState(false)
  const [importing, setImporting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const fileHeaders = data.fileHeaders ?? []
  const previewRows = data.previewRows ?? []
  const tableColumns = data.tableColumns ?? []

  const activeMappedCount = Object.values(columnMapping).filter(Boolean).length

  const handleMappingChange = (header: string, targetCol: string) => {
    setColumnMapping((prev) => ({
      ...prev,
      [header]: targetCol
    }))
  }

  const handleConfirmImport = async () => {
    if (!data.connectionId || !data.databaseName || !data.tableName || !data.filePath) {
      setErrorMsg('参数缺失，无法执行导入')
      return
    }

    if (activeMappedCount === 0) {
      setErrorMsg('请至少为一个数据源列绑定目标表字段')
      return
    }

    setImporting(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const result = await window.omnidb.tables.executeImport({
        connectionId: data.connectionId,
        databaseName: data.databaseName,
        tableName: data.tableName,
        filePath: data.filePath,
        columnMapping,
        clearTarget
      })

      if (result.success) {
        setSuccessMsg(result.message || '导入成功')
        setTimeout(() => {
          onSuccess()
          onClose()
        }, 1200)
      } else {
        setErrorMsg(result.message || '导入失败')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={importing ? undefined : onClose}>
      <section
        className="import-preview-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="import-preview-header">
          <div className="import-preview-title">
            <UploadSimple className="preview-title-icon" />
            <div>
              <h2>导入数据预览与设置</h2>
              <p>
                目标表：<strong>{data.tableName}</strong> · 格式：{data.fileName?.split('.').pop()?.toUpperCase()}
              </p>
            </div>
          </div>
          <button type="button" className="confirm-dialog-close" disabled={importing} onClick={onClose}>
            <X />
          </button>
        </header>

        <div className="import-meta-bar">
          <div className="meta-badge">
            <FileText /> <span>文件：{data.fileName}</span>
          </div>
          <div className="meta-badge">
            <Database /> <span>大小：{formatBytes(data.fileSize)}</span>
          </div>
          <div className="meta-badge">
            <Rows /> <span>预计导入：{data.totalRows?.toLocaleString()} 行</span>
          </div>
          <div className="meta-badge highlight">
            <Table /> <span>已映射字段：{activeMappedCount} / {fileHeaders.length}</span>
          </div>
        </div>

        <div className="import-preview-tabs">
          <button
            type="button"
            className={`import-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            数据内容预览 (前 {previewRows.length} 行)
          </button>
          <button
            type="button"
            className={`import-tab-btn ${activeTab === 'mapping' ? 'active' : ''}`}
            onClick={() => setActiveTab('mapping')}
          >
            字段映射设置 ({activeMappedCount} 已配置)
          </button>
        </div>

        <div className="import-preview-body">
          {activeTab === 'preview' && (
            <div className="import-preview-grid-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th className="row-num-col">#</th>
                    {fileHeaders.map((header) => {
                      const targetCol = columnMapping[header]
                      return (
                        <th key={header}>
                          <div className="grid-header-cell">
                            <span className="source-header-name">{header}</span>
                            {targetCol ? (
                              <span className="mapped-badge">→ {targetCol}</span>
                            ) : (
                              <span className="unmapped-badge">未映射</span>
                            )}
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="row-num-col">{idx + 1}</td>
                      {fileHeaders.map((header) => {
                        const val = row[header]
                        const isNull = val === null || val === undefined
                        return (
                          <td key={header} className={isNull ? 'null-val' : ''}>
                            {isNull ? 'NULL' : String(val)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'mapping' && (
            <div className="import-mapping-wrap">
              <div className="mapping-list-header">
                <span>源文件列名 (Source)</span>
                <span>目标表字段 (Target Field)</span>
              </div>
              <div className="mapping-list-body">
                {fileHeaders.map((header) => {
                  const currentTarget = columnMapping[header] ?? ''
                  return (
                    <div className="mapping-item-row" key={header}>
                      <div className="source-col-name">
                        <FileText />
                        <span>{header}</span>
                      </div>
                      <ArrowRight className="mapping-arrow" />
                      <select
                        className="target-col-select"
                        value={currentTarget}
                        onChange={(e) => handleMappingChange(header, e.target.value)}
                      >
                        <option value="">( 忽略此列 / 不导入 )</option>
                        {tableColumns.map((col) => (
                          <option key={col.name} value={col.name}>
                            {col.name} ({col.type}){col.comment ? ` - ${col.comment}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="import-feedback-alert error">
            <WarningCircle /> <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="import-feedback-alert success">
            <CheckCircle /> <span>{successMsg}</span>
          </div>
        )}

        <footer className="import-preview-footer">
          <label className="clear-target-checkbox">
            <input
              type="checkbox"
              checked={clearTarget}
              onChange={(e) => setClearTarget(e.target.checked)}
              disabled={importing}
            />
            <span>导入前清空目标数据表 (Truncate)</span>
          </label>

          <div className="footer-action-btns">
            <button type="button" className="confirm-dialog-cancel" disabled={importing} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="confirm-dialog-primary"
              disabled={importing || activeMappedCount === 0}
              onClick={() => void handleConfirmImport()}
            >
              {importing ? '正在导入数据…' : `确认导入 (${data.totalRows?.toLocaleString()} 行)`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
