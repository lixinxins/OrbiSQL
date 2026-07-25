import { useEffect, useState } from 'react'
import { GitDiff } from '@phosphor-icons/react'
import SearchableSelect from '../SearchableSelect'
import type { DatabaseConnection, DatabaseItem } from '@/shared/connections'
import type { DatabaseTarget, DiffRow } from './types'
import { databaseKey, labelStatus } from './types'

interface SchemaDiffViewProps {
  connectionOptions: Array<{ value: string; label: string }>
  databasesByConnection: Record<number, DatabaseItem[]>
  loadDatabases: (connectionId: number) => Promise<DatabaseItem[]>
}

export default function SchemaDiffView({
  connectionOptions,
  databasesByConnection,
  loadDatabases
}: SchemaDiffViewProps) {
  const [sourceConnectionId, setSourceConnectionId] = useState('')
  const [sourceDatabaseName, setSourceDatabaseName] = useState('')
  const [targetConnectionId, setTargetConnectionId] = useState('')
  const [targetDatabaseName, setTargetDatabaseName] = useState('')
  const [diffRows, setDiffRows] = useState<DiffRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // 选择源连接后加载数据库
  useEffect(() => {
    if (sourceConnectionId) void loadDatabases(Number(sourceConnectionId))
  }, [sourceConnectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 选择目标连接后加载数据库
  useEffect(() => {
    if (targetConnectionId) void loadDatabases(Number(targetConnectionId))
  }, [targetConnectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const sourceDatabases = sourceConnectionId ? (databasesByConnection[Number(sourceConnectionId)] ?? []) : []
  const targetDatabases = targetConnectionId ? (databasesByConnection[Number(targetConnectionId)] ?? []) : []

  const sourceDatabaseOptions = sourceDatabases.map((db) => ({ value: db.name, label: db.name }))
  const targetDatabaseOptions = targetDatabases.map((db) => ({ value: db.name, label: db.name }))

  const sourceTarget: DatabaseTarget | null =
    sourceConnectionId && sourceDatabaseName
      ? {
          connection: { id: Number(sourceConnectionId) } as DatabaseConnection,
          database: sourceDatabases.find((db) => db.name === sourceDatabaseName) ?? ({ name: '' } as DatabaseItem)
        }
      : null

  const targetTarget: DatabaseTarget | null =
    targetConnectionId && targetDatabaseName
      ? {
          connection: { id: Number(targetConnectionId) } as DatabaseConnection,
          database: targetDatabases.find((db) => db.name === targetDatabaseName) ?? ({ name: '' } as DatabaseItem)
        }
      : null

  const sourceDbKey = sourceTarget ? databaseKey(sourceTarget) : ''
  const targetDbKey = targetTarget ? databaseKey(targetTarget) : ''

  const compareSchema = async (): Promise<void> => {
    if (!sourceTarget || !targetTarget) return setMessage('请选择源数据库和目标数据库')
    const source = sourceTarget
    const target = targetTarget
    setBusy(true)
    setMessage('')
    try {
      const names = Array.from(
        new Set([
          ...source.database.tables.map((item) => item.name),
          ...target.database.tables.map((item) => item.name)
        ])
      )
      const results: DiffRow[] = []
      for (const name of names) {
        const sourceTableItem = source.database.tables.find((item) => item.name === name)
        const targetTableItem = target.database.tables.find((item) => item.name === name)
        if (!sourceTableItem) {
          results.push({ object: `表 ${name}`, source: '不存在', target: '存在', status: 'added' })
          continue
        }
        if (!targetTableItem) {
          results.push({ object: `表 ${name}`, source: '存在', target: '不存在', status: 'removed' })
          continue
        }
        const [sourceDefinition, targetDefinition] = await Promise.all([
          window.omnidb.tables.getDefinition(source.connection.id, source.database.name, name),
          window.omnidb.tables.getDefinition(target.connection.id, target.database.name, name)
        ])
        const sourceColumns = sourceDefinition.columns ?? []
        const targetColumns = targetDefinition.columns ?? []
        const columnNames = Array.from(
          new Set([...sourceColumns.map((item) => item.name), ...targetColumns.map((item) => item.name)])
        )
        for (const columnName of columnNames) {
          const left = sourceColumns.find((item) => item.name === columnName)
          const right = targetColumns.find((item) => item.name === columnName)
          const describe = (column: typeof left): string =>
            column
              ? `${column.typeDefinition ?? column.type}${column.notNull ? ' NOT NULL' : ''}${column.primaryKey ? ' PK' : ''}`
              : '不存在'
          const status: DiffRow['status'] = !left
            ? 'added'
            : !right
              ? 'removed'
              : describe(left) === describe(right)
                ? 'same'
                : 'changed'
          results.push({ object: `${name}.${columnName}`, source: describe(left), target: describe(right), status })
        }
      }
      setDiffRows(results)
      setMessage(`对比完成：${results.filter((item) => item.status !== 'same').length} 项差异`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '结构对比失败')
    } finally {
      setBusy(false)
    }
  }

  const changedCount = diffRows.filter((item) => item.status !== 'same').length
  const sameCount = diffRows.length - changedCount

  return (
    <>
      <section className="advanced-tool-config">
        <div className="advanced-tool-config-title">
          <strong>选择对比数据库</strong>
          <small>对比表和字段定义，找出新增、缺少及变更项</small>
        </div>
        <div className="advanced-field">
          <span>源连接</span>
          <SearchableSelect
            value={sourceConnectionId}
            options={connectionOptions}
            onChange={(value) => {
              setSourceConnectionId(value)
              setSourceDatabaseName('')
            }}
            placeholder="选择源连接"
          />
        </div>
        {sourceConnectionId && (
          <div className="advanced-field">
            <span>源数据库</span>
            <SearchableSelect
              value={sourceDatabaseName}
              options={sourceDatabaseOptions}
              onChange={setSourceDatabaseName}
              placeholder="选择源数据库"
            />
          </div>
        )}
        <div className="advanced-field">
          <span>目标连接</span>
          <SearchableSelect
            value={targetConnectionId}
            options={connectionOptions}
            onChange={(value) => {
              setTargetConnectionId(value)
              setTargetDatabaseName('')
            }}
            placeholder="选择目标连接"
          />
        </div>
        {targetConnectionId && (
          <div className="advanced-field">
            <span>目标数据库</span>
            <SearchableSelect
              value={targetDatabaseName}
              options={targetDatabaseOptions}
              onChange={setTargetDatabaseName}
              placeholder="选择目标数据库"
            />
          </div>
        )}
        <button
          className="advanced-primary"
          disabled={busy || !sourceDbKey || !targetDbKey}
          onClick={() => void compareSchema()}
        >
          <GitDiff />
          {busy ? '正在对比…' : '开始结构对比'}
        </button>
      </section>

      {message && <p className="advanced-message">{message}</p>}

      {diffRows.length > 0 && (
        <section className="advanced-results">
          <header>
            <div>
              <strong>对比结果</strong>
              <small>共检查 {diffRows.length} 项</small>
            </div>
            <div className="advanced-result-metrics">
              <span className="different">差异 {changedCount}</span>
              <span className="same">一致 {sameCount}</span>
            </div>
          </header>
          <div className="advanced-diff-table">
            <table>
              <colgroup>
                <col className="object-column" />
                <col />
                <col />
                <col className="status-column" />
              </colgroup>
              <thead>
                <tr>
                  <th>对象/键</th>
                  <th>源</th>
                  <th>目标</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {diffRows.map((item, index) => (
                  <tr key={`${item.object}-${index}`} className={item.status}>
                    <td title={item.object}>{item.object}</td>
                    <td title={item.source}>{item.source}</td>
                    <td title={item.target}>{item.target}</td>
                    <td>
                      <span>{labelStatus[item.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!busy && diffRows.length === 0 && (
        <div className="advanced-empty">
          <GitDiff />
          <strong>等待开始对比</strong>
          <span>选择源和目标后，点击上方按钮查看差异</span>
        </div>
      )}
    </>
  )
}
