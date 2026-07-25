import { CaretDown, CaretRight, CircleNotch, Database } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem } from '@/shared/connections'
import { useSidebarStore } from '../stores/useSidebarStore'
import { useDatabaseTabsStore } from '../stores/tabs/useDatabaseTabs'
import type { EngineTreeConfig } from '../stores/useSidebarStore'
import TableNode from './TableNode'
import SchemaNode from './SchemaNode'
import { getObjectGroupIcon, getTableIcon } from './SidebarIcons'

interface DatabaseNodeProps {
  connection: DatabaseConnection
  database: DatabaseItem
  databaseKey: string
  treeConfig: EngineTreeConfig
}

export default function DatabaseNode({ connection, database, databaseKey, treeConfig }: DatabaseNodeProps) {
  const expandedDatabases = useSidebarStore((s) => s.expandedDatabases)
  const loadingDatabases = useSidebarStore((s) => s.loadingDatabases)
  const loadedEmptyDatabases = useSidebarStore((s) => s.loadedEmptyDatabases)
  const expandedGroups = useSidebarStore((s) => s.expandedGroups)
  const sidebarActions = useSidebarStore((s) => s.actions)
  const openDatabaseOverview = useDatabaseTabsStore((s) => s.openDatabaseOverview)

  const databaseExpanded = expandedDatabases.has(databaseKey)
  const databaseLoading = loadingDatabases.has(databaseKey)

  const databaseHasMetadata = (): boolean => {
    if (database.schemas && database.schemas.length > 0) {
      return database.schemas.some((s) => s.tables.some((t) => t.columns && t.columns.length > 0))
    }
    if (database.tables && database.tables.length > 0) {
      return database.tables.some((t) => t.columns && t.columns.length > 0)
    }
    return false
  }

  const handleDatabaseClick = async (): Promise<void> => {
    const opening = !expandedDatabases.has(databaseKey)
    if (!opening) {
      toggleDatabase()
      openDatabaseOverview(connection, database)
      return
    }

    const needsLoading = !databaseHasMetadata() && !loadedEmptyDatabases.has(databaseKey)
    if (!needsLoading) {
      toggleDatabase()
      openDatabaseOverview(connection, database)
      return
    }

    sidebarActions.setLoadingDatabases((current) => current.has(databaseKey) ? current : new Set(current).add(databaseKey))
    try {
      const loaded = await sidebarActions.loadDatabaseDetail(connection, database)
      if (!loaded) return
      sidebarActions.setLoadedEmptyDatabases((current) => current.has(databaseKey) ? current : new Set(current).add(databaseKey))
      toggleDatabase()
      openDatabaseOverview(loaded.connection, loaded.database)
    } finally {
      sidebarActions.setLoadingDatabases((current) => { const next = new Set(current); next.delete(databaseKey); return next })
    }
  }

  const toggleDatabase = (): void => {
    sidebarActions.setExpandedDatabases((current) => {
      const next = new Set(current); next.has(databaseKey) ? next.delete(databaseKey) : next.add(databaseKey); return next
    })
  }

  const toggleGroup = (groupKey: string): void => {
    sidebarActions.setExpandedGroups((current) => {
      const next = new Set(current); next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey); return next
    })
  }

  const openDatabaseContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    sidebarActions.setContextMenu({
      kind: 'database',
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 300),
      connection, database, databaseKey
    })
  }

  const openTableGroupContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    sidebarActions.setContextMenu({
      kind: 'tableGroup',
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 170),
      connection, database, databaseKey
    })
  }

  const openObjectGroupContextMenu = (event: React.MouseEvent, groupKey: string, groupLabel: string): void => {
    event.preventDefault()
    event.stopPropagation()
    sidebarActions.setContextMenu({
      kind: 'objectGroup',
      x: event.clientX,
      y: event.clientY,
      connection, database, databaseKey,
      groupKey, groupLabel
    })
  }

  const openObjectContextMenu = (event: React.MouseEvent, groupKey: string, groupLabel: string, objectName: string): void => {
    event.preventDefault()
    event.stopPropagation()
    sidebarActions.setContextMenu({
      kind: 'object',
      x: event.clientX,
      y: event.clientY,
      connection, database, databaseKey,
      groupKey, groupLabel, objectName
    })
  }

  return (
    <div className="database-node">
      <button
        type="button"
        className="tree-row tree-root"
        aria-expanded={databaseExpanded}
        aria-busy={databaseLoading}
        disabled={databaseLoading}
        onClick={() => void handleDatabaseClick()}
        onContextMenu={openDatabaseContextMenu}
      >
        {databaseLoading ? <CircleNotch className="database-load-spinner" /> : databaseExpanded ? <CaretDown /> : <CaretRight />}
        <Database />
        <span className="tree-name">{database.name}</span>
      </button>

      {databaseExpanded && (
        <div className="database-objects">
          {database.schemas && database.schemas.length > 0 ? (
            database.schemas.map((schema) => (
              <SchemaNode
                key={`${databaseKey}:schema:${schema.name}`}
                connection={connection}
                database={database}
                databaseKey={databaseKey}
                schema={schema}
                treeConfig={treeConfig}
              />
            ))
          ) : (
            <>
              {/* Tables group */}
              {(() => {
                const groupKey = `${databaseKey}:tables`
                const groupExpanded = expandedGroups.has(groupKey)
                return (
                  <div className="object-group">
                    <button
                      type="button"
                      className="tree-row tree-section"
                      aria-expanded={groupExpanded}
                      onClick={() => toggleGroup(groupKey)}
                      onContextMenu={openTableGroupContextMenu}
                    >
                      {groupExpanded ? <CaretDown /> : <CaretRight />}
                      {getTableIcon()}<span className="tree-label">{treeConfig.itemLabel}</span><span>{database.tables.length}</span>
                    </button>
                    {groupExpanded && database.tables.map((table) => (
                      <TableNode
                        key={`${databaseKey}:table:${table.name}`}
                        connection={connection}
                        database={database}
                        databaseKey={databaseKey}
                        table={table}
                        tableGroups={treeConfig.tableGroups}
                      />
                    ))}
                  </div>
                )
              })()}

              {/* Object groups (views, procedures, functions, etc.) */}
              {treeConfig.groups.map((group) => {
                const groupKey = `${databaseKey}:${group.key}`
                const groupExpanded = expandedGroups.has(groupKey)
                const objects = database[group.key] ?? []

                return (
                  <div className="object-group" key={groupKey}>
                    <button
                      type="button"
                      className="tree-row tree-section"
                      aria-expanded={groupExpanded}
                      onClick={() => toggleGroup(groupKey)}
                      onContextMenu={(event) => openObjectGroupContextMenu(event, group.key, group.label)}
                    >
                      {groupExpanded ? <CaretDown /> : <CaretRight />}
                      {getObjectGroupIcon(group.key)}
                      <span className="tree-label">{group.label}</span>
                      <span>{objects.length}</span>
                    </button>
                    {groupExpanded && objects.map((objectName) => (
                      <button
                        type="button"
                        className="tree-row tree-leaf"
                        key={`${groupKey}:${objectName}`}
                        onContextMenu={(event) => openObjectContextMenu(event, group.key, group.label, objectName)}
                      >
                        {getObjectGroupIcon(group.key)}<span className="tree-label">{objectName}</span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
