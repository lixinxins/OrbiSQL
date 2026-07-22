import { useMemo, useState } from 'react'
import { ArrowsLeftRight, Database, FlowArrow, GitDiff, Play, X } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, TableDefinitionResult, TableItem } from '../../../shared/connections'
import SearchableSelect from './SearchableSelect'

export type AdvancedToolMode = 'schema' | 'data' | 'transfer' | 'er' | 'routine'

interface Props {
  connections: DatabaseConnection[]
  initialMode?: AdvancedToolMode
  initialRoutineSql?: string
  onClose: () => void
}

interface DatabaseTarget { connection: DatabaseConnection; database: DatabaseItem }
interface TableTarget extends DatabaseTarget { table: TableItem }
interface DiffRow { object: string; source: string; target: string; status: 'same' | 'added' | 'removed' | 'changed' }

const databaseKey = (target: DatabaseTarget): string => `${target.connection.id}\u0000${target.database.name}`
const tableKey = (target: TableTarget): string => `${databaseKey(target)}\u0000${target.table.name}`
const labelStatus = { same: '一致', added: '目标新增', removed: '目标缺少', changed: '已变更' } as const

function DatabaseAdvancedTools({ connections, initialMode = 'schema', initialRoutineSql = '', onClose }: Props) {
  const [mode, setMode] = useState<AdvancedToolMode>(initialMode)
  const databases = useMemo(() => connections.filter((item) => item.open && item.connected).flatMap((connection) =>
    connection.databases.map((database) => ({ connection, database }))), [connections])
  const tables = useMemo(() => databases.flatMap((target) => target.database.tables.map((table) => ({ ...target, table }))), [databases])
  const [sourceDatabaseKey, setSourceDatabaseKey] = useState(databaseKey(databases[0] ?? { connection: { id: 0 } as DatabaseConnection, database: { name: '' } as DatabaseItem }))
  const [targetDatabaseKey, setTargetDatabaseKey] = useState(databaseKey(databases[1] ?? databases[0] ?? { connection: { id: 0 } as DatabaseConnection, database: { name: '' } as DatabaseItem }))
  const [sourceTableKey, setSourceTableKey] = useState(tableKey(tables[0] ?? { connection: { id: 0 } as DatabaseConnection, database: { name: '' } as DatabaseItem, table: { name: '' } as TableItem }))
  const [targetTableKey, setTargetTableKey] = useState(tableKey(tables[1] ?? tables[0] ?? { connection: { id: 0 } as DatabaseConnection, database: { name: '' } as DatabaseItem, table: { name: '' } as TableItem }))
  const [keyColumn, setKeyColumn] = useState('')
  const [diffRows, setDiffRows] = useState<DiffRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [erDefinitions, setErDefinitions] = useState<Array<{ table: TableItem; definition: TableDefinitionResult }>>([])
  const [routineSql, setRoutineSql] = useState(initialRoutineSql)
  const [clearTarget, setClearTarget] = useState(false)

  const changeMode = (nextMode: AdvancedToolMode): void => {
    setMode(nextMode)
    setMessage('')
    setDiffRows([])
    setErDefinitions([])
  }

  const databaseOptions = databases.map((item) => ({ value: databaseKey(item), label: `${item.connection.name} / ${item.database.name}` }))
  const tableOptions = tables.map((item) => ({ value: tableKey(item), label: `${item.connection.name} / ${item.database.name} / ${item.table.name}` }))
  const sourceTable = tables.find((item) => tableKey(item) === sourceTableKey)
  const targetTable = tables.find((item) => tableKey(item) === targetTableKey)

  const compareSchema = async (): Promise<void> => {
    const source = databases.find((item) => databaseKey(item) === sourceDatabaseKey)
    const target = databases.find((item) => databaseKey(item) === targetDatabaseKey)
    if (!source || !target) return setMessage('请选择源数据库和目标数据库')
    setBusy(true); setMessage('')
    try {
      const names = Array.from(new Set([...source.database.tables.map((item) => item.name), ...target.database.tables.map((item) => item.name)]))
      const results: DiffRow[] = []
      for (const name of names) {
        const sourceTableItem = source.database.tables.find((item) => item.name === name)
        const targetTableItem = target.database.tables.find((item) => item.name === name)
        if (!sourceTableItem) { results.push({ object: `表 ${name}`, source: '不存在', target: '存在', status: 'added' }); continue }
        if (!targetTableItem) { results.push({ object: `表 ${name}`, source: '存在', target: '不存在', status: 'removed' }); continue }
        const [sourceDefinition, targetDefinition] = await Promise.all([
          window.omnidb.tables.getDefinition(source.connection.id, source.database.name, name),
          window.omnidb.tables.getDefinition(target.connection.id, target.database.name, name)
        ])
        const sourceColumns = sourceDefinition.columns ?? []
        const targetColumns = targetDefinition.columns ?? []
        const columnNames = Array.from(new Set([...sourceColumns.map((item) => item.name), ...targetColumns.map((item) => item.name)]))
        for (const columnName of columnNames) {
          const left = sourceColumns.find((item) => item.name === columnName)
          const right = targetColumns.find((item) => item.name === columnName)
          const describe = (column: typeof left): string => column ? `${column.typeDefinition ?? column.type}${column.notNull ? ' NOT NULL' : ''}${column.primaryKey ? ' PK' : ''}` : '不存在'
          const status: DiffRow['status'] = !left ? 'added' : !right ? 'removed' : describe(left) === describe(right) ? 'same' : 'changed'
          results.push({ object: `${name}.${columnName}`, source: describe(left), target: describe(right), status })
        }
      }
      setDiffRows(results)
      setMessage(`对比完成：${results.filter((item) => item.status !== 'same').length} 项差异`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '结构对比失败') } finally { setBusy(false) }
  }

  const compareData = async (): Promise<void> => {
    if (!sourceTable || !targetTable || !keyColumn) return setMessage('请选择两张表并指定主键/唯一键字段')
    setBusy(true); setMessage('')
    try {
      const [left, right] = await Promise.all([
        window.omnidb.tables.readData(sourceTable.connection.id, sourceTable.database.name, sourceTable.table.name, 5000, 0),
        window.omnidb.tables.readData(targetTable.connection.id, targetTable.database.name, targetTable.table.name, 5000, 0)
      ])
      if (!left.success || !right.success) throw new Error(left.success ? right.message : left.message)
      const leftMap = new Map((left.rows ?? []).map((row) => [String(row[keyColumn]), row]))
      const rightMap = new Map((right.rows ?? []).map((row) => [String(row[keyColumn]), row]))
      const keys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()]))
      setDiffRows(keys.map((key) => {
        const source = leftMap.get(key); const target = rightMap.get(key)
        return { object: `${keyColumn}=${key}`, source: source ? JSON.stringify(source) : '不存在', target: target ? JSON.stringify(target) : '不存在', status: !source ? 'added' : !target ? 'removed' : JSON.stringify(source) === JSON.stringify(target) ? 'same' : 'changed' }
      }))
      setMessage(`已对比 ${keys.length} 个键值（单表最多 5000 行）`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '数据对比失败') } finally { setBusy(false) }
  }

  const loadEr = async (): Promise<void> => {
    const source = databases.find((item) => databaseKey(item) === sourceDatabaseKey)
    if (!source) return setMessage('请选择数据库')
    setBusy(true); setMessage('')
    try {
      const definitions = await Promise.all(source.database.tables.map(async (table) => ({ table, definition: await window.omnidb.tables.getDefinition(source.connection.id, source.database.name, table.name) })))
      setErDefinitions(definitions)
      setMessage(`已生成 ${definitions.length} 张表、${definitions.reduce((sum, item) => sum + (item.definition.foreignKeys?.length ?? 0), 0)} 条关系`)
    } finally { setBusy(false) }
  }

  const transferData = async (): Promise<void> => {
    if (!sourceTable || !targetTable) return setMessage('请选择源数据表和目标数据表')
    setBusy(true); setMessage('')
    try {
      const result = await window.omnidb.tables.transferData({
        sourceConnectionId: sourceTable.connection.id,
        sourceDatabaseName: sourceTable.database.name,
        sourceTableName: sourceTable.table.name,
        targetConnectionId: targetTable.connection.id,
        targetDatabaseName: targetTable.database.name,
        targetTableName: targetTable.table.name,
        clearTarget
      })
      setMessage(result.message)
    } finally { setBusy(false) }
  }

  const executeRoutine = async (): Promise<void> => {
    const source = databases.find((item) => databaseKey(item) === sourceDatabaseKey)
    if (!source || !routineSql.trim()) return setMessage('请选择数据库并填写存储过程 SQL')
    setBusy(true)
    const result = await window.omnidb.queries.execute(source.connection.id, source.database.name, routineSql)
    setMessage(result.message); setBusy(false)
  }

  const changedCount = diffRows.filter((item) => item.status !== 'same').length
  const sameCount = diffRows.length - changedCount

  return <div className="advanced-tools-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="advanced-tools-dialog">
      <header><div className="advanced-tools-title"><span className="advanced-tools-icon"><Database weight="duotone" /></span><span><strong>数据库高级工具</strong><small>结构、数据与数据库对象管理</small></span></div><button className="advanced-tools-close" type="button" title="关闭" onClick={onClose}><X /></button></header>
      <nav>
        <button className={mode === 'schema' ? 'active' : ''} onClick={() => changeMode('schema')}><GitDiff />结构对比</button>
        <button className={mode === 'data' ? 'active' : ''} onClick={() => changeMode('data')}><ArrowsLeftRight />数据对比</button>
        <button className={mode === 'transfer' ? 'active' : ''} onClick={() => changeMode('transfer')}><ArrowsLeftRight />数据传输</button>
        <button className={mode === 'er' ? 'active' : ''} onClick={() => changeMode('er')}><FlowArrow />ER 关系图</button>
        <button className={mode === 'routine' ? 'active' : ''} onClick={() => changeMode('routine')}><Play />存储过程</button>
      </nav>
      <div className="advanced-tools-content">
        <section className="advanced-tool-config">
          <div className="advanced-tool-config-title"><strong>{mode === 'schema' ? '选择对比数据库' : mode === 'data' ? '选择对比数据表' : mode === 'transfer' ? '选择传输数据表' : mode === 'er' ? '选择关系图数据库' : '存储过程配置'}</strong><small>{mode === 'schema' ? '对比表和字段定义，找出新增、缺少及变更项' : mode === 'data' ? '按照主键或唯一字段匹配记录，单表最多读取 5000 行' : mode === 'transfer' ? '自动匹配同名字段，支持跨连接和跨数据库传输' : mode === 'er' ? '读取表字段、主键和外键并生成关系视图' : '编辑并执行数据库存储过程定义'}</small></div>
          {(mode === 'schema' || mode === 'er' || mode === 'routine') && <div className="advanced-field"><span>{mode === 'schema' ? '源数据库' : '数据库'}</span><SearchableSelect value={sourceDatabaseKey} options={databaseOptions} onChange={setSourceDatabaseKey} placeholder="选择数据库" /></div>}
          {mode === 'schema' && <div className="advanced-field"><span>目标数据库</span><SearchableSelect value={targetDatabaseKey} options={databaseOptions} onChange={setTargetDatabaseKey} placeholder="选择目标数据库" /></div>}
          {(mode === 'data' || mode === 'transfer') && <div className={`advanced-data-fields${mode === 'transfer' ? ' transfer' : ''}`}><div className="advanced-field"><span>源数据表</span><SearchableSelect value={sourceTableKey} options={tableOptions} onChange={(value) => { setSourceTableKey(value); setKeyColumn('') }} placeholder="选择源表" /></div><div className="advanced-field"><span>目标数据表</span><SearchableSelect value={targetTableKey} options={tableOptions} onChange={setTargetTableKey} placeholder="选择目标表" /></div>{mode === 'data' ? <label className="advanced-field"><span>对比键</span><select value={keyColumn} onChange={(event) => setKeyColumn(event.target.value)}><option value="">请选择主键或唯一字段</option>{sourceTable?.table.columns.map((column) => <option key={column}>{column}</option>)}</select></label> : <label className="advanced-transfer-option"><input type="checkbox" checked={clearTarget} onChange={(event) => setClearTarget(event.target.checked)} /><span><strong>传输前清空目标表</strong><small>关闭时将数据追加到目标表</small></span></label>}</div>}
          {mode === 'schema' && <button className="advanced-primary" disabled={busy || !sourceDatabaseKey || !targetDatabaseKey} onClick={() => void compareSchema()}><GitDiff />{busy ? '正在对比…' : '开始结构对比'}</button>}
          {mode === 'data' && <button className="advanced-primary" disabled={busy || !sourceTable || !targetTable || !keyColumn} onClick={() => void compareData()}><ArrowsLeftRight />{busy ? '正在对比…' : '开始数据对比'}</button>}
          {mode === 'transfer' && <button className="advanced-primary" disabled={busy || !sourceTable || !targetTable || sourceTableKey === targetTableKey} onClick={() => void transferData()}><ArrowsLeftRight />{busy ? '正在传输…' : '开始数据传输'}</button>}
          {mode === 'er' && <button className="advanced-primary" disabled={busy || !sourceDatabaseKey} onClick={() => void loadEr()}><FlowArrow />{busy ? '正在读取关系…' : '生成 ER 图'}</button>}
        </section>
        {mode === 'routine' && <><p className="advanced-hint">可视化编辑名称、参数和过程体后生成 SQL；当前版本同时允许直接粘贴完整 CREATE OR REPLACE / DROP + CREATE 语句。</p><textarea className="routine-editor" value={routineSql} onChange={(event) => setRoutineSql(event.target.value)} placeholder={'CREATE PROCEDURE procedure_name(...)\nBEGIN\n  -- SQL\nEND;'} /><button className="advanced-primary" disabled={busy || !routineSql.trim()} onClick={() => void executeRoutine()}><Play />保存并执行</button></>}
        {message && <p className="advanced-message">{message}</p>}
        {(mode === 'schema' || mode === 'data') && diffRows.length > 0 && <section className="advanced-results"><header><div><strong>对比结果</strong><small>共检查 {diffRows.length} 项</small></div><div className="advanced-result-metrics"><span className="different">差异 {changedCount}</span><span className="same">一致 {sameCount}</span></div></header><div className="advanced-diff-table"><table><colgroup><col className="object-column" /><col /><col /><col className="status-column" /></colgroup><thead><tr><th>对象/键</th><th>源</th><th>目标</th><th>状态</th></tr></thead><tbody>{diffRows.map((item, index) => <tr key={`${item.object}-${index}`} className={item.status}><td title={item.object}>{item.object}</td><td title={item.source}>{item.source}</td><td title={item.target}>{item.target}</td><td><span>{labelStatus[item.status]}</span></td></tr>)}</tbody></table></div></section>}
        {(mode === 'schema' || mode === 'data') && !busy && diffRows.length === 0 && <div className="advanced-empty"><GitDiff /><strong>等待开始对比</strong><span>选择源和目标后，点击上方按钮查看差异</span></div>}
        {mode === 'er' && erDefinitions.length > 0 && <div className="er-canvas">{erDefinitions.map((item) => <article key={item.table.name}><header>{item.table.name}</header>{(item.definition.columns ?? []).map((column) => <div key={column.name} className={column.primaryKey ? 'primary' : ''}><span>{column.primaryKey ? 'PK' : ''}</span><strong>{column.name}</strong><small>{column.typeDefinition ?? column.type}</small></div>)}{(item.definition.foreignKeys ?? []).map((foreignKey) => <footer key={foreignKey.name}>↳ {foreignKey.column} → {foreignKey.referencedTable}.{foreignKey.referencedColumn}</footer>)}</article>)}</div>}
      </div>
    </section>
  </div>
}

export default DatabaseAdvancedTools
