import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useGlobalCloseMenu } from '../hooks/useGlobalCloseMenu'
import {
  CaretDown, CaretRight, CircleNotch, Database, FolderOpen,
  MagnifyingGlass,
  TerminalWindow, Trash
} from '@phosphor-icons/react'
import type { ConnectionGroup, DatabaseConnection, DatabaseItem } from '@/shared/connections'
import { LS_KEYS } from '../utils/localStorage-keys'
import type { EngineTreeConfig } from '../stores/useSidebarStore'
import DatabaseNode from './DatabaseNode'
import SidebarContextMenu from './SidebarContextMenu'
import { EngineIcon, getEngineBrandColor } from './EngineIcons'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useTerminalTabsStore } from '../stores/tabs/useTerminalTabs'
import { useDatabaseTabsStore } from '../stores/tabs/useDatabaseTabs'
import { useUIStore } from '../stores/useUIStore'
import { useSidebarStore } from '../stores/useSidebarStore'
import { useToast } from '../contexts/ToastContext'

// ── Engine tree configs ────────────────────────────────────

const relationalTableGroups = [
  { key: 'columns' as const, label: '字段' },
  { key: 'indexes' as const, label: '索引' },
  { key: 'foreignKeys' as const, label: '外键' },
  { key: 'checks' as const, label: '检查' },
  { key: 'triggers' as const, label: '触发器' }
]

const engineTreeConfigs: Record<string, EngineTreeConfig> = {
  MySQL: { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'procedures', label: '存储过程' }], tableGroups: relationalTableGroups },
  MariaDB: { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'events', label: '事件' }], tableGroups: relationalTableGroups },
  PostgreSQL: { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'materializedViews', label: '物化视图' }, { key: 'foreignTables', label: '外部表' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'sequences', label: '序列' }, { key: 'types', label: '自定义类型' }, { key: 'domains', label: '域' }, { key: 'extensions', label: '扩展插件' }], tableGroups: [...relationalTableGroups, { key: 'policies' as const, label: '安全策略 (RLS)' }] },
  SQLite: { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'indexes', label: '索引' }, { key: 'triggers', label: '触发器' }], tableGroups: relationalTableGroups.filter((g) => g.key !== 'foreignKeys') },
  'SQL Server': { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'synonyms', label: '同义词' }], tableGroups: relationalTableGroups },
  Oracle: { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'materializedViews', label: '物化视图' }, { key: 'sequences', label: '序列' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'packages', label: '包' }], tableGroups: relationalTableGroups },
  TiDB: { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }], tableGroups: relationalTableGroups },
  ClickHouse: { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'dictionaries', label: '字典' }, { key: 'functions', label: '函数' }], tableGroups: relationalTableGroups.filter((g) => ['columns', 'indexes', 'checks'].includes(g.key)) },
  MongoDB: { itemLabel: '集合', groups: [{ key: 'views', label: '视图' }], tableGroups: [{ key: 'columns', label: '字段' }, { key: 'indexes', label: '索引' }] },
  Redis: { itemLabel: '键', groups: [], tableGroups: [] },
  DuckDB: { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'sequences', label: '序列' }], tableGroups: relationalTableGroups.filter((g) => ['columns', 'indexes', 'checks'].includes(g.key)) },
  Elasticsearch: { itemLabel: '索引', groups: [{ key: 'aliases', label: '别名' }, { key: 'dataStreams', label: '数据流' }, { key: 'mappings', label: '映射' }], tableGroups: [{ key: 'columns', label: '映射字段' }] },
  '达梦': { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'materializedViews', label: '物化视图' }, { key: 'sequences', label: '序列' }, { key: 'procedures', label: '存储过程' }, { key: 'functions', label: '函数' }, { key: 'packages', label: '包' }], tableGroups: relationalTableGroups },
  '人大金仓': { itemLabel: '数据表', groups: [{ key: 'views', label: '视图' }, { key: 'materializedViews', label: '物化视图' }, { key: 'functions', label: '函数' }, { key: 'sequences', label: '序列' }], tableGroups: relationalTableGroups },
  SSH: { itemLabel: '终端服务', groups: [], tableGroups: [] }
}

// ── Component ──────────────────────────────────────────────

export default function ConnectionSidebar() {
  // ── Stores ───────────────────────────────────────────────
  const connections = useConnectionStore((s) => s.connections)
  const connectionLatencies = useConnectionStore((s) => s.connectionLatencies)
  const connectionsLoading = useConnectionStore((s) => s.connectionsLoading)
  const groupsRefreshRequest = useConnectionStore((s) => s.groupsRefreshRequest)
  const connActions = useConnectionStore((s) => s.actions)

  const openSshTerminal = useTerminalTabsStore((s) => s.openSshTerminal)
  const openDatabaseOverview = useDatabaseTabsStore((s) => s.openDatabaseOverview)

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  // ── Sidebar store ────────────────────────────────────────
  const expandedConnections = useSidebarStore((s) => s.expandedConnections)
  const expandedDatabases = useSidebarStore((s) => s.expandedDatabases)
  const togglingConnections = useSidebarStore((s) => s.togglingConnections)
  const search = useSidebarStore((s) => s.search)
  const contextMenu = useSidebarStore((s) => s.contextMenu)
  const sidebarActions = useSidebarStore((s) => s.actions)
  const { showToast } = useToast()

  // ── Local state ──────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(LS_KEYS.SIDEBAR_WIDTH))
    return Number.isFinite(saved) && saved >= 220 && saved <= 520 ? saved : 282
  })
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef({ pointerX: 0, width: 282 })
  const connectionClickTimer = useRef<number | null>(null)

  const [selectedConnection, setSelectedConnection] = useState(0)
  const [connectionGroups, setConnectionGroups] = useState<ConnectionGroup[]>([])
  const [collapsedConnectionGroups, setCollapsedConnectionGroups] = useState<Set<number>>(new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<'database' | 'ssh'>>(new Set())

  const toggleSection = (category: 'database' | 'ssh'): void => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      next.has(category) ? next.delete(category) : next.add(category)
      return next
    })
  }

  // ── Group management ─────────────────────────────────────
  const loadConnectionGroups = useCallback((): void => {
    void window.omnidb.connections.listGroups().then(setConnectionGroups)
  }, [])
  useEffect(loadConnectionGroups, [loadConnectionGroups])
  useEffect(() => {
    if (groupsRefreshRequest > 0) loadConnectionGroups()
  }, [groupsRefreshRequest, loadConnectionGroups])

  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null)
  const [dragOverTargetId, setDragOverTargetId] = useState<number | null>(null)

  const handleReorderConnections = useCallback(
    async (sourceId: number, targetId: number): Promise<void> => {
      const currentList = [...connections]
      const sourceIndex = currentList.findIndex((c) => c.id === sourceId)
      const targetIndex = currentList.findIndex((c) => c.id === targetId)
      if (sourceIndex === -1 || targetIndex === -1) return

      const [moved] = currentList.splice(sourceIndex, 1)
      currentList.splice(targetIndex, 0, moved)

      const orders = currentList.map((c, idx) => ({ id: c.id, sortOrder: idx + 1 }))
      await connActions.updateSortOrders(orders)
    },
    [connections, connActions]
  )

  const assignGroup = useCallback(
    async (connectionId: number, groupId: number | null): Promise<void> => {
      const result = await window.omnidb.connections.setGroup(connectionId, groupId)
      if (result.success) {
        loadConnectionGroups()
        void connActions.loadConnections()
      }
      sidebarActions.setContextMenu(null)
    },
    [loadConnectionGroups, connActions, sidebarActions]
  )

  const deleteGroup = useCallback(
    async (groupId: number): Promise<void> => {
      const result = await window.omnidb.connections.deleteGroup(groupId)
      if (!result.success) return
      loadConnectionGroups()
      void connActions.loadConnections()
    },
    [loadConnectionGroups, connActions]
  )

  const toggleConnectionGroup = (groupId: number): void =>
    setCollapsedConnectionGroups((c) => {
      const next = new Set(c)
      next.has(groupId) ? next.delete(groupId) : next.add(groupId)
      return next
    })

  useEffect(
    () => () => {
      if (connectionClickTimer.current !== null) window.clearTimeout(connectionClickTimer.current)
    },
    []
  )

  const firstConnection = connections[0]
  useEffect(() => {
    if (!firstConnection || selectedConnection !== 0) return
    setSelectedConnection(firstConnection.id)
  }, [firstConnection, selectedConnection])

  // ── Connection toggle ────────────────────────────────────
  const openOrToggleConnection = async (
    connection: DatabaseConnection,
    forceExpand = false
  ): Promise<void> => {
    setSelectedConnection(connection.id)
    if (connection.open && !forceExpand) {
      sidebarActions.setExpandedConnections((c) => {
        const next = new Set(c)
        next.has(connection.id) ? next.delete(connection.id) : next.add(connection.id)
        return next
      })
      return
    }
    sidebarActions.setTogglingConnections((c) => (c.has(connection.id) ? c : new Set(c).add(connection.id)))
    try {
      const result = await connActions.toggleConnection(connection)
      console.warn('[ConnectionSidebar] openOrToggleConnection result', result)
      if (result.success)
        sidebarActions.setExpandedConnections((c) =>
          c.has(connection.id) ? c : new Set(c).add(connection.id)
        )
      else
        showToast('error', result.message || '连接失败')
    } catch (err) {
      console.error('[ConnectionSidebar] openOrToggleConnection unexpected error', err)
      showToast('error', '连接异常，请查看控制台日志')
    } finally {
      sidebarActions.setTogglingConnections((c) => {
        const next = new Set(c)
        next.delete(connection.id)
        return next
      })
    }
  }

  const toggleConnectionFromMenu = async (connection: DatabaseConnection): Promise<void> => {
    setSelectedConnection(connection.id)
    sidebarActions.setContextMenu(null)
    sidebarActions.setTogglingConnections((c) => (c.has(connection.id) ? c : new Set(c).add(connection.id)))
    try {
      const result = await connActions.toggleConnection(connection)
      if (!result.success) {
        showToast('error', result.message || '连接失败')
        return
      }
      sidebarActions.setExpandedConnections((c) => {
        const next = new Set(c)
        connection.open ? next.delete(connection.id) : next.add(connection.id)
        return next
      })
    } finally {
      sidebarActions.setTogglingConnections((c) => {
        const next = new Set(c)
        next.delete(connection.id)
        return next
      })
    }
  }

  // ── Click handling ───────────────────────────────────────
  const handleConnectionClick = (connection: DatabaseConnection): void => {
    if (connectionClickTimer.current !== null) window.clearTimeout(connectionClickTimer.current)
    connectionClickTimer.current = window.setTimeout(() => {
      if (connection.engine === 'SSH') openSshTerminal(connection)
      else void openOrToggleConnection(connection)
      connectionClickTimer.current = null
    }, 180)
  }

  const handleConnectionDoubleClick = async (
    connection: DatabaseConnection
  ): Promise<void> => {
    if (connectionClickTimer.current !== null) {
      window.clearTimeout(connectionClickTimer.current)
      connectionClickTimer.current = null
    }
    if (connection.engine === 'SSH') openSshTerminal(connection)
    else await openOrToggleConnection(connection, true)
  }

  useGlobalCloseMenu(Boolean(contextMenu), () => sidebarActions.setContextMenu(null))

  // ── Derived ──────────────────────────────────────────────
  const normalizedSearch = search.trim().toLowerCase()
  const visibleConnections = connections.filter((c) =>
    [c.name, c.engine, ...c.databases.map((d) => d.name)]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearch)
  )
  const dbConnections = visibleConnections.filter((c) => c.engine !== 'SSH')
  const sshConnections = visibleConnections.filter((c) => c.engine === 'SSH')

  const connectionListRows: Array<
    | { kind: 'section-header'; title: string; count: number; category: 'database' | 'ssh'; collapsed: boolean }
    | { kind: 'divider' }
    | { kind: 'group'; group: ConnectionGroup; count: number }
    | { kind: 'connection'; connection: DatabaseConnection; grouped: boolean }
  > = []
  if (dbConnections.length > 0 || sshConnections.length === 0) {
    const collapsed = collapsedSections.has('database')
    connectionListRows.push({
      kind: 'section-header',
      title: '数据库连接',
      count: dbConnections.length,
      category: 'database',
      collapsed
    })
    if (!collapsed) {
      connectionGroups.forEach((group) => {
        const ch = dbConnections.filter((c) => c.groupId === group.id)
        if (ch.length) {
          connectionListRows.push({ kind: 'group', group, count: ch.length })
          if (!collapsedConnectionGroups.has(group.id))
            ch.forEach((c) => connectionListRows.push({ kind: 'connection', connection: c, grouped: true }))
        }
      })
      dbConnections
        .filter((c) => !c.groupId)
        .forEach((c) => connectionListRows.push({ kind: 'connection', connection: c, grouped: false }))
    }
  }
  if (sshConnections.length > 0) {
    if (dbConnections.length > 0) connectionListRows.push({ kind: 'divider' })
    const collapsed = collapsedSections.has('ssh')
    connectionListRows.push({
      kind: 'section-header',
      title: 'SSH 客户端',
      count: sshConnections.length,
      category: 'ssh',
      collapsed
    })
    if (!collapsed) {
      connectionGroups.forEach((group) => {
        const ch = sshConnections.filter((c) => c.groupId === group.id)
        if (ch.length) {
          connectionListRows.push({ kind: 'group', group, count: ch.length })
          if (!collapsedConnectionGroups.has(group.id))
            ch.forEach((c) => connectionListRows.push({ kind: 'connection', connection: c, grouped: true }))
        }
      })
      sshConnections
        .filter((c) => !c.groupId)
        .forEach((c) => connectionListRows.push({ kind: 'connection', connection: c, grouped: false }))
    }
  }

  // ── Resize ───────────────────────────────────────────────
  const clampWidth = (w: number): number => Math.min(520, Math.max(220, w))
  const startResize = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeStart.current = { pointerX: e.clientX, width: sidebarWidth }
    setResizing(true)
  }
  const resize = (e: PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    setSidebarWidth(clampWidth(resizeStart.current.width + e.clientX - resizeStart.current.pointerX))
  }
  const finishResize = (e: PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const w = clampWidth(resizeStart.current.width + e.clientX - resizeStart.current.pointerX)
    setSidebarWidth(w)
    setResizing(false)
    localStorage.setItem(LS_KEYS.SIDEBAR_WIDTH, String(w))
  }
  const resizeWithKeyboard = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const w = clampWidth(sidebarWidth + (e.key === 'ArrowRight' ? 10 : -10))
    setSidebarWidth(w)
    localStorage.setItem(LS_KEYS.SIDEBAR_WIDTH, String(w))
  }

  // ── Database click handler ───────────────────────────────
  const handleDatabaseClick = useCallback(
    async (
      databaseKey: string,
      connection: DatabaseConnection,
      database: DatabaseItem
    ): Promise<void> => {
      const opening = !expandedDatabases.has(databaseKey)
      if (!opening) {
        sidebarActions.setExpandedDatabases((c) => {
          const next = new Set(c)
          next.delete(databaseKey)
          return next
        })
        openDatabaseOverview(connection, database)
        return
      }
      const needsLoading = !database.tables.length && !useSidebarStore.getState().loadedEmptyDatabases.has(databaseKey)
      if (!needsLoading) {
        sidebarActions.setExpandedDatabases((c) => new Set(c).add(databaseKey))
        openDatabaseOverview(connection, database)
        return
      }
      sidebarActions.setLoadingDatabases((c) => (c.has(databaseKey) ? c : new Set(c).add(databaseKey)))
      try {
        const loaded = await sidebarActions.loadDatabaseDetail(connection, database)
        if (!loaded) return
        sidebarActions.setLoadedEmptyDatabases((c) =>
          c.has(databaseKey) ? c : new Set(c).add(databaseKey)
        )
        sidebarActions.setExpandedDatabases((c) => new Set(c).add(databaseKey))
        openDatabaseOverview(loaded.connection, loaded.database)
      } finally {
        sidebarActions.setLoadingDatabases((c) => {
          const next = new Set(c)
          next.delete(databaseKey)
          return next
        })
      }
    },
    [
      expandedDatabases,
      openDatabaseOverview,
      sidebarActions
    ]
  )

  // ── Render ───────────────────────────────────────────────
  return (
    <aside
      className={`connections-panel${resizing ? ' resizing' : ''}${connectionsLoading ? ' loading' : ''}${sidebarCollapsed ? ' collapsed' : ''}`}
      style={{ width: sidebarWidth, flexBasis: sidebarWidth }}
      aria-busy={connectionsLoading}
      aria-hidden={sidebarCollapsed}
    >
      {connectionsLoading && <span className="sidebar-loading-bar" aria-hidden="true" />}
      <label className="connection-search">
        <MagnifyingGlass />
        <input
          value={search}
          disabled={connectionsLoading && !connections.length}
          onChange={(e) => sidebarActions.setSearch(e.target.value)}
          placeholder="搜索连接或数据库"
        />
      </label>
      <div
        className={`connection-list${connectionsLoading && connections.length ? ' refreshing' : ''}`}
      >
        {connectionsLoading && !connections.length ? (
          <div className="connection-skeleton" aria-label="正在加载连接列表">
            {[0, 1, 2, 3].map((i) => (
              <div
                className="connection-skeleton-item"
                key={i}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="connection-skeleton-caret" />
                <span className="connection-skeleton-icon" />
                <span className="connection-skeleton-copy">
                  <i />
                  <i />
                </span>
              </div>
            ))}
          </div>
        ) : (
          connectionListRows.map((row) => {
            if (row.kind === 'section-header') {
              return (
                <button
                  type="button"
                  className={`connection-section-header ${row.category}${row.collapsed ? ' collapsed' : ''}`}
                  key={`section-${row.category}`}
                  onClick={() => toggleSection(row.category)}
                >
                  <span className="section-caret">
                    {row.collapsed ? <CaretRight /> : <CaretDown />}
                  </span>
                  <span className="section-header-icon">
                    {row.category === 'database' ? (
                      <Database weight="fill" />
                    ) : (
                      <TerminalWindow weight="fill" />
                    )}
                  </span>
                  <span>{row.title}</span>
                  <small>{row.count}</small>
                </button>
              )
            }
            if (row.kind === 'divider')
              return (
                <div
                  className="connection-list-divider"
                  key={`divider-${Math.random()}`}
                  aria-hidden="true"
                />
              )
            if (row.kind === 'group') {
              const gid = row.group.id
              const col = collapsedConnectionGroups.has(gid)
              const isDragOver = dragOverGroupId === gid
              return (
                <div
                  className={`connection-folder-row${isDragOver ? ' drag-over' : ''}`}
                  key={`folder-${gid}`}
                  style={isDragOver ? { background: '#e0e7ff', outline: '2px dashed #6366f1', borderRadius: 4 } : undefined}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOverGroupId(gid)
                  }}
                  onDragLeave={() => setDragOverGroupId(null)}
                  onDrop={async (e) => {
                    e.preventDefault()
                    const cid = Number(e.dataTransfer.getData('text/plain'))
                    if (cid) {
                      await assignGroup(cid, gid)
                      setDragOverGroupId(null)
                    }
                  }}
                >
                  <button type="button" onClick={() => toggleConnectionGroup(gid)}>
                    {col ? <CaretRight /> : <CaretDown />}
                    <FolderOpen weight="fill" />
                    <span>{row.group.name}</span>
                    <small>{row.count}</small>
                  </button>
                  <button
                    type="button"
                    className="connection-folder-delete"
                    title={`删除分组 ${row.group.name}`}
                    onClick={() => void deleteGroup(row.group.id)}
                  >
                    <Trash />
                  </button>
                </div>
              )
            }
            const connection = row.connection
            const isSsh = connection.engine === 'SSH'
            const expanded = !isSsh && expandedConnections.has(connection.id)
            const selected = selectedConnection === connection.id
            const isToggling = togglingConnections.has(connection.id)
            const isTargetDragOver = dragOverTargetId === connection.id
            const latency = connectionLatencies[connection.id]
            const treeConfig = engineTreeConfigs[connection.engine]
            const brandColor = getEngineBrandColor(connection.engine, connection.color)
            return (
              <div
                className={`connection-group${row.grouped ? ' grouped' : ' ungrouped'}${isSsh ? ' ssh' : ''}`}
                key={connection.id}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', String(connection.id))
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOverTargetId(connection.id)
                  }}
                  onDragLeave={() => setDragOverTargetId(null)}
                  onDrop={async (e) => {
                    e.preventDefault()
                    const sourceId = Number(e.dataTransfer.getData('text/plain'))
                    if (sourceId && sourceId !== connection.id) {
                      await handleReorderConnections(sourceId, connection.id)
                    }
                    setDragOverTargetId(null)
                  }}
                  className={`connection-item${selected ? ' selected' : ''}${isSsh ? ' ssh' : ''}${isTargetDragOver ? ' drag-over' : ''}`}
                  style={isTargetDragOver ? { borderTop: '2px solid #6366f1', background: '#f1f5f9' } : undefined}
                  aria-expanded={expanded}
                  disabled={isToggling}
                  onClick={(e) => {
                    if (e.detail === 1) handleConnectionClick(connection)
                  }}
                  onDoubleClick={() => void handleConnectionDoubleClick(connection)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setSelectedConnection(connection.id)
                    sidebarActions.setContextMenu({
                      kind: 'connection',
                      x: Math.min(e.clientX, window.innerWidth - 196),
                      y: Math.min(e.clientY, window.innerHeight - 330),
                      connection
                    })
                  }}
                >
                  <span className={`connection-caret${isSsh ? ' disabled' : ''}`}>
                    {!isSsh &&
                      (isToggling ? (
                        <CircleNotch className="database-load-spinner" />
                      ) : expanded ? (
                        <CaretDown />
                      ) : (
                        <CaretRight />
                      ))}
                  </span>
                  <span
                    className={`database-icon${isSsh ? ' ssh' : ''}`}
                    style={{ '--connection-color': brandColor } as CSSProperties}
                  >
                    <EngineIcon engine={connection.engine} />
                  </span>
                  <span className="connection-copy">
                    <strong>
                      {connection.name}
                      {connection.environment === 'production' && (
                        <span className="connection-env-badge prod">PROD</span>
                      )}
                      {connection.environment === 'staging' && (
                        <span className="connection-env-badge test">TEST</span>
                      )}
                      {connection.environment === 'development' && (
                        <span className="connection-env-badge dev">DEV</span>
                      )}
                      {connection.open && latency !== undefined && (
                        <span
                          className={`connection-latency-tag ${latency <= 200 ? 'fast' : latency <= 800 ? 'medium' : 'slow'}`}
                          title={`连接建立与加载耗时 ${latency} ms`}
                        >
                          {latency}ms
                        </span>
                      )}
                    </strong>
                    <small>
                      {isSsh
                        ? `SSH · ${connection.username || 'root'}@${connection.host}:${connection.port || 22}`
                        : `${connection.engine} · ${connection.databases.length} 个数据库`}
                    </small>
                  </span>
                  <span
                    className={`connection-state${connection.connected ? ' online' : ''}`}
                  />
                </button>
                {expanded && !isSsh && treeConfig && (
                  <div
                    className={`database-tree engine-${connection.engine.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  >
                    {connection.databases.map((db) => (
                      <DatabaseNode
                        key={`${connection.id}:${db.name}`}
                        connection={connection}
                        database={db}
                        databaseKey={`${connection.id}:${db.name}`}
                        treeConfig={treeConfig}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
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
      <SidebarContextMenu
        connectionGroups={connectionGroups}
        expandedDatabases={expandedDatabases}
        onToggleConnectionFromMenu={toggleConnectionFromMenu}
        onDatabaseClick={handleDatabaseClick}
        onAssignGroup={assignGroup}
      />
    </aside>
  )
}
