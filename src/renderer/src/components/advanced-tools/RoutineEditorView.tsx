import { useEffect, useState } from 'react'
import { Play } from '@phosphor-icons/react'
import SearchableSelect from '../SearchableSelect'
import type { DatabaseConnection, DatabaseItem } from '@/shared/connections'
import type { DatabaseTarget } from './types'
import { databaseKey } from './types'

interface RoutineEditorViewProps {
  connectionOptions: Array<{ value: string; label: string }>
  databasesByConnection: Record<number, DatabaseItem[]>
  loadDatabases: (connectionId: number) => Promise<DatabaseItem[]>
  initialRoutineSql?: string
}

export default function RoutineEditorView({
  connectionOptions,
  databasesByConnection,
  loadDatabases,
  initialRoutineSql = ''
}: RoutineEditorViewProps) {
  const [connectionId, setConnectionId] = useState('')
  const [databaseName, setDatabaseName] = useState('')
  const [routineSql, setRoutineSql] = useState(initialRoutineSql)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (connectionId) void loadDatabases(Number(connectionId))
  }, [connectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const databases = connectionId ? (databasesByConnection[Number(connectionId)] ?? []) : []
  const databaseOptions = databases.map((db) => ({ value: db.name, label: db.name }))

  const currentTarget: DatabaseTarget | null =
    connectionId && databaseName
      ? {
          connection: { id: Number(connectionId) } as DatabaseConnection,
          database: databases.find((db) => db.name === databaseName) ?? ({ name: '' } as DatabaseItem)
        }
      : null

  const currentDbKey = currentTarget ? databaseKey(currentTarget) : ''

  const executeRoutine = async (): Promise<void> => {
    if (!currentTarget || !routineSql.trim())
      return setMessage('请选择数据库并填写存储过程 SQL')
    setBusy(true)
    const result = await window.omnidb.queries.execute(
      currentTarget.connection.id,
      currentTarget.database.name,
      routineSql
    )
    setMessage(result.message)
    setBusy(false)
  }

  return (
    <>
      <section className="advanced-tool-config">
        <div className="advanced-tool-config-title">
          <strong>存储过程配置</strong>
          <small>编辑并执行数据库存储过程定义</small>
        </div>
        <div className="advanced-field">
          <span>连接</span>
          <SearchableSelect
            value={connectionId}
            options={connectionOptions}
            onChange={(value) => {
              setConnectionId(value)
              setDatabaseName('')
            }}
            placeholder="选择连接"
          />
        </div>
        {connectionId && (
          <div className="advanced-field">
            <span>数据库</span>
            <SearchableSelect
              value={databaseName}
              options={databaseOptions}
              onChange={setDatabaseName}
              placeholder="选择数据库"
            />
          </div>
        )}
      </section>

      <p className="advanced-hint">
        可视化编辑名称、参数和过程体后生成 SQL；当前版本同时允许直接粘贴完整 CREATE
        OR REPLACE / DROP + CREATE 语句。
      </p>
      <textarea
        className="routine-editor"
        value={routineSql}
        onChange={(event) => setRoutineSql(event.target.value)}
        placeholder={'CREATE PROCEDURE procedure_name(...)\nBEGIN\n  -- SQL\nEND;'}
      />
      <button
        className="advanced-primary"
        disabled={busy || !routineSql.trim() || !currentDbKey}
        onClick={() => void executeRoutine()}
      >
        <Play />
        保存并执行
      </button>

      {message && <p className="advanced-message">{message}</p>}
    </>
  )
}
