import { create } from 'zustand'
import { useDatabaseTabsStore } from './tabs/useDatabaseTabs'
import { useTableDesignerTabsStore } from './tabs/useTableDesignerTabs'
import { useQueryTabsStore } from './tabs/useQueryTabs'
import { useTableDataTabsStore } from './tabs/useTableDataTabs'
import { useTerminalTabsStore } from './tabs/useTerminalTabs'
import { useDocTabsStore } from './tabs/useDocTabs'
import type {
  WorkspaceKind,
  ClosableWorkspaceKind,
  WorkspaceTabReference
} from './tabs/types'
import { AI_DATABASE_TAB_ID } from './tabs/types'

// ── helpers ──────────────────────────────────────────────────────────

/** Fallback priority when the active tab is closed with no adjacent sibling. */
const FALLBACK_PRIORITY: ClosableWorkspaceKind[] = [
  'database',
  'tables',
  'queries',
  'data',
  'terminal',
  'doc',
  'ai'
]

/**
 * Read items + activeId from the correct slice by kind.
 */
function getSliceState(kind: ClosableWorkspaceKind): {
  items: Array<{ id: string }>
  activeId: string | null
} {
  switch (kind) {
    case 'database': {
      const s = useDatabaseTabsStore.getState()
      return { items: s.databaseTabs, activeId: s.activeDatabaseTabId }
    }
    case 'tables': {
      const s = useTableDesignerTabsStore.getState()
      return { items: s.tableDialogs, activeId: s.activeTableDialogId }
    }
    case 'queries': {
      const s = useQueryTabsStore.getState()
      return { items: s.queryTabs, activeId: s.activeQueryId }
    }
    case 'data': {
      const s = useTableDataTabsStore.getState()
      return { items: s.tableDataTabs, activeId: s.activeTableDataId }
    }
    case 'terminal': {
      const s = useTerminalTabsStore.getState()
      return { items: s.sshTerminalTabs, activeId: s.activeSshTerminalId }
    }
    case 'doc': {
      const s = useDocTabsStore.getState()
      return { items: s.docTabs, activeId: s.activeDocId }
    }
    case 'ai':
      return {
        items: useTabStore.getState().aiDatabaseOpen ? [{ id: AI_DATABASE_TAB_ID }] : [],
        activeId: useTabStore.getState().aiDatabaseOpen ? AI_DATABASE_TAB_ID : null
      }
  }
}

/**
 * Find the first available workspace from the fallback priority list,
 * skipping `excludeKind`. Returns the kind to activate (or null).
 */
function findFallbackTarget(
  excludeKind: ClosableWorkspaceKind
): { kind: ClosableWorkspaceKind; id: string } | null {
  for (const kind of FALLBACK_PRIORITY) {
    if (kind === excludeKind) continue
    const slice = getSliceState(kind)
    if (slice.items.length > 0 || kind === 'ai') {
      // For 'ai', aiDatabaseOpen is the flag — the "id" is the constant
      if (kind === 'ai') {
        if (useTabStore.getState().aiDatabaseOpen) {
          return { kind: 'ai', id: AI_DATABASE_TAB_ID }
        }
        continue
      }
      return { kind, id: slice.items[0].id }
    }
  }
  return null
}

// ── store definition ─────────────────────────────────────────────────

export interface TabStoreState {
  /** Currently active workspace area */
  activeWorkspace: WorkspaceKind
  /** Whether the AI database panel is open */
  aiDatabaseOpen: boolean
  /** Set of pinned tab IDs */
  pinnedTabIds: Set<string>

  // ── actions ──

  /**
   * Activate a specific tab across slices.
   * Sets `activeWorkspace` to the tab's kind and updates the corresponding
   * slice's active ID.
   */
  activateWorkspaceTab: (tab: WorkspaceTabReference | null) => void

  /**
   * Unified close-with-fallback strategy.
   * 1. Remove the tab from its slice.
   * 2. If it wasn't active → just update items, keep activeWorkspace.
   * 3. If it was active → activate adjacent sibling.
   * 4. If no sibling → fallback by unified priority.
   */
  closeWithFallback: (sliceKey: ClosableWorkspaceKind, closingId: string) => void

  /**
   * Batch close: closeOthers / closeLeft / closeRight within the same slice.
   */
  closeWorkspaceTabSet: (
    tab: WorkspaceTabReference,
    mode: 'closeOthers' | 'closeLeft' | 'closeRight'
  ) => void

  /** Toggle pin state for a tab ID. */
  togglePinTab: (id: string) => void

  /** Open the AI database panel. */
  openAiDatabase: () => void

  /**
   * Rename a table across both TableDesigner and TableData slices.
   */
  renameTableInTabs: (
    oldName: string,
    newName: string,
    connectionId: number,
    databaseName: string
  ) => void
}

export const useTabStore = create<TabStoreState>((set) => ({
  activeWorkspace: null,
  aiDatabaseOpen: false,
  pinnedTabIds: (() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem('quilldb:pinned-tabs') ?? '[]') as string[]
      )
    } catch {
      return new Set()
    }
  })(),

  // ── activateWorkspaceTab ──────────────────────────────────────────

  activateWorkspaceTab: (tab) => {
    if (!tab) {
      set({ activeWorkspace: null })
      return
    }

    set({ activeWorkspace: tab.kind })

    // Also update the corresponding slice's active ID
    switch (tab.kind) {
      case 'database':
        useDatabaseTabsStore.setState({ activeDatabaseTabId: tab.id })
        break
      case 'tables':
        useTableDesignerTabsStore.setState({ activeTableDialogId: tab.id })
        break
      case 'queries':
        useQueryTabsStore.setState({ activeQueryId: tab.id })
        break
      case 'data':
        useTableDataTabsStore.setState({ activeTableDataId: tab.id })
        break
      case 'terminal':
        useTerminalTabsStore.setState({ activeSshTerminalId: tab.id })
        break
      case 'doc':
        useDocTabsStore.setState({ activeDocId: tab.id })
        break
      case 'ai':
        set({ aiDatabaseOpen: true })
        break
    }
  },

  // ── closeWithFallback ─────────────────────────────────────────────

  closeWithFallback: (sliceKey, closingId) => {
    const slice = getSliceState(sliceKey)
    const isActive = slice.activeId === closingId
    const closingIndex = slice.items.findIndex((t) => t.id === closingId)

    // Remove the closing tab from the slice
    const remaining = slice.items.filter((t) => t.id !== closingId)

    // Helper to write items back to the correct slice
    const updateSliceItems = () => {
      switch (sliceKey) {
        case 'database':
          useDatabaseTabsStore.setState({ databaseTabs: remaining as any })
          break
        case 'tables':
          useTableDesignerTabsStore.setState({ tableDialogs: remaining as any })
          break
        case 'queries':
          useQueryTabsStore.setState({ queryTabs: remaining as any })
          break
        case 'data':
          useTableDataTabsStore.setState({ tableDataTabs: remaining as any })
          break
        case 'terminal':
          useTerminalTabsStore.setState({ sshTerminalTabs: remaining as any })
          break
        case 'doc':
          useDocTabsStore.setState({ docTabs: remaining as any })
          break
        case 'ai':
          set({ aiDatabaseOpen: false })
          break
      }
    }

    const setActiveId = (id: string | null) => {
      switch (sliceKey) {
        case 'database':
          useDatabaseTabsStore.setState({ activeDatabaseTabId: id })
          break
        case 'tables':
          useTableDesignerTabsStore.setState({ activeTableDialogId: id })
          break
        case 'queries':
          useQueryTabsStore.setState({ activeQueryId: id })
          break
        case 'data':
          useTableDataTabsStore.setState({ activeTableDataId: id })
          break
        case 'terminal':
          useTerminalTabsStore.setState({ activeSshTerminalId: id })
          break
        case 'doc':
          useDocTabsStore.setState({ activeDocId: id })
          break
      }
    }

    if (!isActive) {
      // Closing a non-active tab → just remove it, no workspace change
      updateSliceItems()
      return
    }

    // The active tab is being closed
    if (remaining.length > 0) {
      // Activate adjacent tab (the one before the closed tab, clamped)
      const adjacentIndex = Math.max(0, closingIndex - 1)
      const nextTab = remaining[adjacentIndex]
      updateSliceItems()
      setActiveId(nextTab.id)
      set({ activeWorkspace: sliceKey })
      return
    }

    // No remaining tabs in this slice → clear active for this slice
    updateSliceItems()
    setActiveId(null)

    // Fallback to another workspace by priority
    const fallback = findFallbackTarget(sliceKey)
    if (fallback) {
      set({ activeWorkspace: fallback.kind })
      // Activate the first item in the fallback slice
      switch (fallback.kind) {
        case 'database':
          useDatabaseTabsStore.setState({ activeDatabaseTabId: fallback.id })
          break
        case 'tables':
          useTableDesignerTabsStore.setState({ activeTableDialogId: fallback.id })
          break
        case 'queries':
          useQueryTabsStore.setState({ activeQueryId: fallback.id })
          break
        case 'data':
          useTableDataTabsStore.setState({ activeTableDataId: fallback.id })
          break
        case 'terminal':
          useTerminalTabsStore.setState({ activeSshTerminalId: fallback.id })
          break
        case 'ai':
          set({ aiDatabaseOpen: true })
          break
      }
    } else {
      set({ activeWorkspace: null })
    }
  },

  // ── closeWorkspaceTabSet ──────────────────────────────────────────

  closeWorkspaceTabSet: (tab, mode) => {
    const kind = tab.kind
    const slice = getSliceState(kind)
    const items = slice.items
    const targetIndex = items.findIndex((t) => t.id === tab.id)
    if (targetIndex === -1) return

    let idsToKeep: Set<string>

    switch (mode) {
      case 'closeOthers':
        idsToKeep = new Set([tab.id])
        break
      case 'closeLeft':
        idsToKeep = new Set(items.slice(targetIndex).map((t) => t.id))
        break
      case 'closeRight':
        idsToKeep = new Set(items.slice(0, targetIndex + 1).map((t) => t.id))
        break
    }

    const remaining = items.filter((t) => idsToKeep.has(t.id))
    const activeWasRemoved = slice.activeId !== null && !idsToKeep.has(slice.activeId)

    // Update the slice items
    switch (kind) {
      case 'database':
        useDatabaseTabsStore.setState({ databaseTabs: remaining as any })
        break
      case 'tables':
        useTableDesignerTabsStore.setState({ tableDialogs: remaining as any })
        break
      case 'queries':
        useQueryTabsStore.setState({ queryTabs: remaining as any })
        break
      case 'data':
        useTableDataTabsStore.setState({ tableDataTabs: remaining as any })
        break
      case 'terminal':
        useTerminalTabsStore.setState({ sshTerminalTabs: remaining as any })
        break
      case 'doc':
        useDocTabsStore.setState({ docTabs: remaining as any })
        break
    }

    if (activeWasRemoved) {
      // The previously active tab was closed → activate `tab` (the reference tab)
      const setActiveId = (id: string | null) => {
        switch (kind) {
          case 'database':
            useDatabaseTabsStore.setState({ activeDatabaseTabId: id })
            break
          case 'tables':
            useTableDesignerTabsStore.setState({ activeTableDialogId: id })
            break
          case 'queries':
            useQueryTabsStore.setState({ activeQueryId: id })
            break
          case 'data':
            useTableDataTabsStore.setState({ activeTableDataId: id })
            break
          case 'terminal':
            useTerminalTabsStore.setState({ activeSshTerminalId: id })
            break
          case 'doc':
            useDocTabsStore.setState({ activeDocId: id })
            break
        }
      }

      if (remaining.length > 0) {
        // Activate the reference tab if it still exists, otherwise the first remaining
        const refStillExists = remaining.some((t) => t.id === tab.id)
        setActiveId(refStillExists ? tab.id : remaining[0].id)
        set({ activeWorkspace: kind })
      } else {
        setActiveId(null)
        // Fallback to another workspace
        const fallback = findFallbackTarget(kind)
        if (fallback) {
          set({ activeWorkspace: fallback.kind })
          switch (fallback.kind) {
            case 'database':
              useDatabaseTabsStore.setState({ activeDatabaseTabId: fallback.id })
              break
            case 'tables':
              useTableDesignerTabsStore.setState({ activeTableDialogId: fallback.id })
              break
            case 'queries':
              useQueryTabsStore.setState({ activeQueryId: fallback.id })
              break
            case 'data':
              useTableDataTabsStore.setState({ activeTableDataId: fallback.id })
              break
            case 'terminal':
              useTerminalTabsStore.setState({ activeSshTerminalId: fallback.id })
              break
            case 'ai':
              set({ aiDatabaseOpen: true })
              break
          }
        } else {
          set({ activeWorkspace: null })
        }
      }
    }
  },

  // ── togglePinTab ──────────────────────────────────────────────────

  togglePinTab: (id) => {
    set((state) => {
      const next = new Set(state.pinnedTabIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { pinnedTabIds: next }
    })
  },

  // ── openAiDatabase ────────────────────────────────────────────────

  openAiDatabase: () => {
    set({ aiDatabaseOpen: true, activeWorkspace: 'ai' })
  },

  // ── renameTableInTabs ─────────────────────────────────────────────

  renameTableInTabs: (oldName, newName, connectionId, databaseName) => {
    // Update TableDesigner slice
    useTableDesignerTabsStore.setState((state) => ({
      tableDialogs: state.tableDialogs.map((tab) =>
        tab.connection.id === connectionId &&
        tab.database.name === databaseName &&
        tab.table?.name === oldName
          ? { ...tab, table: { ...tab.table!, name: newName } }
          : tab
      )
    }))

    // Update TableData slice
    useTableDataTabsStore.setState((state) => ({
      tableDataTabs: state.tableDataTabs.map((tab) =>
        tab.connection.id === connectionId &&
        tab.database.name === databaseName &&
        tab.table.name === oldName
          ? { ...tab, table: { ...tab.table, name: newName } }
          : tab
      )
    }))
  }
}))
