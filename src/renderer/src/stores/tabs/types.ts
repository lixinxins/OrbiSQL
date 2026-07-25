import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import type { QueryContext } from '../../components/query/QueryWorkspace'

export type WorkspaceKind = 'database' | 'tables' | 'queries' | 'data' | 'ai' | 'terminal' | 'doc' | null
export type ClosableWorkspaceKind = Exclude<WorkspaceKind, null>

export const AI_DATABASE_TAB_ID = 'ai-database-workspace'

export interface DatabaseOverviewTab {
  id: string
  connectionId: number
  connectionName: string
  databaseName: string
}

export interface DocTab {
  id: string
  title: string
  connectionName: string
  databaseName: string
  content: string
}

export interface QueryTab {
  id: string
  context: QueryContext
}

export interface TableDataTab {
  id: string
  connection: DatabaseConnection
  database: DatabaseItem
  table: TableItem
}

export interface TableDesignerTab {
  id: string
  connection: DatabaseConnection
  database: DatabaseItem
  table?: TableItem
}

export interface SshTerminalTab {
  id: string
  connection: DatabaseConnection
}

export interface WorkspaceTabReference {
  id: string
  kind: ClosableWorkspaceKind
}

export interface TabContextMenu extends WorkspaceTabReference {
  x: number
  y: number
}
