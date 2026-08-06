import { useEffect, useState } from 'react'
import {
  CheckCircle,
  DownloadSimple,
  FileCsv,
  FileJs,
  FileXls,
  Rows,
  Table,
  WarningCircle,
  X
} from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, TableColumnDefinition, TableItem } from '@/shared/connections'
import { readTableDataCached } from '../utils/table-data-cache'

interface ExportDataPreviewModalProps {
  connection: DatabaseConnection
  database: DatabaseItem
  table: TableItem
  onClose: () => void
}

type ExportFormat = 'csv' | 'json' | 'xlsx'

export default function ExportDataPreviewModal({
  connection,
  database,
  table,
  onClose
}: ExportDataPreviewModalProps) {
  const [loading, setLoading] = useState(true)
  const [columns, setColumns] = useState<TableColumnDefinition[]>([])
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([])
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [includeHeader, setIncludeHeader] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)

    const loadData = async () => {
      try {
        const [defRes, dataRes] = await Promise.all([
          window.omnidb.tables.getDefinition(connection.id, database.name, table.name),
          readTableDataCached(connection.id, database.name, table.name, 200, 0)
        ])

        if (!active) return

        if (defRes.success && defRes.columns) {
          setColumns(defRes.columns)
          setSelectedColumns(defRes.columns.map((c) => c.name))
        }

        if (dataRes.success && dataRes.rows) {
          setPreviewRows(dataRes.rows)
        }
      } catch (err) {
        if (active) setErrorMsg(err instanceof Error ? err.message : '加载表预览数据失败')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadData()
    return () => {
      active = false
    }
  }, [connection.id, database.name, table.name])

  const toggleAllColumns = () => {
    if (selectedColumns.length === columns.length) {
      setSelectedColumns([])
    } else {
      setSelectedColumns(columns.map((c) => c.name))
    }
  }

  const toggleColumn = (colName: string) => {
    setSelectedColumns((prev) =>
      prev.includes(colName) ? prev.filter((c) => c !== colName) : [...prev, colName]
    )
  }

  const handleExport = async () => {
    if (selectedColumns.length === 0) {
      setErrorMsg('请至少勾选一个需要导出的字段')
      return
    }

    setExporting(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const res = await window.omnidb.tables.exportCustomData({
        connectionId: connection.id,
        databaseName: database.name,
        tableName: table.name,
        format,
        selectedColumns,
        includeHeader
      })

      if (res.success) {
        setSuccessMsg(res.message || '导出成功')
        setTimeout(() => onClose(), 1200)
      } else if (res.message !== '已取消导出') {
        setErrorMsg(res.message || '导出失败')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导出发生错误')
    } finally {
      setExporting(false)
    }
  }

  const filteredPreviewRows = previewRows.map((row) => {
    const filteredRow: Record<string, unknown> = {}
    selectedColumns.forEach((col) => {
      filteredRow[col] = row[col]
    })
    return filteredRow
  })

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={exporting ? undefined : onClose}>
      <section
        className="import-preview-dialog export-preview-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="import-preview-header">
          <div className="import-preview-title">
            <DownloadSimple className="preview-title-icon" />
            <div>
              <h2>导出数据预览与设置</h2>
              <p>
                目标数据表：<strong>{database.name}.{table.name}</strong>
              </p>
            </div>
          </div>
          <button type="button" className="confirm-dialog-close" disabled={exporting} onClick={onClose}>
            <X />
          </button>
        </header>

        <div className="import-meta-bar">
          <div className="format-picker">
            <span className="picker-label">导出格式：</span>
            <button
              type="button"
              className={`format-btn ${format === 'csv' ? 'active' : ''}`}
              onClick={() => setFormat('csv')}
            >
              <FileCsv /> CSV
            </button>
            <button
              type="button"
              className={`format-btn ${format === 'json' ? 'active' : ''}`}
              onClick={() => setFormat('json')}
            >
              <FileJs /> JSON
            </button>
            <button
              type="button"
              className={`format-btn ${format === 'xlsx' ? 'active' : ''}`}
              onClick={() => setFormat('xlsx')}
            >
              <FileXls /> Excel (.xlsx)
            </button>
          </div>

          <div className="meta-badge highlight">
            <Table /> <span>已选择 {selectedColumns.length} / {columns.length} 个字段</span>
          </div>
          <div className="meta-badge">
            <Rows /> <span>数据预览：前 {previewRows.length} 行</span>
          </div>
        </div>

        <div className="export-column-selector-bar">
          <div className="selector-title">
            <span>导出字段筛选：</span>
            <button type="button" className="text-btn" onClick={toggleAllColumns}>
              {selectedColumns.length === columns.length ? '全不选' : '全选'}
            </button>
          </div>
          <div className="column-checkbox-grid">
            {columns.map((col) => {
              const checked = selectedColumns.includes(col.name)
              return (
                <label className={`col-checkbox-item ${checked ? 'checked' : ''}`} key={col.name}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleColumn(col.name)}
                    disabled={exporting}
                  />
                  <span>{col.name}</span>
                  <small>({col.type})</small>
                </label>
              )
            })}
          </div>
        </div>

        <div className="import-preview-body">
          {loading ? (
            <div className="database-tables-empty">
              <strong>正在加载预览数据…</strong>
            </div>
          ) : (
            <div className="import-preview-grid-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th className="row-num-col">#</th>
                    {selectedColumns.map((colName) => (
                      <th key={colName}>{colName}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPreviewRows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="row-num-col">{idx + 1}</td>
                      {selectedColumns.map((colName) => {
                        const val = row[colName]
                        const isNull = val === null || val === undefined
                        return (
                          <td key={colName} className={isNull ? 'null-val' : ''}>
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
              checked={includeHeader}
              onChange={(e) => setIncludeHeader(e.target.checked)}
              disabled={exporting || format === 'json'}
            />
            <span>导出首行为列标题 (Header)</span>
          </label>

          <div className="footer-action-btns">
            <button type="button" className="confirm-dialog-cancel" disabled={exporting} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="confirm-dialog-primary"
              disabled={exporting || selectedColumns.length === 0}
              onClick={() => void handleExport()}
            >
              {exporting ? '正在导出数据…' : '确认导出数据'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
