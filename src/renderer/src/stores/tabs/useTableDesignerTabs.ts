import { create } from 'zustand'
import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import type { TableDesignerTab } from './types'
import { useTabStore } from '../useTabStore'

export interface TableDesignerTabsState {
  tableDialogs: TableDesignerTab[]
  activeTableDialogId: string | null
  dirtyTabs: Set<string>
  saveHandlers: Map<string, () => Promise<boolean>>
  pendingCloseTab: { id: string; tableName: string } | null
  setTabDirty: (id: string, isDirty: boolean, saveHandler?: () => Promise<boolean>) => void
  setPendingCloseTab: (target: { id: string; tableName: string } | null) => void
  designTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  openTableDesigner: (connection: DatabaseConnection, database: DatabaseItem) => void
  closeTableDesigner: (id: string) => void
  forceCloseTableDesigner: (id: string) => void
  updateTableDialog: (id: string, table: TableItem) => void
}

export const useTableDesignerTabsStore = create<TableDesignerTabsState>((set, get) => ({
  tableDialogs: [],
  activeTableDialogId: null,
  dirtyTabs: new Set(),
  saveHandlers: new Map(),
  pendingCloseTab: null,

  setTabDirty: (id, isDirty, saveHandler) => {
    set((state) => {
      const nextDirty = new Set(state.dirtyTabs)
      if (isDirty) nextDirty.add(id)
      else nextDirty.delete(id)

      const nextSave = new Map(state.saveHandlers)
      if (saveHandler) nextSave.set(id, saveHandler)
      else if (!isDirty) nextSave.delete(id)

      return { dirtyTabs: nextDirty, saveHandlers: nextSave }
    })
  },

  setPendingCloseTab: (target) => set({ pendingCloseTab: target }),

  designTable: (connection, database, table) => {
    const id = crypto.randomUUID()
    set((state) => ({
      tableDialogs: [...state.tableDialogs, { id, connection, database, table }],
      activeTableDialogId: id
    }))
    useTabStore.getState().activateWorkspaceTab({ id, kind: 'tables' })
  },

  openTableDesigner: (connection, database) => {
    const id = crypto.randomUUID()
    set((state) => ({
      tableDialogs: [...state.tableDialogs, { id, connection, database }],
      activeTableDialogId: id
    }))
    useTabStore.getState().activateWorkspaceTab({ id, kind: 'tables' })
  },

  closeTableDesigner: (id) => {
    const state = get()
    if (state.dirtyTabs.has(id)) {
      const tab = state.tableDialogs.find((t) => t.id === id)
      const name = tab?.table?.name || '新建数据表'
      set({ pendingCloseTab: { id, tableName: name } })
      return
    }
    get().forceCloseTableDesigner(id)
  },

  forceCloseTableDesigner: (id) => {
    set((state) => {
      const nextDirty = new Set(state.dirtyTabs)
      nextDirty.delete(id)
      const nextSave = new Map(state.saveHandlers)
      nextSave.delete(id)
      return { dirtyTabs: nextDirty, saveHandlers: nextSave, pendingCloseTab: null }
    })
    useTabStore.getState().closeWithFallback('tables', id)
  },

  updateTableDialog: (id, table) => {
    set((state) => ({
      tableDialogs: state.tableDialogs.map((t) => (t.id === id ? { ...t, table } : t))
    }))
  }
}))
