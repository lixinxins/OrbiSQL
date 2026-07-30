import { create } from 'zustand'
import type { AppLanguage, AppTheme } from '@/shared/connections'
import type { ClosableWorkspaceKind } from './tabs/types'
import { LS_KEYS } from '../utils/localStorage-keys'

export interface UIState {
  sidebarCollapsed: boolean
  language: AppLanguage
  theme: AppTheme
  statusInfo: {
    ping: number | null
    version: string
    charset: string
    dbConnectedCount: number
    sshConnectedCount: number
    /** 当前侧边栏聚焦项信息 */
    focusedItem: { connectionName: string; databaseName?: string; tableName?: string; engine?: string } | null
  }
  recentConnections: Array<{ connectionId: number; connectionName: string; databaseName: string; engine: string; ts: number }>
  tabContextMenu: { id: string; kind: ClosableWorkspaceKind; x: number; y: number } | null
  actions: {
    toggleSidebarCollapsed: () => void
    setLanguage: (language: AppLanguage) => void
    setTheme: (theme: AppTheme) => void
    setStatusInfo: (statusInfo: UIState['statusInfo']) => void
    /** 设置侧边栏当前聚焦项（点击连接/数据库/表时调用） */
    setFocusedItem: (item: UIState['statusInfo']['focusedItem']) => void
    pushRecentConnection: (entry: UIState['recentConnections'][number]) => void
    setTabContextMenu: (tabContextMenu: UIState['tabContextMenu']) => void
  }
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: (() => {
    try { return localStorage.getItem(LS_KEYS.SIDEBAR_COLLAPSED) === 'true' } catch { return false }
  })(),
  language: (() => {
    try { return (localStorage.getItem(LS_KEYS.LANGUAGE) === 'en-US' ? 'en-US' : 'zh-CN') as AppLanguage } catch { return 'zh-CN' as AppLanguage }
  })(),
  theme: (() => {
    try {
      const saved = localStorage.getItem(LS_KEYS.THEME)
      return saved === 'classic' ? 'classic' : 'light'
    } catch { return 'light' as AppTheme }
  })(),
  statusInfo: { ping: null, version: '', charset: 'UTF-8', dbConnectedCount: 0, sshConnectedCount: 0, focusedItem: null },
  recentConnections: (() => {
    try { return JSON.parse(localStorage.getItem(LS_KEYS.RECENT_CONNECTIONS) ?? '[]') as UIState['recentConnections'] } catch { return [] }
  })(),
  tabContextMenu: null,

  actions: {
    toggleSidebarCollapsed: () => {
      set((state) => {
        const next = !state.sidebarCollapsed
        localStorage.setItem(LS_KEYS.SIDEBAR_COLLAPSED, String(next))
        return { sidebarCollapsed: next }
      })
    },

    setLanguage: (language) => {
      localStorage.setItem(LS_KEYS.LANGUAGE, language)
      set({ language })
    },

    setTheme: (theme) => {
      localStorage.setItem(LS_KEYS.THEME, theme)
      set({ theme })
    },

    setStatusInfo: (statusInfo) => set({ statusInfo }),

    setFocusedItem: (item) => set((state) => ({
      statusInfo: { ...state.statusInfo, focusedItem: item }
    })),

    pushRecentConnection: (entry) => {
      set((state) => {
        const next = [entry, ...state.recentConnections.filter((r) => !(r.connectionId === entry.connectionId && r.databaseName === entry.databaseName))].slice(0, 8)
        localStorage.setItem(LS_KEYS.RECENT_CONNECTIONS, JSON.stringify(next))
        return { recentConnections: next }
      })
    },

    setTabContextMenu: (tabContextMenu) => set({ tabContextMenu })
  }
}))
