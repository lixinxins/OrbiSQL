import { useEffect, useState } from 'react'
import { ArrowsLeftRight } from '@phosphor-icons/react'
import SearchableSelect from '../SearchableSelect'
import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import type { TableTarget } from './types'
import { tableKey } from './types'

interface DataTransferViewProps {
  connectionOptions: Array<{ value: string; label: string }>
  databasesByConnection: Record<number, DatabaseItem[]>
  tablesByDbKey: Record<string, TableItem[]>
  loadDatabases: (connectionId: number) => Promise<DatabaseItem[]>
  loadTables: (connectionId: number, databaseName: string) => Promise<TableItem[]>
}

export default function DataTransferView({
  connectionOptions,
  databasesByConnection,
  tablesByDbKey,
  loadDatabases,
  loadTables
}: DataTransferViewProps) {
  const [sourceConnectionId, setSourceConnectionId] = useState('')
  const [sourceDatabaseName, setSourceDatabaseName] = useState('')
  const [sourceTableName, setSourceTableName] = useState('')
  const [targetConnectionId, setTargetConnectionId] = useState('')
  const [targetDatabaseName, setTargetDatabaseName] = useState('')
  const [targetTableName, setTargetTableName] = useState('')
  const [clearTarget, setClearTarget] = useState(false)
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

  const sourceTblKey = sourceTarget ? tableKey(sourceTarget) : ''
  const targetTblKey = targetTarget ? tableKey(targetTarget) : ''

  const transferData = async (): Promise<void> => {
    if (!sourceTarget || !targetTarget)
      return setMessage('请选择源数据表和目标数据表')
    setBusy(true)
    setMessage('')
    try {
      const result = await window.omnidb.tables.transferData({
        sourceConnectionId: sourceTarget.connection.id,
        sourceDatabaseName: sourceTarget.database.name,
        sourceTableName: sourceTarget.table.name,
        targetConnectionId: targetTarget.connection.id,
        targetDatabaseName: targetTarget.database.name,
        targetTableName: targetTarget.table.name,
        clearTarget
      })
      setMessage(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="advanced-tool-config">
        <div className="advanced-tool-config-title">
          <strong>选择传输数据表</strong>
          <small>自动匹配同名字段，支持跨连接和跨数据库传输</small>
        </div>
        <div className="advanced-data-fields transfer">
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
                onChange={setSourceTableName}
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
          <label className="advanced-transfer-option">
            <input
              type="checkbox"
              checked={clearTarget}
              onChange={(event) => setClearTarget(event.target.checked)}
            />
            <span>
              <strong>传输前清空目标表</strong>
              <small>关闭时将数据追加到目标表</small>
            </span>
          </label>
        </div>
        <button
          className="advanced-primary"
          disabled={busy || !sourceTarget || !targetTarget || sourceTblKey === targetTblKey}
          onClick={() => void transferData()}
        >
          <ArrowsLeftRight />
          {busy ? '正在传输…' : '开始数据传输'}
        </button>
      </section>

      {message && <p className="advanced-message">{message}</p>}
    </>
  )
}
