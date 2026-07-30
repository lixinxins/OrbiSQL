import React, { useRef } from 'react'
import { CaretDown, CaretRight, FolderOpen } from '@phosphor-icons/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DatabaseConnection, DatabaseItem, SchemaItem } from '@/shared/connections'
import { useSidebarStore } from '../stores/useSidebarStore'
import type { EngineTreeConfig, ObjectGroupKey } from '../stores/useSidebarStore'
import TableNode from './TableNode'
import { getObjectGroupIcon, getTableIcon } from './SidebarIcons'

interface SchemaNodeProps {
  connection: DatabaseConnection
  database: DatabaseItem
  databaseKey: string
  schema: SchemaItem
  treeConfig: EngineTreeConfig
}

const SchemaNode = React.memo(function SchemaNode({ connection, database, databaseKey, schema, treeConfig }: SchemaNodeProps) {
  const expandedGroups = useSidebarStore((s) => s.expandedGroups)
  const sidebarActions = useSidebarStore((s) => s.actions)

  const schemaKey = `${databaseKey}:schema:${schema.name}`
  const schemaExpanded = expandedGroups.has(schemaKey)
  const isSchemaSelected = useSidebarStore((s) => s.selectedTable === schemaKey)

  // ── Virtualized table list ─────────────────────────────
  const tables = schema.tables
  const tablesParentRef = useRef<HTMLDivElement>(null)
  const tableVirtualizer = useVirtualizer({
    count: tables.length,
    getScrollElement: () => tablesParentRef.current,
    getItemKey: (index) => tables[index]?.name ?? index,
    estimateSize: () => 32,
    overscan: 10,
  })

  const toggleSchema = (): void => {
    sidebarActions.setExpandedGroups((current) => {
      const next = new Set(current)
      next.has(schemaKey) ? next.delete(schemaKey) : next.add(schemaKey)
      return next
    })
  }

  const toggleGroup = (groupKey: string): void => {
    sidebarActions.setExpandedGroups((current) => {
      const next = new Set(current)
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey)
      return next
    })
  }

  const openTableGroupContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    sidebarActions.setContextMenu({
      kind: 'tableGroup',
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 170),
      connection,
      database,
      databaseKey,
      schemaName: schema.name
    })
  }

  const openObjectGroupContextMenu = (event: React.MouseEvent, groupKey: string, groupLabel: string): void => {
    event.preventDefault()
    event.stopPropagation()
    sidebarActions.setContextMenu({
      kind: 'objectGroup',
      x: event.clientX,
      y: event.clientY,
      connection,
      database,
      databaseKey,
      groupKey,
      groupLabel,
      schemaName: schema.name
    })
  }

  const openObjectContextMenu = (event: React.MouseEvent, groupKey: string, groupLabel: string, objectName: string): void => {
    event.preventDefault()
    event.stopPropagation()
    sidebarActions.setContextMenu({
      kind: 'object',
      x: event.clientX,
      y: event.clientY,
      connection,
      database,
      databaseKey,
      groupKey,
      groupLabel,
      objectName,
      schemaName: schema.name
    })
  }

  const tableGroupKey = `${schemaKey}:tables`
  const tableGroupExpanded = expandedGroups.has(tableGroupKey)

  return (
    <div className="schema-node">
      <button
        type="button"
        className={`tree-row tree-schema${isSchemaSelected ? ' selected' : ''}`}
        aria-expanded={schemaExpanded}
        onClick={() => { sidebarActions.setSelectedTable(schemaKey); toggleSchema() }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          sidebarActions.setSelectedTable(schemaKey)
          sidebarActions.setContextMenu({
            kind: 'schema',
            x: Math.min(e.clientX, window.innerWidth - 196),
            y: Math.min(e.clientY, window.innerHeight - 170),
            connection,
            database,
            databaseKey,
            schema
          })
        }}
      >
        {schemaExpanded ? <CaretDown /> : <CaretRight />}
        <FolderOpen weight="fill" className="schema-icon" />
        <span className="tree-name">{schema.name}</span>
        <span className="tree-badge">{schema.tables.length}</span>
      </button>

      {schemaExpanded && (
        <div className="schema-objects">
          {/* Tables group (virtualized) */}
          <div className="object-group">
            <button
              type="button"
              className="tree-row tree-section"
              aria-expanded={tableGroupExpanded}
              onClick={() => toggleGroup(tableGroupKey)}
              onContextMenu={openTableGroupContextMenu}
            >
              {tableGroupExpanded ? <CaretDown /> : <CaretRight />}
              {getTableIcon()}
              <span className="tree-label">{treeConfig.itemLabel}</span>
              <span>{tables.length}</span>
            </button>
            {tableGroupExpanded && (
              <div ref={tablesParentRef} style={{ overflow: 'auto', maxHeight: '400px' }}>
                <div style={{ height: `${tableVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                  {tableVirtualizer.getVirtualItems().map((virtualRow) => {
                    const table = tables[virtualRow.index]
                    return (
                      <div
                        key={table.name}
                        data-index={virtualRow.index}
                        ref={tableVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          transform: `translateY(${virtualRow.start}px)`,
                          width: '100%',
                        }}
                      >
                        <TableNode
                          connection={connection}
                          database={database}
                          databaseKey={databaseKey}
                          table={table}
                          tableGroups={treeConfig.tableGroups}
                          schemaName={schema.name}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Object groups (views, materializedViews, functions, procedures, sequences) */}
          {treeConfig.groups.map((group) => {
            const groupKey = `${schemaKey}:${group.key}`
            const groupExpanded = expandedGroups.has(groupKey)
            const objects = (schema[group.key as keyof SchemaItem] as string[]) ?? []

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
                  {getObjectGroupIcon(group.key as ObjectGroupKey)}
                  <span className="tree-label">{group.label}</span>
                  <span>{objects.length}</span>
                </button>
                {groupExpanded &&
                  objects.map((objectName) => (
                    <button
                      type="button"
                      className="tree-row tree-leaf"
                      key={`${groupKey}:${objectName}`}
                      onContextMenu={(event) => openObjectContextMenu(event, group.key, group.label, objectName)}
                    >
                      {getObjectGroupIcon(group.key as ObjectGroupKey)}
                      <span className="tree-label">{objectName}</span>
                    </button>
                  ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

export default SchemaNode
