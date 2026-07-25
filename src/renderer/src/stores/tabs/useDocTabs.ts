import { create } from 'zustand'
import type { DocTab } from './types'
import { useTabStore } from '../useTabStore'

export interface DocTabsState {
  docTabs: DocTab[]
  activeDocId: string | null
  openDocTab: (input: {
    connectionName: string
    databaseName: string
    title: string
    content: string
  }) => string
  closeDocTab: (id: string) => void
  updateDocContent: (id: string, content: string) => void
}

export const useDocTabsStore = create<DocTabsState>((set) => ({
  docTabs: [],
  activeDocId: null,

  openDocTab: (input) => {
    const id = crypto.randomUUID()
    const newTab: DocTab = {
      id,
      title: input.title,
      connectionName: input.connectionName,
      databaseName: input.databaseName,
      content: input.content
    }

    set((state) => ({
      docTabs: [...state.docTabs, newTab],
      activeDocId: id
    }))

    useTabStore.getState().activateWorkspaceTab({ id, kind: 'doc' })
    return id
  },

  closeDocTab: (id) => {
    set((state) => {
      const nextTabs = state.docTabs.filter((t) => t.id !== id)
      const nextActiveId = state.activeDocId === id ? (nextTabs[0]?.id ?? null) : state.activeDocId
      return {
        docTabs: nextTabs,
        activeDocId: nextActiveId
      }
    })
  },

  updateDocContent: (id, content) => {
    set((state) => ({
      docTabs: state.docTabs.map((t) => (t.id === id ? { ...t, content } : t))
    }))
  }
}))
