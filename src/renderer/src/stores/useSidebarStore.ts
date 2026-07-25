import { create } from 'zustand'
import type { DatabaseConnection, DatabaseItem, SchemaItem, TableItem } from '@/shared/connections'
import { useConnectionStore } from './useConnectionStore'

// ── Discriminated Union: Context Menu ──────────────────────

export type SidebarContextMenuState =
  | { kind: 'connection'; x: number; y: number; connection: DatabaseConnection }
  | { kind: 'database'; x: number; y: number; connection: DatabaseConnection; database: DatabaseItem; databaseKey: string }
  | { kind: 'schema'; x: number; y: number; connection: DatabaseConnection; database: DatabaseItem; databaseKey: string; schema: SchemaItem }
  | { kind: 'table'; x: number; y: number; connection: DatabaseConnection; database: DatabaseItem; databaseKey: string; table: TableItem }
  | { kind: 'tableGroup'; x: number; y: number; connection: DatabaseConnection; database: DatabaseItem; databaseKey: string }
  | { kind: 'object'; x: number; y: number; connection: DatabaseConnection; database: DatabaseItem; databaseKey: string; groupKey: string; groupLabel: string; objectName: string }
  | { kind: 'objectGroup'; x: number; y: number; connection: DatabaseConnection; database: DatabaseItem; databaseKey: string; groupKey: string; groupLabel: string }
  | { kind: 'connectionGroup'; x: number; y: number; groupId: number; groupName: string }
  | { kind: 'section'; x: number; y: number; category: 'database' | 'ssh' }
  | { kind: 'sidebarBlank'; x: number; y: number }
  | null

// ── Engine Tree Config Types ───────────────────────────────

export type ObjectGroupKey =
  | 'views' | 'functions' | 'procedures' | 'indexes' | 'triggers'
  | 'materializedViews' | 'sequences' | 'packages' | 'synonyms'
  | 'events' | 'dictionaries' | 'aliases' | 'dataStreams' | 'mappings' | 'extensions'
  | 'types' | 'domains' | 'foreignTables'

export type TableGroupKey = keyof Pick<TableItem, 'columns' | 'indexes' | 'foreignKeys' | 'checks' | 'triggers' | 'policies'>

export interface ObjectGroup { key: ObjectGroupKey; label: string }
export interface EngineTreeConfig { itemLabel: string; groups: ObjectGroup[]; tableGroups: Array<{ key: TableGroupKey; label: string }> }

// ── Sidebar Store ──────────────────────────────────────────

export interface SidebarState {
  // ── UI state ────────────────────────────────────────────
  expandedConnections: Set<number>
  expandedDatabases: Set<string>
  loadedEmptyDatabases: Set<string>
  loadingDatabases: Set<string>
  expandedGroups: Set<string>
  expandedTables: Set<string>
  expandedTableGroups: Set<string>
  selectedTable: string
  togglingConnections: Set<number>
  search: string
  contextMenu: SidebarContextMenuState

  // ── Actions ─────────────────────────────────────────────
  actions: {
    setExpandedConnections: (updater: Set<number> | ((prev: Set<number>) => Set<number>)) => void
    setExpandedDatabases: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
    setLoadedEmptyDatabases: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
    setLoadingDatabases: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
    setExpandedGroups: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
    setExpandedTables: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
    setExpandedTableGroups: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
    setSelectedTable: (value: string | ((prev: string) => string)) => void
    setTogglingConnections: (updater: Set<number> | ((prev: Set<number>) => Set<number>)) => void
    setSearch: (value: string | ((prev: string) => string)) => void
    setContextMenu: (value: SidebarContextMenuState | ((prev: SidebarContextMenuState) => SidebarContextMenuState)) => void

    // ── Business handlers ───────────────────────────────────
    loadDatabaseDetail: (connection: DatabaseConnection, database: DatabaseItem) => Promise<{ connection: DatabaseConnection; database: DatabaseItem } | null>
  }
}

export const useSidebarStore = create<SidebarState>((set) => ({
  expandedConnections: new Set(),
  expandedDatabases: new Set(),
  loadedEmptyDatabases: new Set(),
  loadingDatabases: new Set(),
  expandedGroups: new Set(),
  expandedTables: new Set(),
  expandedTableGroups: new Set(),
  selectedTable: '',
  togglingConnections: new Set(),
  search: '',
  contextMenu: null,

  actions: {
    setExpandedConnections: (updater) => {
      set((state) => ({
        expandedConnections: typeof updater === 'function' ? (updater as (prev: Set<number>) => Set<number>)(state.expandedConnections) : updater
      }))
    },

    setExpandedDatabases: (updater) => {
      set((state) => ({
        expandedDatabases: typeof updater === 'function' ? (updater as (prev: Set<string>) => Set<string>)(state.expandedDatabases) : updater
      }))
    },

    setLoadedEmptyDatabases: (updater) => {
      set((state) => ({
        loadedEmptyDatabases: typeof updater === 'function' ? (updater as (prev: Set<string>) => Set<string>)(state.loadedEmptyDatabases) : updater
      }))
    },

    setLoadingDatabases: (updater) => {
      set((state) => ({
        loadingDatabases: typeof updater === 'function' ? (updater as (prev: Set<string>) => Set<string>)(state.loadingDatabases) : updater
      }))
    },

    setExpandedGroups: (updater) => {
      set((state) => ({
        expandedGroups: typeof updater === 'function' ? (updater as (prev: Set<string>) => Set<string>)(state.expandedGroups) : updater
      }))
    },

    setExpandedTables: (updater) => {
      set((state) => ({
        expandedTables: typeof updater === 'function' ? (updater as (prev: Set<string>) => Set<string>)(state.expandedTables) : updater
      }))
    },

    setExpandedTableGroups: (updater) => {
      set((state) => ({
        expandedTableGroups: typeof updater === 'function' ? (updater as (prev: Set<string>) => Set<string>)(state.expandedTableGroups) : updater
      }))
    },

    setSelectedTable: (value) => {
      set((state) => ({
        selectedTable: typeof value === 'function' ? (value as (prev: string) => string)(state.selectedTable) : value
      }))
    },

    setTogglingConnections: (updater) => {
      set((state) => ({
        togglingConnections: typeof updater === 'function' ? (updater as (prev: Set<number>) => Set<number>)(state.togglingConnections) : updater
      }))
    },

    setSearch: (value) => {
      set((state) => ({
        search: typeof value === 'function' ? (value as (prev: string) => string)(state.search) : value
      }))
    },

    setContextMenu: (value) => {
      set((state) => ({
        contextMenu: typeof value === 'function' ? (value as (prev: SidebarContextMenuState) => SidebarContextMenuState)(state.contextMenu) : value
      }))
    },

    loadDatabaseDetail: async (connection, database) => {
      try {
        const loadedConnections = await useConnectionStore.getState().actions.loadConnections()
        const loadedConnection = loadedConnections.find((item) => item.id === connection.id)
        const loadedDatabase = loadedConnection?.databases.find((item) => item.name === database.name)
        return loadedConnection && loadedDatabase
          ? { connection: loadedConnection, database: loadedDatabase }
          : null
      } catch {
        return null
      }
    }
  }
}))
