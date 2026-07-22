import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import {
  Broom,
  CaretDown,
  CaretRight,
  Code,
  Copy,
  CircleNotch,
  Database,
  DownloadSimple,
  FileCode,
  FileSql,
  FolderOpen,
  HardDrives,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Power,
  ArrowsClockwise,
  Rows,
  Table,
  Trash,
  UploadSimple,
  Wrench
} from '@phosphor-icons/react'
import type { ConnectionGroup, DatabaseConnection, DatabaseEngine, DatabaseItem, TableItem } from '../../../shared/connections'

interface ConnectionSidebarProps {
  connections: DatabaseConnection[]
  loading: boolean
  groupsRefreshRequest: number
  onNewConnection: () => void
  onGroupsChanged: () => void
  onEditConnection: (connection: DatabaseConnection) => void
  onToggleConnection: (connection: DatabaseConnection) => Promise<boolean>
  onDuplicateConnection: (connection: DatabaseConnection) => void
  onDeleteConnection: (connection: DatabaseConnection) => void
  onRefreshConnection: (connection: DatabaseConnection) => void
  onRunSqlFile: (connection: DatabaseConnection) => void
  onCreateDatabase: (connection: DatabaseConnection) => void
  onEditDatabase: (connection: DatabaseConnection, database: DatabaseItem) => void
  onDeleteDatabase: (connection: DatabaseConnection, database: DatabaseItem) => void
  onNewQuery: (connection: DatabaseConnection, database: DatabaseItem) => void
  onRunDatabaseSqlFile: (connection: DatabaseConnection, database: DatabaseItem) => void
  onExportSql: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem | undefined, includeData: boolean) => void
  onDatabaseOpenStateChange: (connection: DatabaseConnection, database: DatabaseItem, open: boolean) => void
  onSelectDatabase: (connection: DatabaseConnection, database: DatabaseItem) => void
  onLoadDatabase: (connection: DatabaseConnection, database: DatabaseItem) => Promise<{ connection: DatabaseConnection; database: DatabaseItem } | null>
  onCreateTable: (connection: DatabaseConnection, database: DatabaseItem) => void
  onOpenTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onDesignTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onRenameTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onDeleteTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onTruncateTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onCopyTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem, includeData: boolean) => void
  onExportTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onSelectImportTable: (connection: DatabaseConnection, database: DatabaseItem) => void
  onSelectExportTable: (connection: DatabaseConnection, database: DatabaseItem) => void
  onGenerateSql?: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem, sqlKind: 'select' | 'insert' | 'update' | 'delete' | 'ddl') => void
  onMaintainTable?: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem, action: 'check' | 'optimize' | 'analyze') => void
  onShowTableInfo?: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onObjectAction?: (connection: DatabaseConnection, database: DatabaseItem, groupKey: string, objectName: string, action: 'query' | 'ddl' | 'edit' | 'copy' | 'drop') => void
  onSetConnectionColor?: (connection: DatabaseConnection, color: string) => void
  onExportDataDictionary?: (connection: DatabaseConnection, database: DatabaseItem) => void
  onShowProcesslist?: (connection: DatabaseConnection) => void
  onCreateObject?: (connection: DatabaseConnection, database: DatabaseItem, groupKey: string, groupLabel: string) => void
  onCopySqlStatement?: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem, type: 'select' | 'insert') => void
  onTruncateDatabase?: (connection: DatabaseConnection, database: DatabaseItem) => void
  onCopyDatabase?: (connection: DatabaseConnection, database: DatabaseItem, includeData: boolean) => void
}

interface ConnectionContextMenu {
  x: number
  y: number
  connection: DatabaseConnection
}

interface DatabaseContextMenu extends ConnectionContextMenu {
  database: DatabaseItem
  databaseKey: string
}

interface TableContextMenu extends DatabaseContextMenu {
  table: TableItem
}

interface ObjectContextMenu extends DatabaseContextMenu {
  groupKey: string
  groupLabel: string
  objectName: string
}

interface ObjectGroupContextMenu extends DatabaseContextMenu {
  groupKey: string
  groupLabel: string
}

type TableGroupContextMenu = DatabaseContextMenu

type ObjectGroupKey =
  | 'views'
  | 'functions'
  | 'procedures'
  | 'indexes'
  | 'triggers'
  | 'materializedViews'
  | 'sequences'
  | 'packages'
  | 'synonyms'
  | 'events'
  | 'dictionaries'
  | 'aliases'
  | 'dataStreams'
  | 'mappings'

interface ObjectGroup {
  key: ObjectGroupKey
  label: string
}

interface EngineTreeConfig {
  itemLabel: string
  groups: ObjectGroup[]
  tableGroups: Array<{ key: TableGroupKey; label: string }>
}

type TableGroupKey = keyof Pick<TableItem, 'columns' | 'indexes' | 'foreignKeys' | 'checks' | 'triggers'>

const relationalTableGroups: Array<{ key: TableGroupKey; label: string }> = [
  { key: 'columns', label: '字段' },
  { key: 'indexes', label: '索引' },
  { key: 'foreignKeys', label: '外键' },
  { key: 'checks', label: '检查' },
  { key: 'triggers', label: '触发器' }
]

const engineTreeConfigs: Record<DatabaseEngine, EngineTreeConfig> = {
  MySQL: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'procedures', label: '存储过程' }],
    tableGroups: relationalTableGroups
  },
  MariaDB: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'events', label: '事件' }],
    tableGroups: relationalTableGroups
  },
  PostgreSQL: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'materializedViews', label: '物化视图' }, { key: 'functions', label: '函数' }, { key: 'sequences', label: '序列' }],
    tableGroups: relationalTableGroups
  },
  SQLite: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'indexes', label: '索引' }, { key: 'triggers', label: '触发器' }],
    tableGroups: relationalTableGroups.filter((group) => group.key !== 'foreignKeys')
  },
  'SQL Server': {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'synonyms', label: '同义词' }],
    tableGroups: relationalTableGroups
  },
  Oracle: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'materializedViews', label: '物化视图' }, { key: 'sequences', label: '序列' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'packages', label: '包' }],
    tableGroups: relationalTableGroups
  },
  TiDB: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }],
    tableGroups: relationalTableGroups
  },
  ClickHouse: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'dictionaries', label: '字典' }, { key: 'functions', label: '函数' }],
    tableGroups: relationalTableGroups.filter((group) => ['columns', 'indexes', 'checks'].includes(group.key))
  },
  MongoDB: {
    itemLabel: '集合',
    groups: [{ key: 'views', label: '视图' }],
    tableGroups: [{ key: 'columns', label: '字段' }, { key: 'indexes', label: '索引' }]
  },
  Redis: {
    itemLabel: '键',
    groups: [],
    tableGroups: []
  },
  DuckDB: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'sequences', label: '序列' }],
    tableGroups: relationalTableGroups.filter((group) => ['columns', 'indexes', 'checks'].includes(group.key))
  },
  Elasticsearch: {
    itemLabel: '索引',
    groups: [{ key: 'aliases', label: '别名' }, { key: 'dataStreams', label: '数据流' }, { key: 'mappings', label: '映射' }],
    tableGroups: [{ key: 'columns', label: '映射字段' }]
  },
  达梦: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'materializedViews', label: '物化视图' }, { key: 'sequences', label: '序列' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'packages', label: '包' }],
    tableGroups: relationalTableGroups
  },
  人大金仓: {
    itemLabel: '数据表',
    groups: [{ key: 'views', label: '视图' }, { key: 'materializedViews', label: '物化视图' }, { key: 'functions', label: '函数' }, { key: 'sequences', label: '序列' }],
    tableGroups: relationalTableGroups
  }
}

function ConnectionSidebar({
  connections,
  loading,
  groupsRefreshRequest,
  onNewConnection,
  onGroupsChanged,
  onEditConnection,
  onToggleConnection,
  onDuplicateConnection,
  onDeleteConnection,
  onRefreshConnection,
  onRunSqlFile,
  onCreateDatabase,
  onEditDatabase,
  onDeleteDatabase,
  onNewQuery,
  onRunDatabaseSqlFile,
  onExportSql,
  onDatabaseOpenStateChange,
  onSelectDatabase,
  onLoadDatabase,
  onCreateTable,
  onOpenTable,
  onDesignTable,
  onRenameTable,
  onDeleteTable,
  onTruncateTable,
  onCopyTable,
  onExportTable,
  onSelectImportTable,
  onSelectExportTable,
  onGenerateSql,
  onMaintainTable,
  onShowTableInfo,
  onObjectAction,
  onSetConnectionColor,
  onExportDataDictionary,
  onShowProcesslist,
  onCreateObject,
  onCopySqlStatement,
  onTruncateDatabase,
  onCopyDatabase
}: ConnectionSidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = Number(localStorage.getItem('omnidb.sidebar.width'))
    return Number.isFinite(savedWidth) && savedWidth >= 220 && savedWidth <= 520 ? savedWidth : 282
  })
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef({ pointerX: 0, width: 282 })
  const connectionClickTimer = useRef<number | null>(null)
  const firstConnection = connections[0]
  const [selectedConnection, setSelectedConnection] = useState(firstConnection?.id ?? 0)
  const [expandedConnections, setExpandedConnections] = useState<number[]>(firstConnection ? [firstConnection.id] : [])
  const [expandedDatabases, setExpandedDatabases] = useState<string[]>([])
  const [loadedEmptyDatabases, setLoadedEmptyDatabases] = useState<string[]>([])
  const [loadingDatabases, setLoadingDatabases] = useState<string[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [expandedTables, setExpandedTables] = useState<string[]>([])
  const [expandedTableGroups, setExpandedTableGroups] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState('')
  const [search, setSearch] = useState('')
  const [connectionGroups, setConnectionGroups] = useState<ConnectionGroup[]>([])
  const [collapsedConnectionGroups, setCollapsedConnectionGroups] = useState<number[]>([])
  const [contextMenu, setContextMenu] = useState<ConnectionContextMenu | null>(null)
  const [databaseContextMenu, setDatabaseContextMenu] = useState<DatabaseContextMenu | null>(null)
  const [tableContextMenu, setTableContextMenu] = useState<TableContextMenu | null>(null)
  const [tableGroupContextMenu, setTableGroupContextMenu] = useState<TableGroupContextMenu | null>(null)
  const [objectContextMenu, setObjectContextMenu] = useState<ObjectContextMenu | null>(null)
  const [objectGroupContextMenu, setObjectGroupContextMenu] = useState<ObjectGroupContextMenu | null>(null)

  useEffect(() => {
    if (!contextMenu && !databaseContextMenu && !tableContextMenu && !tableGroupContextMenu && !objectContextMenu && !objectGroupContextMenu) return
    const closeMenu = (): void => {
      setContextMenu(null)
      setDatabaseContextMenu(null)
      setTableContextMenu(null)
      setTableGroupContextMenu(null)
      setObjectContextMenu(null)
      setObjectGroupContextMenu(null)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu, databaseContextMenu, tableContextMenu, tableGroupContextMenu])

  useEffect(() => () => {
    if (connectionClickTimer.current !== null) window.clearTimeout(connectionClickTimer.current)
  }, [])

  const loadConnectionGroups = (): void => { void window.omnidb.connections.listGroups().then(setConnectionGroups) }
  useEffect(loadConnectionGroups, [])
  useEffect(() => { if (groupsRefreshRequest > 0) loadConnectionGroups() }, [groupsRefreshRequest])

  useEffect(() => {
    if (!firstConnection || selectedConnection !== 0) return
    setSelectedConnection(firstConnection.id)
    setExpandedConnections([firstConnection.id])
  }, [firstConnection, selectedConnection])

  const normalizedSearch = search.trim().toLowerCase()
  const visibleConnections = connections.filter((connection) =>
    [connection.name, connection.engine, ...connection.databases.map((database) => database.name)]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearch)
  )
  const connectionListRows: Array<
    | { kind: 'divider' }
    | { kind: 'group'; group: ConnectionGroup; count: number }
    | { kind: 'connection'; connection: DatabaseConnection; grouped: boolean }
  > = []
  const ungrouped = visibleConnections.filter((connection) => !connection.groupId)
  connectionGroups.forEach((group) => {
    const children = visibleConnections.filter((connection) => connection.groupId === group.id)
    connectionListRows.push({ kind: 'group', group, count: children.length })
    if (!collapsedConnectionGroups.includes(group.id)) children.forEach((connection) => connectionListRows.push({ kind: 'connection', connection, grouped: true }))
  })
  if (connectionGroups.length && ungrouped.length) connectionListRows.push({ kind: 'divider' })
  ungrouped.forEach((connection) => connectionListRows.push({ kind: 'connection', connection, grouped: false }))

  const assignGroup = async (connectionId: number, groupId: number | null): Promise<void> => {
    const result = await window.omnidb.connections.setGroup(connectionId, groupId)
    if (result.success) onGroupsChanged()
    setContextMenu(null)
  }
  const deleteGroup = async (groupId: number): Promise<void> => {
    const result = await window.omnidb.connections.deleteGroup(groupId)
    if (!result.success) return
    loadConnectionGroups(); onGroupsChanged()
  }
  const toggleConnectionGroup = (groupId: number): void => setCollapsedConnectionGroups((current) => current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId])

  const toggleDatabase = (
    databaseKey: string,
    connection?: DatabaseConnection,
    database?: DatabaseItem
  ): void => {
    const opening = !expandedDatabases.includes(databaseKey)
    setExpandedDatabases((current) =>
      current.includes(databaseKey)
        ? current.filter((key) => key !== databaseKey)
        : [...current, databaseKey]
    )
    if (connection && database) onDatabaseOpenStateChange(connection, database, opening)
  }

  const databaseHasMetadata = (database: DatabaseItem): boolean => Boolean(
    database.tables.length
    || database.views.length
    || database.functions.length
    || database.procedures.length
    || database.indexes.length
    || database.triggers.length
    || database.materializedViews?.length
    || database.sequences?.length
    || database.packages?.length
    || database.synonyms?.length
    || database.events?.length
    || database.dictionaries?.length
    || database.aliases?.length
    || database.dataStreams?.length
    || database.mappings?.length
  )

  const handleDatabaseClick = async (
    databaseKey: string,
    connection: DatabaseConnection,
    database: DatabaseItem
  ): Promise<void> => {
    const opening = !expandedDatabases.includes(databaseKey)
    if (!opening) {
      toggleDatabase(databaseKey, connection, database)
      onSelectDatabase(connection, database)
      return
    }

    const needsLoading = !databaseHasMetadata(database) && !loadedEmptyDatabases.includes(databaseKey)
    if (!needsLoading) {
      toggleDatabase(databaseKey, connection, database)
      onSelectDatabase(connection, database)
      return
    }

    setLoadingDatabases((current) => current.includes(databaseKey) ? current : [...current, databaseKey])
    try {
      const loaded = await onLoadDatabase(connection, database)
      if (!loaded) return
      setLoadedEmptyDatabases((current) => current.includes(databaseKey) ? current : [...current, databaseKey])
      toggleDatabase(databaseKey, loaded.connection, loaded.database)
      onSelectDatabase(loaded.connection, loaded.database)
    } finally {
      setLoadingDatabases((current) => current.filter((key) => key !== databaseKey))
    }
  }

  const toggleConnectionFromMenu = async (connection: DatabaseConnection): Promise<void> => {
    setSelectedConnection(connection.id)
    setContextMenu(null)
    const succeeded = await onToggleConnection(connection)
    if (!succeeded) return
    setExpandedConnections((current) => connection.open
      ? current.filter((id) => id !== connection.id)
      : current.includes(connection.id) ? current : [...current, connection.id])
  }

  const openOrToggleConnection = async (connection: DatabaseConnection, forceExpand = false): Promise<void> => {
    setSelectedConnection(connection.id)
    if (connection.open) {
      setExpandedConnections((current) => forceExpand
        ? current.includes(connection.id) ? current : [...current, connection.id]
        : current.includes(connection.id) ? current.filter((id) => id !== connection.id) : [...current, connection.id])
      return
    }
    const succeeded = await onToggleConnection(connection)
    if (succeeded) {
      setExpandedConnections((current) => current.includes(connection.id) ? current : [...current, connection.id])
    }
  }

  const handleConnectionClick = (connection: DatabaseConnection): void => {
    if (connectionClickTimer.current !== null) window.clearTimeout(connectionClickTimer.current)
    connectionClickTimer.current = window.setTimeout(() => {
      void openOrToggleConnection(connection)
      connectionClickTimer.current = null
    }, 180)
  }

  const handleConnectionDoubleClick = async (connection: DatabaseConnection): Promise<void> => {
    if (connectionClickTimer.current !== null) {
      window.clearTimeout(connectionClickTimer.current)
      connectionClickTimer.current = null
    }
    await openOrToggleConnection(connection, true)
  }

  const toggleGroup = (groupKey: string): void => {
    setExpandedGroups((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
    )
  }

  const toggleTable = (tableKey: string): void => {
    setExpandedTables((current) =>
      current.includes(tableKey)
        ? current.filter((key) => key !== tableKey)
        : [...current, tableKey]
    )
  }

  const toggleTableGroup = (groupKey: string): void => {
    setExpandedTableGroups((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
    )
  }

  const clampWidth = (width: number): number => Math.min(520, Math.max(220, width))

  const startResize = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStart.current = { pointerX: event.clientX, width: sidebarWidth }
    setResizing(true)
  }

  const resize = (event: PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    setSidebarWidth(clampWidth(resizeStart.current.width + event.clientX - resizeStart.current.pointerX))
  }

  const finishResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const nextWidth = clampWidth(resizeStart.current.width + event.clientX - resizeStart.current.pointerX)
    setSidebarWidth(nextWidth)
    setResizing(false)
    localStorage.setItem('omnidb.sidebar.width', String(nextWidth))
  }

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const nextWidth = clampWidth(sidebarWidth + (event.key === 'ArrowRight' ? 10 : -10))
    setSidebarWidth(nextWidth)
    localStorage.setItem('omnidb.sidebar.width', String(nextWidth))
  }

  return (
    <aside
      className={`connections-panel${resizing ? ' resizing' : ''}${loading ? ' loading' : ''}`}
      style={{ width: sidebarWidth, flexBasis: sidebarWidth }}
      aria-busy={loading}
    >
      {loading && <span className="sidebar-loading-bar" aria-hidden="true" />}
      <label className="connection-search">
        <MagnifyingGlass />
        <input
          value={search}
          disabled={loading && !connections.length}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索连接或数据库"
        />
      </label>

      <div className={`connection-list${loading && connections.length ? ' refreshing' : ''}`}>
        {loading && !connections.length ? (
          <div className="connection-skeleton" aria-label="正在加载连接列表">
            {[0, 1, 2, 3].map((item) => (
              <div className="connection-skeleton-item" key={item} style={{ animationDelay: `${item * 80}ms` }}>
                <span className="connection-skeleton-caret" />
                <span className="connection-skeleton-icon" />
                <span className="connection-skeleton-copy"><i /><i /></span>
              </div>
            ))}
          </div>
        ) : connectionListRows.map((row) => {
          if (row.kind === 'divider') return <div className="connection-list-divider" key="connection-list-divider" aria-hidden="true" />
          if (row.kind === 'group') {
            const groupId = row.group.id
            const collapsed = collapsedConnectionGroups.includes(groupId)
            return <div className="connection-folder-row" key={`connection-folder-${groupId}`}><button type="button" onClick={() => toggleConnectionGroup(groupId)}>{collapsed ? <CaretRight /> : <CaretDown />}<FolderOpen weight="fill" /><span>{row.group.name}</span><small>{row.count}</small></button><button type="button" className="connection-folder-delete" title={`删除分组 ${row.group.name}`} onClick={() => void deleteGroup(row.group.id)}><Trash /></button></div>
          }
          const connection = row.connection
          const expanded = expandedConnections.includes(connection.id)
          const selected = selectedConnection === connection.id
          const treeConfig = engineTreeConfigs[connection.engine]

          return (
            <div className={`connection-group${row.grouped ? ' grouped' : ' ungrouped'}`} key={connection.id}>
              <button
                type="button"
                className={`connection-item${selected ? ' selected' : ''}`}
                aria-expanded={expanded}
                onClick={(event) => {
                  if (event.detail === 1) handleConnectionClick(connection)
                }}
                onDoubleClick={() => void handleConnectionDoubleClick(connection)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setSelectedConnection(connection.id)
                  setDatabaseContextMenu(null)
                  setTableContextMenu(null)
                  setTableGroupContextMenu(null)
                  setContextMenu({
                    x: Math.min(event.clientX, window.innerWidth - 196),
                    y: Math.min(event.clientY, window.innerHeight - 330),
                    connection
                  })
                }}
              >
                <span className="connection-caret">
                  {expanded ? <CaretDown /> : <CaretRight />}
                </span>
                <span
                  className="database-icon"
                  style={{ '--connection-color': connection.color } as CSSProperties}
                >
                  <HardDrives weight="fill" />
                </span>
                <span className="connection-copy">
                  <strong>
                    {connection.name}
                    {connection.color === '#ef4444' && <span className="connection-env-badge prod">PROD</span>}
                    {connection.color === '#f59e0b' && <span className="connection-env-badge test">TEST</span>}
                    {connection.color === '#10b981' && <span className="connection-env-badge dev">DEV</span>}
                  </strong>
                  <small>{connection.engine} · {connection.databases.length} 个数据库</small>
                </span>
                <span className={`connection-state${connection.connected ? ' online' : ''}`} />
              </button>

              {expanded && (
                <div className={`database-tree engine-${connection.engine.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                  {connection.databases.map((database) => {
                    const databaseKey = `${connection.id}:${database.name}`
                    const databaseExpanded = expandedDatabases.includes(databaseKey)
                    const databaseLoading = loadingDatabases.includes(databaseKey)

                    return (
                      <div className="database-node" key={databaseKey}>
                        <button
                          type="button"
                          className="tree-row tree-root"
                          aria-expanded={databaseExpanded}
                          aria-busy={databaseLoading}
                          disabled={databaseLoading}
                          onClick={() => void handleDatabaseClick(databaseKey, connection, database)}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setSelectedConnection(connection.id)
                            setContextMenu(null)
                            setTableContextMenu(null)
                            setTableGroupContextMenu(null)
                            setDatabaseContextMenu({
                              x: Math.min(event.clientX, window.innerWidth - 196),
                              y: Math.min(event.clientY, window.innerHeight - 300),
                              connection,
                              database,
                              databaseKey
                            })
                          }}
                        >
                          {databaseLoading ? <CircleNotch className="database-load-spinner" /> : databaseExpanded ? <CaretDown /> : <CaretRight />}
                          <Database />
                          <span className="tree-name">{database.name}</span>
                        </button>

                        {databaseExpanded && (
                          <div className="database-objects">
                            {connection.engine === 'PostgreSQL' && (
                              <div className="tree-row tree-schema"><CaretDown /><Code />public</div>
                            )}
                            {(() => {
                              const groupKey = `${databaseKey}:tables`
                              const groupExpanded = expandedGroups.includes(groupKey)
                              return (
                                <div className="object-group">
                                  <button
                                    type="button"
                                    className="tree-row tree-section"
                                    aria-expanded={groupExpanded}
                                    onClick={() => toggleGroup(groupKey)}
                                    onContextMenu={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      setContextMenu(null)
                                      setDatabaseContextMenu(null)
                                      setTableContextMenu(null)
                                      setTableGroupContextMenu({
                                        x: Math.min(event.clientX, window.innerWidth - 196),
                                        y: Math.min(event.clientY, window.innerHeight - 170),
                                        connection,
                                        database,
                                        databaseKey
                                      })
                                    }}
                                  >
                                    {groupExpanded ? <CaretDown /> : <CaretRight />}
                                    <Table /><span className="tree-label">{treeConfig.itemLabel}</span><span>{database.tables.length}</span>
                                  </button>
                                  {groupExpanded && database.tables.map((table) => {
                                    const tableKey = `${databaseKey}:table:${table.name}`
                                    const tableExpanded = expandedTables.includes(tableKey)
                                    return (
                                      <div className="table-node" key={tableKey}>
                                        <button
                                          type="button"
                                          className={`tree-row tree-leaf table-row${selectedTable === tableKey ? ' selected' : ''}`}
                                          aria-expanded={tableExpanded}
                                          onClick={() => {
                                            setSelectedTable(tableKey)
                                            onOpenTable(connection, database, table)
                                          }}
                                          onContextMenu={(event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                            setSelectedTable(tableKey)
                                            setContextMenu(null)
                                            setDatabaseContextMenu(null)
                                            setTableGroupContextMenu(null)
                                            setTableContextMenu({
                                              x: Math.min(event.clientX, window.innerWidth - 196),
                                              y: Math.min(event.clientY, window.innerHeight - 285),
                                              connection,
                                              database,
                                              databaseKey,
                                              table
                                            })
                                          }}
                                        >
                                          <span
                                            className="table-expand-control"
                                            role="button"
                                            tabIndex={0}
                                            aria-label={tableExpanded ? '收起表结构' : '展开表结构'}
                                            onClick={(event) => { event.stopPropagation(); toggleTable(tableKey) }}
                                            onKeyDown={(event) => {
                                              if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault()
                                                event.stopPropagation()
                                                toggleTable(tableKey)
                                              }
                                            }}
                                          >{tableExpanded ? <CaretDown /> : <CaretRight />}</span>
                                          <Rows /><span className="tree-label">{table.name}</span>
                                        </button>
                                        {tableExpanded && (
                                          <div className="table-groups">
                                            {treeConfig.tableGroups.map((tableGroup) => {
                                              const tableGroupKey = `${tableKey}:${tableGroup.key}`
                                              const tableGroupExpanded = expandedTableGroups.includes(tableGroupKey)
                                              const tableObjects = table[tableGroup.key]
                                              return (
                                                <div className="table-object-group" key={tableGroupKey}>
                                                  <button
                                                    type="button"
                                                    className="tree-row table-section"
                                                    aria-expanded={tableGroupExpanded}
                                                    onClick={() => toggleTableGroup(tableGroupKey)}
                                                  >
                                                    {tableGroupExpanded ? <CaretDown /> : <CaretRight />}
                                                    <Code /><span className="tree-label">{tableGroup.label}</span><span>{tableObjects.length}</span>
                                                  </button>
                                                  {tableGroupExpanded && tableObjects.map((objectName) => (
                                                    <div className="tree-row table-object" key={`${tableGroupKey}:${objectName}`}>
                                                      <span className="object-bullet" /><span className="tree-label">{objectName}</span>
                                                    </div>
                                                  ))}
                                                </div>
                                              )
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })()}
                            {treeConfig.groups.map((group) => {
                              const groupKey = `${databaseKey}:${group.key}`
                              const groupExpanded = expandedGroups.includes(groupKey)
                              const objects = database[group.key] ?? []

                              return (
                                <div className="object-group" key={groupKey}>
                                  <button
                                    type="button"
                                    className="tree-row tree-section"
                                    aria-expanded={groupExpanded}
                                    onClick={() => toggleGroup(groupKey)}
                                    onContextMenu={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      setObjectGroupContextMenu({
                                        x: event.clientX,
                                        y: event.clientY,
                                        connection,
                                        database,
                                        databaseKey,
                                        groupKey: group.key,
                                        groupLabel: group.label
                                      })
                                    }}
                                  >
                                    {groupExpanded ? <CaretDown /> : <CaretRight />}
                                    <Code />
                                    <span className="tree-label">{group.label}</span>
                                    <span>{objects.length}</span>
                                  </button>
                                  {groupExpanded && objects.map((objectName) => (
                                    <button
                                      type="button"
                                      className="tree-row tree-leaf"
                                      key={`${groupKey}:${objectName}`}
                                      onContextMenu={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setObjectContextMenu({
                                          x: event.clientX,
                                          y: event.clientY,
                                          connection,
                                          database,
                                          databaseKey,
                                          groupKey: group.key,
                                          groupLabel: group.label,
                                          objectName
                                        })
                                      }}
                                    >
                                      <Rows /><span className="tree-label">{objectName}</span>
                                    </button>
                                  ))}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="调整左侧面板宽度"
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={520}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeWithKeyboard}
      />
      {contextMenu && (
        <div
          className="connection-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => void toggleConnectionFromMenu(contextMenu.connection)}>
            <Power />{contextMenu.connection.open ? '关闭连接' : '打开连接'}
          </button>
          <button type="button" onClick={() => { onEditConnection(contextMenu.connection); setContextMenu(null) }}>
            <PencilSimple />编辑连接
          </button>
          <button type="button" onClick={() => { onNewConnection(); setContextMenu(null) }}>
            <Plus />新建连接
          </button>
          <button type="button" onClick={() => { onDuplicateConnection(contextMenu.connection); setContextMenu(null) }}>
            <Copy />复制连接
          </button>
          <button type="button" className="danger" onClick={() => { onDeleteConnection(contextMenu.connection); setContextMenu(null) }}>
            <Trash />删除连接
          </button>
          <span className="context-menu-divider" />
          <div className="context-submenu-host">
            <button type="button"><FolderOpen /><span className="context-menu-label">移动到分组</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${contextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => void assignGroup(contextMenu.connection.id, null)}>{!contextMenu.connection.groupId ? '✓ ' : ''}未分组</button>
              {connectionGroups.map((group) => <button type="button" key={group.id} onClick={() => void assignGroup(contextMenu.connection.id, group.id)}>{contextMenu.connection.groupId === group.id ? '✓ ' : ''}{group.name}</button>)}
              {!connectionGroups.length && <button type="button" disabled>请先在侧栏新建分组</button>}
            </div>
          </div>
          <button type="button" onClick={() => { onRefreshConnection(contextMenu.connection); setContextMenu(null) }}>
            <ArrowsClockwise />刷新
          </button>
          <div className="context-submenu-host">
            <button type="button"><Wrench /><span className="context-menu-label">环境色彩标识</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${contextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onSetConnectionColor?.(contextMenu.connection, '#ef4444'); setContextMenu(null) }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} /> 生产环境 (PROD)
              </button>
              <button type="button" onClick={() => { onSetConnectionColor?.(contextMenu.connection, '#f59e0b'); setContextMenu(null) }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} /> 测试环境 (TEST)
              </button>
              <button type="button" onClick={() => { onSetConnectionColor?.(contextMenu.connection, '#10b981'); setContextMenu(null) }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} /> 开发环境 (DEV)
              </button>
              <button type="button" onClick={() => { onSetConnectionColor?.(contextMenu.connection, '#6366f1'); setContextMenu(null) }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} /> 经典蓝 (Classic)
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={!contextMenu.connection.open}
            onClick={() => { onShowProcesslist?.(contextMenu.connection); setContextMenu(null) }}
          >
            <Rows />查看活动会话 / 进程
          </button>
          <button
            type="button"
            disabled={!contextMenu.connection.open}
            onClick={() => { onRunSqlFile(contextMenu.connection); setContextMenu(null) }}
          >
            <FileSql />运行 SQL 文件
          </button>
        </div>
      )}
      {databaseContextMenu && (
        <div
          className="connection-context-menu"
          style={{ left: databaseContextMenu.x, top: databaseContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => {
            void handleDatabaseClick(
              databaseContextMenu.databaseKey,
              databaseContextMenu.connection,
              databaseContextMenu.database
            )
            setDatabaseContextMenu(null)
          }}>
            <Power />{expandedDatabases.includes(databaseContextMenu.databaseKey) ? '关闭数据库' : '打开数据库'}
          </button>
          {databaseContextMenu.connection.engine !== 'SQLite' && <>
            <button type="button" onClick={() => { onCreateDatabase(databaseContextMenu.connection); setDatabaseContextMenu(null) }}>
              <Plus />新建数据库
            </button>
            <button type="button" onClick={() => { onEditDatabase(databaseContextMenu.connection, databaseContextMenu.database); setDatabaseContextMenu(null) }}>
              <PencilSimple />编辑数据库
            </button>
            <button type="button" className="danger" onClick={() => { onDeleteDatabase(databaseContextMenu.connection, databaseContextMenu.database); setDatabaseContextMenu(null) }}>
              <Trash />删除数据库
            </button>
            <span className="context-menu-divider" />
          </>}
          <button type="button" onClick={() => { onNewQuery(databaseContextMenu.connection, databaseContextMenu.database); setDatabaseContextMenu(null) }}>
            <Code />新建查询
          </button>
          <button type="button" onClick={() => { onExportDataDictionary?.(databaseContextMenu.connection, databaseContextMenu.database); setDatabaseContextMenu(null) }}>
            <FileCode />生成/导出数据字典 (Markdown)
          </button>
          <button type="button" onClick={() => { onRunDatabaseSqlFile(databaseContextMenu.connection, databaseContextMenu.database); setDatabaseContextMenu(null) }}>
            <FileSql />运行 SQL 文件
          </button>
          <div className="context-submenu-host">
            <button type="button"><Copy /><span className="context-menu-label">复制数据库</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${databaseContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onCopyDatabase?.(databaseContextMenu.connection, databaseContextMenu.database, false); setDatabaseContextMenu(null) }}>
                <Copy />仅复制结构
              </button>
              <button type="button" onClick={() => { onCopyDatabase?.(databaseContextMenu.connection, databaseContextMenu.database, true); setDatabaseContextMenu(null) }}>
                <Copy weight="fill" />复制结构和数据
              </button>
            </div>
          </div>
          <div className="context-submenu-host">
            <button type="button"><DownloadSimple /><span className="context-menu-label">导出 SQL</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${databaseContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onExportSql(databaseContextMenu.connection, databaseContextMenu.database, undefined, false); setDatabaseContextMenu(null) }}>
                <DownloadSimple />仅导出结构
              </button>
              <button type="button" onClick={() => { onExportSql(databaseContextMenu.connection, databaseContextMenu.database, undefined, true); setDatabaseContextMenu(null) }}>
                <DownloadSimple weight="fill" />导出结构和数据
              </button>
            </div>
          </div>
          <span className="context-menu-divider" />
          <button type="button" className="danger" onClick={() => { onTruncateDatabase?.(databaseContextMenu.connection, databaseContextMenu.database); setDatabaseContextMenu(null) }}>
            <Broom />清空全库所有表数据
          </button>
        </div>
      )}
      {tableContextMenu && (
        <div
          className="connection-context-menu"
          style={{ left: tableContextMenu.x, top: tableContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { onOpenTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table); setTableContextMenu(null) }}>
            <FolderOpen />打开表
          </button>
          <button type="button" onClick={() => { onDesignTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table); setTableContextMenu(null) }}>
            <PencilSimple />设计表
          </button>
          <button type="button" onClick={() => { onRenameTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table); setTableContextMenu(null) }}>
            <PencilSimple />编辑表名称
          </button>
          <div className="context-submenu-host">
            <button type="button"><Copy /><span className="context-menu-label">复制表</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${tableContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onCopyTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, false); setTableContextMenu(null) }}>
                <Copy />仅复制结构
              </button>
              <button type="button" onClick={() => { onCopyTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, true); setTableContextMenu(null) }}>
                <Copy weight="fill" />复制结构和数据
              </button>
            </div>
          </div>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(tableContextMenu.table.name); setTableContextMenu(null) }}>
            <Copy />复制表名称
          </button>
          <button type="button" onClick={() => { void onCopySqlStatement?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'select'); setTableContextMenu(null) }}>
            <Copy />复制 SELECT 语句
          </button>
          <button type="button" onClick={() => { void onCopySqlStatement?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'insert'); setTableContextMenu(null) }}>
            <Copy />复制 INSERT 语句
          </button>
          <span className="context-menu-divider" />
          <div className="context-submenu-host">
            <button type="button"><FileCode /><span className="context-menu-label">生成 SQL</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${tableContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onGenerateSql?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'select'); setTableContextMenu(null) }}>
                <Code />生成 SELECT 语句
              </button>
              <button type="button" onClick={() => { onGenerateSql?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'insert'); setTableContextMenu(null) }}>
                <Plus />生成 INSERT 语句
              </button>
              <button type="button" onClick={() => { onGenerateSql?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'update'); setTableContextMenu(null) }}>
                <PencilSimple />生成 UPDATE 语句
              </button>
              <button type="button" onClick={() => { onGenerateSql?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'delete'); setTableContextMenu(null) }}>
                <Trash />生成 DELETE 语句
              </button>
              <span className="context-menu-divider" />
              <button type="button" onClick={() => { onGenerateSql?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'ddl'); setTableContextMenu(null) }}>
                <FileSql />查看建表 DDL
              </button>
            </div>
          </div>
          <div className="context-submenu-host">
            <button type="button"><Wrench /><span className="context-menu-label">表维护工具</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${tableContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onMaintainTable?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'check'); setTableContextMenu(null) }}>
                <Wrench />检查表 (CHECK TABLE)
              </button>
              <button type="button" onClick={() => { onMaintainTable?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'optimize'); setTableContextMenu(null) }}>
                <Broom />优化表 (OPTIMIZE TABLE)
              </button>
              <button type="button" onClick={() => { onMaintainTable?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, 'analyze'); setTableContextMenu(null) }}>
                <ArrowsClockwise />分析表 (ANALYZE TABLE)
              </button>
            </div>
          </div>
          <button type="button" onClick={() => { onShowTableInfo?.(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table); setTableContextMenu(null) }}>
            <Info />查看表属性与信息
          </button>
          <span className="context-menu-divider" />
          <button type="button" className="danger" onClick={() => { onDeleteTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table); setTableContextMenu(null) }}>
            <Trash />删除表
          </button>
          <button type="button" className="danger" onClick={() => { onTruncateTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table); setTableContextMenu(null) }}>
            <Broom />清空表
          </button>
          <span className="context-menu-divider" />
          <div className="context-submenu-host">
            <button type="button"><DownloadSimple /><span className="context-menu-label">导出 SQL</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${tableContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onExportSql(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, false); setTableContextMenu(null) }}>
                <DownloadSimple />仅导出结构
              </button>
              <button type="button" onClick={() => { onExportSql(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, true); setTableContextMenu(null) }}>
                <DownloadSimple weight="fill" />导出结构和数据
              </button>
            </div>
          </div>
          <button type="button" onClick={() => { onExportTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table); setTableContextMenu(null) }}>
            <DownloadSimple />导出 CSV
          </button>
          <div className="context-submenu-host">
            <button type="button"><Copy /><span className="context-menu-label">复制表</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${tableContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onCopyTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, false); setTableContextMenu(null) }}>
                <Copy />复制表结构
              </button>
              <button type="button" onClick={() => { onCopyTable(tableContextMenu.connection, tableContextMenu.database, tableContextMenu.table, true); setTableContextMenu(null) }}>
                <Copy weight="fill" />复制结构和数据
              </button>
            </div>
          </div>
        </div>
      )}
      {tableGroupContextMenu && (
        <div
          className="connection-context-menu"
          style={{ left: tableGroupContextMenu.x, top: tableGroupContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { onCreateTable(tableGroupContextMenu.connection, tableGroupContextMenu.database); setTableGroupContextMenu(null) }}>
            <Plus />新建数据表
          </button>
          <button type="button" onClick={() => { onSelectImportTable(tableGroupContextMenu.connection, tableGroupContextMenu.database); setTableGroupContextMenu(null) }}>
            <UploadSimple />导入 CSV / JSON / Excel
          </button>
          <button type="button" onClick={() => { onSelectExportTable(tableGroupContextMenu.connection, tableGroupContextMenu.database); setTableGroupContextMenu(null) }}>
            <DownloadSimple />导出 CSV
          </button>
        </div>
      )}
      {objectContextMenu && (
        <div
          className="connection-context-menu"
          style={{ left: objectContextMenu.x, top: objectContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { onObjectAction?.(objectContextMenu.connection, objectContextMenu.database, objectContextMenu.groupKey, objectContextMenu.objectName, 'query'); setObjectContextMenu(null) }}>
            <Code />打开/查询该{objectContextMenu.groupLabel.slice(0, 2)}
          </button>
          <button type="button" onClick={() => { onObjectAction?.(objectContextMenu.connection, objectContextMenu.database, objectContextMenu.groupKey, objectContextMenu.objectName, 'ddl'); setObjectContextMenu(null) }}>
            <FileCode />查看定义 DDL
          </button>
          {objectContextMenu.groupKey === 'procedures' && <button type="button" onClick={() => { onObjectAction?.(objectContextMenu.connection, objectContextMenu.database, objectContextMenu.groupKey, objectContextMenu.objectName, 'edit'); setObjectContextMenu(null) }}>
            <PencilSimple />可视化编辑存储过程
          </button>}
          <button type="button" onClick={() => { void navigator.clipboard.writeText(objectContextMenu.objectName); setObjectContextMenu(null) }}>
            <Copy />复制名称
          </button>
          <span className="context-menu-divider" />
          <button type="button" className="danger" onClick={() => { onObjectAction?.(objectContextMenu.connection, objectContextMenu.database, objectContextMenu.groupKey, objectContextMenu.objectName, 'drop'); setObjectContextMenu(null) }}>
            <Trash />删除该{objectContextMenu.groupLabel.slice(0, 2)}
          </button>
        </div>
      )}
      {objectGroupContextMenu && (
        <div
          className="connection-context-menu"
          style={{ left: objectGroupContextMenu.x, top: objectGroupContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { onCreateObject?.(objectGroupContextMenu.connection, objectGroupContextMenu.database, objectGroupContextMenu.groupKey, objectGroupContextMenu.groupLabel); setObjectGroupContextMenu(null) }}>
            <Plus />新建{objectGroupContextMenu.groupLabel.slice(0, 2)}
          </button>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(objectGroupContextMenu.groupLabel); setObjectGroupContextMenu(null) }}>
            <Copy />复制分类名称
          </button>
        </div>
      )}
    </aside>
  )
}

export default ConnectionSidebar
