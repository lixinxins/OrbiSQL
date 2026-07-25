import { useEffect, useState } from 'react'
import {
  DownloadSimple,
  FileCode,
  FileSql,
  FolderOpen,
  Table,
  WarningCircle,
  X
} from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, PreviewExportSqlResult, TableItem } from '@/shared/connections'

interface ExportSqlPreviewModalProps {
  connection: DatabaseConnection
  database: DatabaseItem
  table?: TableItem
  initialIncludeData?: boolean
  onClose: () => void
  onConfirmExport: (includeData: boolean) => void
}

export default function ExportSqlPreviewModal({
  connection,
  database,
  table,
  initialIncludeData = false,
  onClose,
  onConfirmExport
}: ExportSqlPreviewModalProps) {
  const [includeData, setIncludeData] = useState(initialIncludeData)
  const [maxRowsPerTable, setMaxRowsPerTable] = useState(50)
  const [loading, setLoading] = useState(true)
  const [previewRes, setPreviewRes] = useState<PreviewExportSqlResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setErrorMsg('')

    const loadPreview = async () => {
      try {
        const res = await window.omnidb.databases.previewExportSql(
          connection.id,
          database.name,
          table?.name,
          includeData,
          maxRowsPerTable
        )
        if (!active) return
        if (res.success) {
          setPreviewRes(res)
        } else {
          setErrorMsg(res.message || '生成 SQL 预览失败')
        }
      } catch (err) {
        if (active) setErrorMsg(err instanceof Error ? err.message : '加载 SQL 预览异常')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadPreview()
    return () => {
      active = false
    }
  }, [connection.id, database.name, table?.name, includeData, maxRowsPerTable])

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="import-preview-dialog sql-export-preview-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="import-preview-header">
          <div className="import-preview-title">
            <DownloadSimple className="preview-title-icon" />
            <div>
              <h2>导出 SQL 脚本 - 结构与数据预览</h2>
              <p>
                目标位置：<strong>{connection.name}</strong> &bull;{' '}
                <strong>{database.name}{table ? `.${table.name}` : ''}</strong>
              </p>
            </div>
          </div>
          <button type="button" className="confirm-dialog-close" onClick={onClose}>
            <X />
          </button>
        </header>

        <div className="import-meta-bar">
          <div className="format-picker">
            <span className="picker-label">导出模式：</span>
            <button
              type="button"
              className={`format-btn ${!includeData ? 'active' : ''}`}
              onClick={() => setIncludeData(false)}
            >
              <FileCode /> 仅导出表结构 (DDL)
            </button>
            <button
              type="button"
              className={`format-btn ${includeData ? 'active' : ''}`}
              onClick={() => setIncludeData(true)}
            >
              <FileSql /> 导出结构和数据 (DDL + INSERT)
            </button>
          </div>

          {includeData && (
            <div className="format-picker" style={{ marginLeft: '12px' }}>
              <span className="picker-label">每表数据预览：</span>
              <button
                type="button"
                className={`format-btn ${maxRowsPerTable === 50 ? 'active' : ''}`}
                onClick={() => setMaxRowsPerTable(50)}
              >
                50 行
              </button>
              <button
                type="button"
                className={`format-btn ${maxRowsPerTable === 100 ? 'active' : ''}`}
                onClick={() => setMaxRowsPerTable(100)}
              >
                100 行
              </button>
              <button
                type="button"
                className={`format-btn ${maxRowsPerTable === 200 ? 'active' : ''}`}
                onClick={() => setMaxRowsPerTable(200)}
              >
                200 行
              </button>
            </div>
          )}

          <div className="meta-badge highlight" style={{ marginLeft: 'auto' }}>
            <Table /> <span>{table ? `表: ${table.name}` : `全库共 ${previewRes?.tableCount ?? database.tables?.length ?? 0} 张表`}</span>
          </div>
        </div>

        <div className="import-preview-body sql-code-preview-body">
          {loading ? (
            <div className="database-tables-empty">
              <strong>正在渲染 SQL 导出预览…</strong>
            </div>
          ) : (
            <div className="sql-code-editor-wrap">
              <pre className="sql-code-preview-content">
                <code>{previewRes?.sqlPreview || '-- 无导出的 SQL 内容'}</code>
              </pre>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="import-feedback-alert error">
            <WarningCircle /> <span>{errorMsg}</span>
          </div>
        )}

        <footer className="import-preview-footer">
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            确认后将弹窗选择保存路径并开始生成 .sql 脚本文件
          </div>

          <div className="footer-action-btns">
            <button type="button" className="confirm-dialog-cancel" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="confirm-dialog-primary"
              disabled={loading}
              onClick={() => {
                onClose()
                onConfirmExport(includeData)
              }}
            >
              <FolderOpen /> 确认选择保存位置并导出
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
