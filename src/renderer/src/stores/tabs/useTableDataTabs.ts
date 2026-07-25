import { create } from 'zustand'
import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import type { TableDataTab } from './types'
import { useTabStore } from '../useTabStore'

export interface TableDataTabsState {
  tableDataTabs: TableDataTab[]
  activeTableDataId: string | null
  openTableData: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  closeTableData: (id: string) => void
}

export const useTableDataTabsStore = create<TableDataTabsState>((set, get) => ({
  tableDataTabs: [],
  activeTableDataId: null,

  openTableData: (connection, database, table) => {
    const existingTab = get().tableDataTabs.find(
      (tab) => tab.connection.id === connection.id && tab.database.name === database.name && tab.table.name === table.name
    )
    if (existingTab) {
      set({ activeTableDataId: existingTab.id })
      useTabStore.getState().activateWorkspaceTab({ id: existingTab.id, kind: 'data' })
      return
    }
    const id = crypto.randomUUID()
    set((state) => ({
      tableDataTabs: [...state.tableDataTabs, { id, connection, database, table }],
      activeTableDataId: id
    }))
    useTabStore.getState().activateWorkspaceTab({ id, kind: 'data' })
  },

  closeTableData: (id) => {
    useTabStore.getState().closeWithFallback('data', id)
  }
}))
