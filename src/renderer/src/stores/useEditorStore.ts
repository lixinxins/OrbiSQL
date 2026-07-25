import { create } from 'zustand'

export interface EditorState {
  sqlCache: Map<string, string>
  actions: {
    setSqlCache: (id: string, sql: string) => void
    getSqlCache: (id: string) => string | undefined
    removeSqlCache: (id: string) => void
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  sqlCache: new Map(),

  actions: {
    setSqlCache: (id, sql) => {
      set((state) => {
        const next = new Map(state.sqlCache)
        next.set(id, sql)
        return { sqlCache: next }
      })
    },

    getSqlCache: (id) => get().sqlCache.get(id),

    removeSqlCache: (id) => {
      set((state) => {
        const next = new Map(state.sqlCache)
        next.delete(id)
        return { sqlCache: next }
      })
    }
  }
}))
