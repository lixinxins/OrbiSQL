import { useState } from 'react'
import {
  CheckCircle,
  Code,
  FileCode,
  FileSql,
  FolderOpen,
  Play,
  Rows,
  WarningCircle,
  X
} from '@phosphor-icons/react'
import type { PreviewSqlFileResult } from '@/shared/connections'
import { useDialogStore } from '../stores/useDialogStore'

interface RunSqlFileModalProps {
  data: PreviewSqlFileResult
  onClose: () => void
  onSuccess: () => void
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export default function RunSqlFileModal({ data, onClose, onSuccess }: RunSqlFileModalProps) {
  const [currentData, setCurrentData] = useState<PreviewSqlFileResult>(data)
  const [executing, setExecuting] = useState(false)
  const [continueOnError, setContinueOnError] = useState(false)
  const [inTransaction, setInTransaction] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const setRunSqlFilePreviewData = useDialogStore((s) => s.actions.setRunSqlFilePreviewData)

  const handleReselect = async () => {
    if (!currentData.connectionId) return
    setErrorMsg('')
    const res = await window.omnidb.connections.previewSqlFile(
      currentData.connectionId,
      currentData.databaseName
    )
    if (res.success) {
      setCurrentData(res)
    } else if (!res.canceled) {
      setErrorMsg(res.message || '重选文件失败')
    }
  }

  const handleExecute = async () => {
    if (!currentData.connectionId || !currentData.filePath) {
      setErrorMsg('缺少执行必要参数')
      return
    }

    setExecuting(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const res = await window.omnidb.connections.executeSqlFile({
        connectionId: currentData.connectionId,
        databaseName: currentData.databaseName,
        filePath: currentData.filePath,
        continueOnError,
        inTransaction
      })

      if (res.success) {
        setSuccessMsg(res.message || 'SQL 脚本运行完成！')
        onSuccess()
        setTimeout(() => {
          setRunSqlFilePreviewData(null)
          onClose()
        }, 1200)
      } else {
        setErrorMsg(res.message || '运行 SQL 文件失败')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '运行 SQL 发生错误')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={executing ? undefined : onClose}>
      <section
        className="import-preview-dialog sql-file-preview-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="import-preview-header">
          <div className="import-preview-title">
            <FileSql className="preview-title-icon" />
            <div>
              <h2>运行 SQL 脚本文件 - 预览</h2>
              <p>
                目标数据库：<strong>{currentData.connectionName || '数据库'}</strong> &bull;{' '}
                <strong>{currentData.databaseName}</strong>
              </p>
            </div>
          </div>
          <button type="button" className="confirm-dialog-close" disabled={executing} onClick={onClose}>
            <X />
          </button>
        </header>

        <div className="import-meta-bar">
          <div className="meta-badge highlight">
            <FileCode /> <span>{currentData.fileName}</span>
          </div>
          <div className="meta-badge">
            <Rows /> <span>大小: {formatBytes(currentData.fileSize)}</span>
          </div>
          <div className="meta-badge">
            <Code /> <span>约 {currentData.statementCount ?? 0} 条 SQL 语句 / {currentData.totalLines ?? 0} 行</span>
          </div>
          <button
            type="button"
            className="format-btn"
            style={{ marginLeft: 'auto' }}
            disabled={executing}
            onClick={() => void handleReselect()}
          >
            <FolderOpen /> 重新选择文件
          </button>
        </div>

        {currentData.isTruncated && (
          <div className="import-feedback-alert warning" style={{ margin: '8px 20px 0' }}>
            <WarningCircle />
            <span>当前文件内容较长，界面仅预览前 20,000 字符。实际运行将完整执行整个文件。</span>
          </div>
        )}

        <div className="import-preview-body sql-code-preview-body">
          <div className="sql-code-editor-wrap">
            <pre className="sql-code-preview-content">
              <code>{currentData.sqlPreview}</code>
            </pre>
          </div>
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
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <label className="clear-target-checkbox">
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(e) => setContinueOnError(e.target.checked)}
                disabled={executing}
              />
              <span>遇错继续执行</span>
            </label>
            <label className="clear-target-checkbox">
              <input
                type="checkbox"
                checked={inTransaction}
                onChange={(e) => setInTransaction(e.target.checked)}
                disabled={executing}
              />
              <span>在事务中包装运行</span>
            </label>
          </div>

          <div className="footer-action-btns">
            <button type="button" className="confirm-dialog-cancel" disabled={executing} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="confirm-dialog-primary"
              disabled={executing}
              onClick={() => void handleExecute()}
            >
              <Play weight="fill" />
              {executing ? '正在运行 SQL 文件…' : '确认运行 SQL 文件'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
