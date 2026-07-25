import { create } from 'zustand'
import type { DatabaseConnection, DatabaseItem } from '@/shared/connections'
import type { QueryContext } from '../../components/query/QueryWorkspace'
import type { QueryTab } from './types'
import { useTabStore } from '../useTabStore'

export interface QueryTabsState {
  queryTabs: QueryTab[]
  activeQueryId: string | null
  addQueryTab: (context: QueryContext) => string
  openQuery: (
    connection: DatabaseConnection,
    database: DatabaseItem,
    recentConnections: { push: (entry: { connectionId: number; connectionName: string; databaseName: string; engine: string; ts: number }) => void }
  ) => void
  openQueryWithSql: (
    connectionId: number | null,
    databaseName: string,
    sql: string,
    connections: DatabaseConnection[]
  ) => void
  openDefaultQuery: (activeDatabase: { connection: DatabaseConnection; database: DatabaseItem } | null) => void
  closeQuery: (id: string) => void
  updateQueryDatabase: (
    id: string,
    connectionId: number | null,
    databaseName: string,
    connections: DatabaseConnection[]
  ) => void
}

export const useQueryTabsStore = create<QueryTabsState>((set, get) => ({
  queryTabs: [],
  activeQueryId: null,

  addQueryTab: (context) => {
    const id = crypto.randomUUID()
    set((state) => ({
      queryTabs: [...state.queryTabs, { id, context }],
      activeQueryId: id
    }))
    useTabStore.getState().activateWorkspaceTab({ id, kind: 'queries' })
    return id
  },

  openQuery: (connection, database, recentConnections) => {
    recentConnections.push({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      engine: connection.engine,
      ts: Date.now()
    })
    get().addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name
    })
  },

  openQueryWithSql: (connectionId, databaseName, sql, connections) => {
    const connection = connections.find((c) => c.id === connectionId)
    const id = crypto.randomUUID()
    set((state) => ({
      queryTabs: [
        ...state.queryTabs,
        {
          id,
          context: {
            connectionId,
            connectionName: connection?.name ?? '',
            databaseName,
            initialSql: sql,
            autoRun: false
          }
        }
      ],
      activeQueryId: id
    }))
    useTabStore.getState().activateWorkspaceTab({ id, kind: 'queries' })
  },

  openDefaultQuery: (activeDatabase) => {
    if (activeDatabase) {
      get().openQuery(activeDatabase.connection, activeDatabase.database, { push: () => {} })
    } else {
      get().addQueryTab({ connectionId: null, connectionName: '', databaseName: '' })
    }
  },

  closeQuery: (id) => {
    useTabStore.getState().closeWithFallback('queries', id)
  },

  updateQueryDatabase: (id, connectionId, databaseName, connections) => {
    const connection = connections.find((item) => item.id === connectionId)
    set((state) => ({
      queryTabs: state.queryTabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              context: {
                ...tab.context,
                connectionId,
                connectionName: connection?.name ?? '',
                databaseName
              }
            }
          : tab
      )
    }))
  }
}))
