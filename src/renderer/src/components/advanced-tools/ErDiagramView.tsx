import { useEffect, useState } from 'react'
import { FlowArrow } from '@phosphor-icons/react'
import type { TableDefinitionResult, TableItem, DatabaseConnection, DatabaseItem } from '@/shared/connections'
import SearchableSelect from '../SearchableSelect'
import type { DatabaseTarget } from './types'
import { databaseKey } from './types'

interface ErDiagramViewProps {
  connectionOptions: Array<{ value: string; label: string }>
  databasesByConnection: Record<number, DatabaseItem[]>
  loadDatabases: (connectionId: number) => Promise<DatabaseItem[]>
}

export default function ErDiagramView({
  connectionOptions,
  databasesByConnection,
  loadDatabases
}: ErDiagramViewProps) {
  const [connectionId, setConnectionId] = useState('')
  const [databaseName, setDatabaseName] = useState('')
  const [erDefinitions, setErDefinitions] = useState<
    Array<{ table: TableItem; definition: TableDefinitionResult }>
  >([])
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

  const loadEr = async (): Promise<void> => {
    if (!currentTarget) return setMessage('请选择数据库')
    setBusy(true)
    setMessage('')
    try {
      const definitions = await Promise.all(
        currentTarget.database.tables.map(async (table) => ({
          table,
          definition: await window.omnidb.tables.getDefinition(
            currentTarget.connection.id,
            currentTarget.database.name,
            table.name
          )
        }))
      )
      setErDefinitions(definitions)
      setMessage(
        `已生成 ${definitions.length} 张表、${definitions.reduce(
          (sum, item) => sum + (item.definition.foreignKeys?.length ?? 0),
          0
        )} 条关系`
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="advanced-tool-config">
        <div className="advanced-tool-config-title">
          <strong>选择关系图数据库</strong>
          <small>读取表字段、主键和外键并生成关系视图</small>
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
        <button
          className="advanced-primary"
          disabled={busy || !currentDbKey}
          onClick={() => void loadEr()}
        >
          <FlowArrow />
          {busy ? '正在读取关系…' : '生成 ER 图'}
        </button>
      </section>

      {message && <p className="advanced-message">{message}</p>}

      {erDefinitions.length > 0 && (
        <div className="er-canvas">
          {erDefinitions.map((item) => (
            <article key={item.table.name}>
              <header>{item.table.name}</header>
              {(item.definition.columns ?? []).map((column) => (
                <div
                  key={column.name}
                  className={column.primaryKey ? 'primary' : ''}
                >
                  <span>{column.primaryKey ? 'PK' : ''}</span>
                  <strong>{column.name}</strong>
                  <small>{column.typeDefinition ?? column.type}</small>
                </div>
              ))}
              {(item.definition.foreignKeys ?? []).map((foreignKey) => (
                <footer key={foreignKey.name}>
                  ↳ {foreignKey.column} → {foreignKey.referencedTable}.
                  {foreignKey.referencedColumn}
                </footer>
              ))}
            </article>
          ))}
        </div>
      )}
    </>
  )
}
