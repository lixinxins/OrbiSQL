import { useEffect, useState } from 'react'
import { Check, Copy, DownloadSimple, FileCode, FolderOpen, Spinner, WarningCircle, X } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'

export interface ExportSqlDialogState {
  open: boolean
  connection: DatabaseConnection
  database: DatabaseItem
  table?: TableItem
  includeData: boolean
  status: 'selecting' | 'exporting' | 'success' | 'error'
  progress: number
  message: string
  filePath?: string
  sqlContent?: string
  totalLength?: number
  isTruncated?: boolean
  error?: string
}

interface ExportSqlDialogProps {
  state: ExportSqlDialogState
  onClose: () => void
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export default function ExportSqlDialog({ state, onClose }: ExportSqlDialogProps) {
  const [copied, setCopied] = useState(false)

  const {
    connection,
    database,
    table,
    includeData,
    status,
    progress,
    message,
    filePath,
    sqlContent,
    totalLength,
    isTruncated,
    error
  } = state

  useEffect(() => {
    setCopied(false)
  }, [sqlContent])

  const copySql = async (): Promise<void> => {
    if (!sqlContent) return
    try {
      await navigator.clipboard.writeText(sqlContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback if clipboard API fails
      const textarea = document.createElement('textarea')
      textarea.value = sqlContent
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const lineCount = sqlContent ? sqlContent.split('\n').length : 0
  const isFinished = status === 'success' || status === 'error'

  return (
    <div className="dialog-backdrop export-sql-dialog-backdrop" role="presentation" onMouseDown={() => { if (isFinished) onClose() }}>
      <div className="dialog-window export-sql-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <div className="export-sql-header-title">
            <span className="export-sql-icon"><DownloadSimple weight="bold" /></span>
            <div>
              <h2>导出 SQL ({includeData ? '结构和数据' : '仅结构'})</h2>
              <p>{connection.name} &bull; {database.name}{table ? `.${table.name}` : ''}</p>
            </div>
          </div>
          <button type="button" className="dialog-close" aria-label="关闭窗口" onClick={onClose} disabled={status === 'exporting'}>
            <X />
          </button>
        </header>

        <div className="dialog-body export-sql-dialog-body">
          {/* Status & Progress Section */}
          <div className="export-sql-status-card">
            {status === 'selecting' && (
              <div className="export-sql-status-running">
                <Spinner className="animate-spin export-spinner" />
                <div className="export-sql-status-text">
                  <h3>正在选择保存文件...</h3>
                  <p>请在系统保存提示框中指定导出的 SQL 文件目录与文件名</p>
                </div>
              </div>
            )}

            {status === 'exporting' && (
              <div className="export-sql-status-running">
                <Spinner className="animate-spin export-spinner" />
                <div className="export-sql-status-text">
                  <h3>正在导出 SQL 数据 ({progress}%)</h3>
                  <p className="export-sql-message">{message || '正在生成 SQL 语句...'}</p>
                </div>
              </div>
            )}

            {status === 'success' && (
              <div className="export-sql-status-success">
                <div className="export-sql-success-icon"><Check weight="bold" /></div>
                <div className="export-sql-status-text">
                  <h3>SQL 导出成功！</h3>
                  <p>{message}</p>
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="export-sql-status-error">
                <div className="export-sql-error-icon"><WarningCircle weight="fill" /></div>
                <div className="export-sql-status-text">
                  <h3>SQL 导出失败</h3>
                  <p>{error || message || '导出失败，请检查数据库连接及磁盘写入权限'}</p>
                </div>
              </div>
            )}

            {/* Progress Bar */}
            {(status === 'exporting' || status === 'selecting' || status === 'success') && (
              <div className="export-progress-container">
                <div className="export-progress-track">
                  <div
                    className={`export-progress-bar ${status === 'success' ? 'success' : ''}`}
                    style={{ width: `${status === 'success' ? 100 : Math.max(progress, status === 'selecting' ? 5 : 10)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Saved File Path Banner */}
            {filePath && (
              <div className="export-sql-filepath-banner">
                <div className="export-sql-filepath-text">
                  <FileCode weight="fill" />
                  <span>保存路径：</span>
                  <code title={filePath}>{filePath}</code>
                </div>
                <button
                  type="button"
                  className="secondary-button open-folder-btn"
                  onClick={() => void window.omnidb.showItemInFolder?.(filePath)}
                  title="在文件夹中显示该文件"
                >
                  <FolderOpen />
                  <span>打开文件夹</span>
                </button>
              </div>
            )}
          </div>

          {/* SQL Preview Section */}
          {status === 'success' && sqlContent !== undefined && (
            <div className="export-sql-preview-section">
              <div className="export-sql-preview-header">
                <div className="export-sql-preview-info">
                  <strong>导出的 SQL 内容</strong>
                  <span className="export-sql-meta-tag">
                    {lineCount.toLocaleString()} 行 &bull; {formatBytes(totalLength ?? sqlContent.length)}
                  </span>
                </div>
                <button type="button" className="secondary-button copy-sql-btn" onClick={() => void copySql()}>
                  {copied ? <Check /> : <Copy />}
                  <span>{copied ? '已复制 SQL' : '复制 SQL'}</span>
                </button>
              </div>

              <div className="export-sql-code-wrapper">
                <pre className="export-sql-code-preview">
                  <code>{sqlContent}</code>
                </pre>
              </div>

              {isTruncated && (
                <div className="export-sql-truncated-notice">
                  <span>已展示前 500 KB 预览，完整内容已保存至文件。</span>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="dialog-footer">
          <span className="dialog-footer-spacer" />
          {status === 'success' && (
            <>
              {filePath && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void window.omnidb.showItemInFolder?.(filePath)}
                >
                  <FolderOpen />
                  <span>打开文件夹</span>
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => void copySql()}>
                {copied ? <Check /> : <Copy />}
                <span>{copied ? '已复制' : '复制 SQL'}</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="save-button"
            onClick={onClose}
            disabled={status === 'exporting' || status === 'selecting'}
          >
            {status === 'success' ? '完成' : '关闭'}
          </button>
        </footer>
      </div>
    </div>
  )
}
