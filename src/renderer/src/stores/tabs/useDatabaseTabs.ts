import { create } from 'zustand'
import type { DatabaseConnection, DatabaseItem } from '@/shared/connections'
import type { DatabaseOverviewTab } from './types'
import { useTabStore } from '../useTabStore'

export interface DatabaseTabsState {
  databaseTabs: DatabaseOverviewTab[]
  activeDatabaseTabId: string | null
  openDatabaseOverview: (connection: DatabaseConnection, database: DatabaseItem) => void
  closeDatabaseOverview: (id: string) => void
}

export const useDatabaseTabsStore = create<DatabaseTabsState>((set, get) => ({
  databaseTabs: [],
  activeDatabaseTabId: null,

  openDatabaseOverview: (connection, database) => {
    const existingTab = get().databaseTabs.find(
      (tab) => tab.connectionId === connection.id && tab.databaseName === database.name
    )
    if (existingTab) {
      set({ activeDatabaseTabId: existingTab.id })
      useTabStore.getState().activateWorkspaceTab({ id: existingTab.id, kind: 'database' })
      return
    }
    const id = crypto.randomUUID()
    set((state) => ({
      databaseTabs: [
        ...state.databaseTabs,
        { id, connectionId: connection.id, connectionName: connection.name, databaseName: database.name }
      ],
      activeDatabaseTabId: id
    }))
    useTabStore.getState().activateWorkspaceTab({ id, kind: 'database' })
  },

  closeDatabaseOverview: (id) => {
    useTabStore.getState().closeWithFallback('database', id)
  }
}))

