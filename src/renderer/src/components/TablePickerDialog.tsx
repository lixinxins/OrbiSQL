import { useState } from 'react'
import { DownloadSimple, Table, UploadSimple, X } from '@phosphor-icons/react'
import type { DatabaseItem, TableItem } from '@/shared/connections'
import SearchableSelect from './SearchableSelect'

interface TablePickerDialogProps {
  database: DatabaseItem
  mode: 'import' | 'export'
  onClose: () => void
  onConfirm: (table: TableItem) => void
}

function TablePickerDialog({ database, mode, onClose, onConfirm }: TablePickerDialogProps) {
  const [tableName, setTableName] = useState('')
  const selectedTable = database.tables.find((table) => table.name === tableName)
  const importing = mode === 'import'

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="connection-dialog table-picker-dialog">
        <div className="dialog-header">
          <span className="dialog-icon table-dialog-icon">
            {importing ? <UploadSimple /> : <DownloadSimple />}
          </span>
          <div><h2>{importing ? '选择要导入的表' : '选择要导出的表'}</h2><p>{database.name}</p></div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><X /></button>
        </div>
        <div className="dialog-body">
          <label className="form-field">
            <span>数据表</span>
            <SearchableSelect
              value={tableName}
              options={database.tables.map((table) => ({
                value: table.name,
                label: table.comment ? `${table.name} (${table.comment})` : table.name,
                keywords: `${table.name} ${table.comment ?? ''}`
              }))}
              placeholder="搜索并选择数据表..."
              onChange={setTableName}
            />
          </label>
          {selectedTable && (
            <div className="table-picker-info-badge">
              <Table weight="duotone" />
              <span>
                已选择：<strong>{selectedTable.name}</strong>
                {selectedTable.comment && <small> · {selectedTable.comment}</small>}
                <small> ({selectedTable.columns.length} 个字段)</small>
              </span>
            </div>
          )}
          {!database.tables.length && <div className="form-feedback error">当前数据库没有可用的数据表</div>}
        </div>
        <div className="dialog-footer">
          <span className="dialog-footer-spacer" />
          <button type="button" className="cancel-button" onClick={onClose}>取消</button>
          <button type="button" className="save-button" disabled={!selectedTable} onClick={() => selectedTable && onConfirm(selectedTable)}>
            {importing ? '下一步：数据解析与预览' : '下一步：设置导出与预览'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TablePickerDialog
