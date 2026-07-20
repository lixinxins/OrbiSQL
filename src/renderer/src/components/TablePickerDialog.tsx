import { useState } from 'react'
import { DownloadSimple, UploadSimple, X } from '@phosphor-icons/react'
import type { DatabaseItem, TableItem } from '../../../shared/connections'
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
              options={database.tables.map((table) => ({ value: table.name, label: table.name }))}
              placeholder="搜索并选择数据表"
              onChange={setTableName}
            />
          </label>
          {!database.tables.length && <div className="form-feedback error">当前数据库没有可用的数据表</div>}
        </div>
        <div className="dialog-footer">
          <span className="dialog-footer-spacer" />
          <button type="button" className="cancel-button" onClick={onClose}>取消</button>
          <button type="button" className="save-button" disabled={!selectedTable} onClick={() => selectedTable && onConfirm(selectedTable)}>
            {importing ? '选择 CSV 文件' : '选择保存位置'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TablePickerDialog
