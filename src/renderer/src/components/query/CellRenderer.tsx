/**
 * 单元格值渲染组件
 * 根据数据类型格式化显示：NULL、BLOB、ARRAY、JSON、UUID 等，其余类型直接转字符串。
 * 使用 React.memo 包裹以避免虚拟化列表滚动时大量单元格不必要的重渲染。
 */
import React, { type ReactNode } from 'react'

/** CellRenderer 组件 Props */
interface CellRendererProps {
  value: unknown
}

/**
 * CellRenderer 内部实现
 * 按类型优先级渲染：NULL → BLOB → ARRAY → JSON → UUID → 普通字符串。
 */
const CellRendererInner = ({ value }: CellRendererProps): ReactNode => {
  if (value === null) return <span className="cell-null">NULL</span>
  if (value instanceof Uint8Array) return <span className="cell-badge binary">[BLOB {value.byteLength} B]</span>
  if (Array.isArray(value)) {
    const jsonStr = JSON.stringify(value)
    return (
      <span className="cell-pg-tag array" title={jsonStr}>
        <span className="pg-badge">ARRAY</span>
        {`[${value.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(', ')}]`}
      </span>
    )
  }
  if (typeof value === 'object') {
    const jsonStr = JSON.stringify(value)
    return (
      <span className="cell-pg-tag json" title={jsonStr}>
        <span className="pg-badge">JSON</span>
        {jsonStr.length > 35 ? `${jsonStr.slice(0, 35)}…` : jsonStr}
      </span>
    )
  }

  const str = String(value)
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str)) {
    return (
      <span className="cell-pg-tag uuid" title={str}>
        <span className="pg-badge">UUID</span>
        <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{str}</code>
      </span>
    )
  }
  return str
}

// React.memo 包裹：虚拟化列表滚动时避免所有可见单元格随父组件重渲染
const CellRenderer = React.memo(CellRendererInner)
export default CellRenderer
