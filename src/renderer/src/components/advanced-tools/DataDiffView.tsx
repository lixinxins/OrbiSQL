import { useEffect, useState } from 'react'
import { ArrowsLeftRight, GitDiff } from '@phosphor-icons/react'
import SearchableSelect from '../SearchableSelect'
import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import type { DiffRow, TableTarget } from './types'
import { labelStatus } from './types'

interface DataDiffViewProps {
  connectionOptions: Array<{ value: string; label: string }>
  databasesByConnection: Record<number, DatabaseItem[]>
  tablesByDbKey: Record<string, TableItem[]>
  loadDatabases: (connectionId: number) => Promise<DatabaseItem[]>
  loadTables: (connectionId: number, databaseName: string) => Promise<TableItem[]>
}

export default function DataDiffView({
  connectionOptions,
  databasesByConnection,
  tablesByDbKey,
  loadDatabases,
  loadTables
}: DataDiffViewProps) {
  const [sourceConnectionId, setSourceConnectionId] = useState('')
  const [sourceDatabaseName, setSourceDatabaseName] = useState('')
  const [sourceTableName, setSourceTableName] = useState('')
  const [targetConnectionId, setTargetConnectionId] = useState('')
  const [targetDatabaseName, setTargetDatabaseName] = useState('')
  const [targetTableName, setTargetTableName] = useState('')
  const [keyColumn, setKeyColumn] = useState('')
  const [diffRows, setDiffRows] = useState<DiffRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (sourceConnectionId) void loadDatabases(Number(sourceConnectionId))
  }, [sourceConnectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (targetConnectionId) void loadDatabases(Number(targetConnectionId))
  }, [targetConnectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sourceConnectionId && sourceDatabaseName) void loadTables(Number(sourceConnectionId), sourceDatabaseName)
  }, [sourceConnectionId, sourceDatabaseName]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (targetConnectionId && targetDatabaseName) void loadTables(Number(targetConnectionId), targetDatabaseName)
  }, [targetConnectionId, targetDatabaseName]) // eslint-disable-line react-hooks/exhaustive-deps

  const sourceDatabases = sourceConnectionId ? (databasesByConnection[Number(sourceConnectionId)] ?? []) : []
  const targetDatabases = targetConnectionId ? (databasesByConnection[Number(targetConnectionId)] ?? []) : []
  const sourceDbKey = `${sourceConnectionId}\0${sourceDatabaseName}`
  const targetDbKey = `${targetConnectionId}\0${targetDatabaseName}`
  const sourceTables = sourceDatabaseName ? (tablesByDbKey[sourceDbKey] ?? []) : []
  const targetTables = targetDatabaseName ? (tablesByDbKey[targetDbKey] ?? []) : []

  const sourceTableOptions = sourceTables.map((t) => ({ value: t.name, label: t.name }))
  const targetTableOptions = targetTables.map((t) => ({ value: t.name, label: t.name }))

  const sourceTarget: TableTarget | null =
    sourceConnectionId && sourceDatabaseName && sourceTableName
      ? {
          connection: { id: Number(sourceConnectionId) } as DatabaseConnection,
          database: sourceDatabases.find((db) => db.name === sourceDatabaseName) ?? ({ name: '' } as DatabaseItem),
          table: sourceTables.find((t) => t.name === sourceTableName) ?? ({ name: '' } as TableItem)
        }
      : null

  const targetTarget: TableTarget | null =
    targetConnectionId && targetDatabaseName && targetTableName
      ? {
          connection: { id: Number(targetConnectionId) } as DatabaseConnection,
          database: targetDatabases.find((db) => db.name === targetDatabaseName) ?? ({ name: '' } as DatabaseItem),
          table: targetTables.find((t) => t.name === targetTableName) ?? ({ name: '' } as TableItem)
        }
      : null

  const compareData = async (): Promise<void> => {
    if (!sourceTarget || !targetTarget || !keyColumn)
      return setMessage('请选择两张表并指定主键/唯一键字段')
    setBusy(true)
    setMessage('')
    try {
      const [left, right] = await Promise.all([
        window.omnidb.tables.readData(
          sourceTarget.connection.id,
          sourceTarget.database.name,
          sourceTarget.table.name,
          5000,
          0
        ),
        window.omnidb.tables.readData(
          targetTarget.connection.id,
          targetTarget.database.name,
          targetTarget.table.name,
          5000,
          0
        )
      ])
      if (!left.success || !right.success)
        throw new Error(left.success ? right.message : left.message)
      const leftMap = new Map(
        (left.rows ?? []).map((row) => [String(row[keyColumn]), row])
      )
      const rightMap = new Map(
        (right.rows ?? []).map((row) => [String(row[keyColumn]), row])
      )
      const keys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()]))
      setDiffRows(
        keys.map((key) => {
          const source = leftMap.get(key)
          const target = rightMap.get(key)
          return {
            object: `${keyColumn}=${key}`,
            source: source ? JSON.stringify(source) : '不存在',
            target: target ? JSON.stringify(target) : '不存在',
            status: !source
              ? 'added'
              : !target
                ? 'removed'
                : JSON.stringify(source) === JSON.stringify(target)
                  ? 'same'
                  : 'changed'
          }
        })
      )
      setMessage(`已对比 ${keys.length} 个键值（单表最多 5000 行）`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '数据对比失败')
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
          <strong>选择对比数据表</strong>
          <small>按照主键或唯一字段匹配记录，单表最多读取 5000 行</small>
        </div>
        <div className="advanced-data-fields">
          <div className="advanced-field">
            <span>源连接</span>
            <SearchableSelect
              value={sourceConnectionId}
              options={connectionOptions}
              onChange={(value) => {
                setSourceConnectionId(value)
                setSourceDatabaseName('')
                setSourceTableName('')
              }}
              placeholder="选择源连接"
            />
          </div>
          {sourceConnectionId && (
            <div className="advanced-field">
              <span>源数据库</span>
              <SearchableSelect
                value={sourceDatabaseName}
                options={sourceDatabases.map((db) => ({ value: db.name, label: db.name }))}
                onChange={(value) => {
                  setSourceDatabaseName(value)
                  setSourceTableName('')
                }}
                placeholder="选择源数据库"
              />
            </div>
          )}
          {sourceDatabaseName && (
            <div className="advanced-field">
              <span>源数据表</span>
              <SearchableSelect
                value={sourceTableName}
                options={sourceTableOptions}
                onChange={(value) => {
                  setSourceTableName(value)
                  setKeyColumn('')
                }}
                placeholder="选择源表"
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
                setTargetTableName('')
              }}
              placeholder="选择目标连接"
            />
          </div>
          {targetConnectionId && (
            <div className="advanced-field">
              <span>目标数据库</span>
              <SearchableSelect
                value={targetDatabaseName}
                options={targetDatabases.map((db) => ({ value: db.name, label: db.name }))}
                onChange={(value) => {
                  setTargetDatabaseName(value)
                  setTargetTableName('')
                }}
                placeholder="选择目标数据库"
              />
            </div>
          )}
          {targetDatabaseName && (
            <div className="advanced-field">
              <span>目标数据表</span>
              <SearchableSelect
                value={targetTableName}
                options={targetTableOptions}
                onChange={setTargetTableName}
                placeholder="选择目标表"
              />
            </div>
          )}
          <label className="advanced-field">
            <span>对比键</span>
            <select
              value={keyColumn}
              onChange={(event) => setKeyColumn(event.target.value)}
            >
              <option value="">请选择主键或唯一字段</option>
              {sourceTarget?.table.columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="advanced-primary"
          disabled={busy || !sourceTarget || !targetTarget || !keyColumn}
          onClick={() => void compareData()}
        >
          <ArrowsLeftRight />
          {busy ? '正在对比…' : '开始数据对比'}
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
