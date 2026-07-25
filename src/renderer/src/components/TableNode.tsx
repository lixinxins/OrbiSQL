import { CaretDown, CaretRight, Columns, Key } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import { useSidebarStore } from '../stores/useSidebarStore'
import { useTableDataTabsStore } from '../stores/tabs/useTableDataTabs'
import type { TableGroupKey } from '../stores/useSidebarStore'
import { getTableGroupIcon, getTableIcon } from './SidebarIcons'

interface TableNodeProps {
  connection: DatabaseConnection
  database: DatabaseItem
  databaseKey: string
  table: TableItem
  tableGroups: Array<{ key: TableGroupKey; label: string }>
}

export default function TableNode({ connection, database, databaseKey, table, tableGroups }: TableNodeProps) {
  const expandedTables = useSidebarStore((s) => s.expandedTables)
  const expandedTableGroups = useSidebarStore((s) => s.expandedTableGroups)
  const selectedTable = useSidebarStore((s) => s.selectedTable)
  const sidebarActions = useSidebarStore((s) => s.actions)
  const openTableData = useTableDataTabsStore((s) => s.openTableData)

  const tableKey = `${databaseKey}:table:${table.name}`
  const tableExpanded = expandedTables.has(tableKey)
  const isSelected = selectedTable === tableKey

  const toggleTable = (): void => {
    sidebarActions.setExpandedTables((current) => {
      const next = new Set(current); next.has(tableKey) ? next.delete(tableKey) : next.add(tableKey); return next
    })
  }

  const toggleTableGroup = (groupKey: string, key: TableGroupKey): void => {
    sidebarActions.setExpandedTableGroups((current) => {
      const next = new Set(current)
      if (key === 'columns') {
        const closedKey = `${groupKey}:closed`
        next.has(closedKey) ? next.delete(closedKey) : next.add(closedKey)
      } else {
        next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey)
      }
      return next
    })
  }

  const openContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    sidebarActions.setSelectedTable(tableKey)
    sidebarActions.setContextMenu({
      kind: 'table',
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 285),
      connection, database, databaseKey, table
    })
  }

  return (
    <div className="table-node">
      <button
        type="button"
        className={`tree-row tree-leaf table-row${isSelected ? ' selected' : ''}`}
        aria-expanded={tableExpanded}
        onClick={() => { sidebarActions.setSelectedTable(tableKey); openTableData(connection, database, table) }}
        onContextMenu={openContextMenu}
      >
        <span
          className="table-expand-control"
          role="button"
          tabIndex={0}
          aria-label={tableExpanded ? '收起表结构' : '展开表结构'}
          onClick={(event) => { event.stopPropagation(); toggleTable() }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleTable() }
          }}
        >{tableExpanded ? <CaretDown /> : <CaretRight />}</span>
        {getTableIcon()}<span className="tree-label">{table.name}</span>
      </button>
      {tableExpanded && (
        <div className="table-groups">
          {tableGroups.map((tableGroup) => {
            const tableGroupKey = `${tableKey}:${tableGroup.key}`
            const tableGroupExpanded = tableGroup.key === 'columns'
              ? !expandedTableGroups.has(`${tableGroupKey}:closed`)
              : expandedTableGroups.has(tableGroupKey)
            const rawObjects = tableGroup.key === 'columns'
              ? table.columns?.map((c) => c.name)
              : (table[tableGroup.key] as string[] | undefined)
            const tableObjects: string[] = rawObjects ?? []
            const columnsList = table.columns ?? []

            return (
              <div className="table-object-group" key={tableGroupKey}>
                <button
                  type="button"
                  className="tree-row table-section"
                  aria-expanded={tableGroupExpanded}
                  onClick={() => toggleTableGroup(tableGroupKey, tableGroup.key)}
                >
                  {tableGroupExpanded ? <CaretDown /> : <CaretRight />}
                  {getTableGroupIcon(tableGroup.key)}<span className="tree-label">{tableGroup.label}</span><span>{tableGroup.key === 'columns' ? columnsList.length : tableObjects.length}</span>
                </button>
                {tableGroupExpanded && tableGroup.key === 'columns' && (
                  columnsList.map((col) => (
                    <div className="tree-row table-object table-column-leaf" key={`${tableGroupKey}:${col.name}`}>
                      {col.isPrimaryKey ? <Key weight="fill" className="tree-icon pk-icon" /> : <Columns weight="duotone" className="tree-icon icon-column" />}
                      <span className="tree-label">{col.name}</span>
                      <small className="column-type-badge">{col.type}</small>
                    </div>
                  ))
                )}
                {tableGroupExpanded && tableGroup.key !== 'columns' && (
                  tableObjects.map((objectName) => (
                    <div className="tree-row table-object" key={`${tableGroupKey}:${objectName}`}>
                      <span className="object-bullet" /><span className="tree-label">{objectName}</span>
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
