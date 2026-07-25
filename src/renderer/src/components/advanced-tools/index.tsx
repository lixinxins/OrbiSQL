import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowsLeftRight,
  Database,
  FlowArrow,
  GitDiff,
  Play,
  X
} from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, TableItem, TableColumn } from '@/shared/connections'
import type { AdvancedToolMode } from './types'
import SchemaDiffView from './SchemaDiffView'
import DataDiffView from './DataDiffView'
import DataTransferView from './DataTransferView'
import ErDiagramView from './ErDiagramView'
import RoutineEditorView from './RoutineEditorView'

export type { AdvancedToolMode }

interface Props {
  connections: DatabaseConnection[]
  initialMode?: AdvancedToolMode
  initialRoutineSql?: string
  onClose: () => void
}

export default function DatabaseAdvancedTools({
  connections: _connections,
  initialMode = 'schema',
  initialRoutineSql = '',
  onClose
}: Props) {
  const [mode, setMode] = useState<AdvancedToolMode>(initialMode)
  const [availableConnections, setAvailableConnections] = useState<DatabaseConnection[]>([])
  const [databasesByConnection, setDatabasesByConnection] = useState<Record<number, DatabaseItem[]>>({})
  const [tablesByDbKey, setTablesByDbKey] = useState<Record<string, TableItem[]>>({})
  const openedIdsRef = useRef<Set<number>>(new Set())

  // 挂载时只加载连接列表（不打开任何连接）
  useEffect(() => {
    void window.omnidb.connections.list().then((all) => {
      setAvailableConnections(all.filter((c) => c.engine !== 'SSH'))
    })
    return () => {
      openedIdsRef.current.forEach((id) => {
        void window.omnidb.connections.close(id)
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 按需加载某个连接的数据库列表
  const loadDatabases = useCallback(
    async (connectionId: number): Promise<DatabaseItem[]> => {
      if (databasesByConnection[connectionId]) return databasesByConnection[connectionId]
      try {
        const result = await window.omnidb.connections.open(connectionId)
        if (!result.success) return []
        openedIdsRef.current.add(connectionId)
        const all = await window.omnidb.connections.list()
        const conn = all.find((c) => c.id === connectionId)
        const databases = conn?.databases ?? []
        setDatabasesByConnection((prev) => ({ ...prev, [connectionId]: databases }))
        return databases
      } catch {
        return []
      }
    },
    [databasesByConnection]
  )

  // 按需加载某个数据库的表列表（含列信息）
  const loadTables = useCallback(
    async (connectionId: number, databaseName: string): Promise<TableItem[]> => {
      const dbKey = `${connectionId}\0${databaseName}`
      if (tablesByDbKey[dbKey]) return tablesByDbKey[dbKey]
      try {
        const definition = await window.omnidb.connections.getOne(connectionId)
        const db = definition?.databases.find((d) => d.name === databaseName)
        const tables = db?.tables ?? []
        // 如果 light 模式下没有列信息，逐个加载表定义
        if (tables.length > 0 && tables[0].columns.length === 0) {
          const definitions = await Promise.all(
            tables.map((t) => window.omnidb.tables.getDefinition(connectionId, databaseName, t.name))
          )
          const enriched: TableItem[] = tables.map((t, i) => {
            const def = definitions[i]
            const cols: TableColumn[] = def?.columns
              ? def.columns.map((c) => ({
                  name: c.name,
                  type: c.type,
                  nullable: !c.notNull,
                  isPrimaryKey: c.primaryKey,
                  comment: c.comment
                }))
              : t.columns
            return {
              ...t,
              columns: cols,
              indexes: def?.indexes ? def.indexes.map((idx) => idx.name) : t.indexes,
              foreignKeys: def?.foreignKeys ? def.foreignKeys.map((fk) => `${fk.name} (${fk.column}) -> ${fk.referencedTable}(${fk.referencedColumn})`) : t.foreignKeys
            }
          })
          setTablesByDbKey((prev) => ({ ...prev, [dbKey]: enriched }))
          return enriched
        }
        setTablesByDbKey((prev) => ({ ...prev, [dbKey]: tables }))
        return tables
      } catch {
        return []
      }
    },
    [tablesByDbKey]
  )

  const connectionOptions = useMemo(
    () => availableConnections.map((c) => ({ value: String(c.id), label: c.name })),
    [availableConnections]
  )

  if (availableConnections.length === 0) {
    return (
      <div className="advanced-tools-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <section className="advanced-tools-dialog" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <Database size={32} className="database-load-spinner" />
          <p style={{ marginTop: '1rem', opacity: 0.6 }}>正在加载连接列表…</p>
        </section>
      </div>
    )
  }

  return (
    <div
      className="advanced-tools-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="advanced-tools-dialog">
        <header>
          <div className="advanced-tools-title">
            <span className="advanced-tools-icon">
              <Database weight="duotone" />
            </span>
            <span>
              <strong>数据库高级工具</strong>
              <small>结构、数据与数据库对象管理</small>
            </span>
          </div>
          <button
            className="advanced-tools-close"
            type="button"
            title="关闭"
            onClick={onClose}
          >
            <X />
          </button>
        </header>

        <nav>
          <button
            className={mode === 'schema' ? 'active' : ''}
            onClick={() => setMode('schema')}
          >
            <GitDiff />
            结构对比
          </button>
          <button
            className={mode === 'data' ? 'active' : ''}
            onClick={() => setMode('data')}
          >
            <ArrowsLeftRight />
            数据对比
          </button>
          <button
            className={mode === 'transfer' ? 'active' : ''}
            onClick={() => setMode('transfer')}
          >
            <ArrowsLeftRight />
            数据传输
          </button>
          <button
            className={mode === 'er' ? 'active' : ''}
            onClick={() => setMode('er')}
          >
            <FlowArrow />
            ER 关系图
          </button>
          <button
            className={mode === 'routine' ? 'active' : ''}
            onClick={() => setMode('routine')}
          >
            <Play />
            存储过程
          </button>
        </nav>

        <div className="advanced-tools-content">
          {mode === 'schema' && (
            <SchemaDiffView
              connectionOptions={connectionOptions}
              databasesByConnection={databasesByConnection}
              loadDatabases={loadDatabases}
            />
          )}

          {mode === 'data' && (
            <DataDiffView
              connectionOptions={connectionOptions}
              databasesByConnection={databasesByConnection}
              tablesByDbKey={tablesByDbKey}
              loadDatabases={loadDatabases}
              loadTables={loadTables}
            />
          )}

          {mode === 'transfer' && (
            <DataTransferView
              connectionOptions={connectionOptions}
              databasesByConnection={databasesByConnection}
              tablesByDbKey={tablesByDbKey}
              loadDatabases={loadDatabases}
              loadTables={loadTables}
            />
          )}

          {mode === 'er' && (
            <ErDiagramView
              connectionOptions={connectionOptions}
              databasesByConnection={databasesByConnection}
              loadDatabases={loadDatabases}
            />
          )}

          {mode === 'routine' && (
            <RoutineEditorView
              connectionOptions={connectionOptions}
              databasesByConnection={databasesByConnection}
              loadDatabases={loadDatabases}
              initialRoutineSql={initialRoutineSql}
            />
          )}
        </div>
      </section>
    </div>
  )
}
