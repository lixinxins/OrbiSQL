/**
 * 行内单元格编辑组件
 * 提供输入框和快捷按钮，支持 NULL / EMPTY / 自定义值输入，Enter 保存，Esc 取消。
 */
import React from 'react'
import { Check, X } from '@phosphor-icons/react'

/** CellEditor 组件 Props 接口 */
interface CellEditorProps {
  draftCellValue: unknown
  savingRow: boolean
  onDraftChange: (value: unknown) => void
  onSave: () => void
  onCancel: () => void
  onNull: () => void
  onEmpty: () => void
}

/**
 * CellEditor 组件
 * 渲染行内编辑 UI：输入框 + NULL/EMPTY/保存/取消按钮。
 */
const CellEditor = ({
  draftCellValue,
  savingRow,
  onDraftChange,
  onSave,
  onCancel,
  onNull,
  onEmpty
}: CellEditorProps): React.ReactElement => {
  return (
    <div className="cell-editor" onClick={(event) => event.stopPropagation()}>
      <input
        autoFocus
        value={draftCellValue === null || draftCellValue === undefined ? '' : String(draftCellValue)}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void onSave() }
          if (event.key === 'Escape') onCancel()
        }}
      />
      <button type="button" className="editor-btn null-btn" title="设为 NULL" onClick={onNull}>NULL</button>
      <button type="button" className="editor-btn empty-btn" title="设为空字符串" onClick={onEmpty}>EMPTY</button>
      <button type="button" className="editor-btn save-btn" title="保存 (Enter)" disabled={savingRow} onClick={() => void onSave()}><Check weight="bold" />保存</button>
      <button type="button" className="editor-btn cancel-btn" title="取消 (Esc)" disabled={savingRow} onClick={onCancel}><X />取消</button>
    </div>
  )
}

export default CellEditor
