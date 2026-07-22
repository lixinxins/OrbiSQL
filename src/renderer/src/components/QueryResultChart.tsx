import { useMemo, useState } from 'react'

interface Props { columns: string[]; rows: Array<Record<string, unknown>> }
type ChartType = 'bar' | 'line' | 'pie'

function QueryResultChart({ columns, rows }: Props) {
  const numericColumns = useMemo(() => columns.filter((column) => rows.some((row) => typeof row[column] === 'number' || (row[column] !== null && row[column] !== '' && Number.isFinite(Number(row[column]))))), [columns, rows])
  const [type, setType] = useState<ChartType>('bar')
  const [category, setCategory] = useState(columns.find((column) => !numericColumns.includes(column)) ?? columns[0] ?? '')
  const [valueColumn, setValueColumn] = useState(numericColumns[0] ?? '')
  const data = rows.slice(0, 30).map((row, index) => ({ label: String(row[category] ?? index + 1), value: Number(row[valueColumn]) || 0 }))
  const max = Math.max(1, ...data.map((item) => Math.abs(item.value)))
  const colors = ['#4f6ef7', '#16a3b6', '#7c3aed', '#f59e0b', '#ef4444', '#10b981', '#ec4899']

  if (!numericColumns.length) return <div className="query-chart-empty">结果中没有可用于图表的数值字段</div>
  return <div className="query-chart-view">
    <div className="query-chart-config">
      <div className="query-chart-types">{(['bar', 'line', 'pie'] as ChartType[]).map((item) => <button key={item} className={type === item ? 'active' : ''} onClick={() => setType(item)}>{item === 'bar' ? '柱状图' : item === 'line' ? '折线图' : '饼图'}</button>)}</div>
      <label>分类字段<select value={category} onChange={(event) => setCategory(event.target.value)}>{columns.map((column) => <option key={column}>{column}</option>)}</select></label>
      <label>数值字段<select value={valueColumn} onChange={(event) => setValueColumn(event.target.value)}>{numericColumns.map((column) => <option key={column}>{column}</option>)}</select></label>
      <span>最多展示前 30 行</span>
    </div>
    <div className="query-chart-canvas">
      {type === 'bar' && <div className="query-bar-chart">{data.map((item, index) => <div key={`${item.label}-${index}`}><span style={{ height: `${Math.max(2, Math.abs(item.value) / max * 92)}%`, background: colors[index % colors.length] }} title={`${item.label}: ${item.value}`} /><small>{item.label}</small></div>)}</div>}
      {type === 'line' && <svg viewBox="0 0 900 320" role="img" aria-label={`${valueColumn} 折线图`}><polyline fill="none" stroke="#4f6ef7" strokeWidth="4" points={data.map((item, index) => `${30 + index * (840 / Math.max(1, data.length - 1))},${285 - Math.abs(item.value) / max * 250}`).join(' ')} />{data.map((item, index) => <g key={`${item.label}-${index}`}><circle cx={30 + index * (840 / Math.max(1, data.length - 1))} cy={285 - Math.abs(item.value) / max * 250} r="5" fill="#fff" stroke="#4f6ef7" strokeWidth="3" /><title>{item.label}: {item.value}</title></g>)}</svg>}
      {type === 'pie' && <div className="query-pie-layout"><div className="query-pie" style={{ background: `conic-gradient(${(() => { const total = data.reduce((sum, item) => sum + Math.abs(item.value), 0) || 1; let cursor = 0; return data.map((item, index) => { const start = cursor; cursor += Math.abs(item.value) / total * 100; return `${colors[index % colors.length]} ${start}% ${cursor}%` }).join(',') })()})` }} /> <div className="query-chart-legend">{data.map((item, index) => <span key={`${item.label}-${index}`}><i style={{ background: colors[index % colors.length] }} />{item.label}<strong>{item.value}</strong></span>)}</div></div>}
    </div>
  </div>
}

export default QueryResultChart
