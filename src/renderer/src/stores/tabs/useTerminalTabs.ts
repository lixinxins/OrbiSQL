import { create } from 'zustand'
import type { DatabaseConnection } from '@/shared/connections'
import type { SshTerminalTab } from './types'
import { useTabStore } from '../useTabStore'

export interface TerminalTabsState {
  sshTerminalTabs: SshTerminalTab[]
  activeSshTerminalId: string | null
  openSshTerminal: (connection: DatabaseConnection) => void
  createSshTerminal: (connection: DatabaseConnection) => void
  closeSshTerminal: (id: string) => void
}

export const useTerminalTabsStore = create<TerminalTabsState>((set, get) => ({
  sshTerminalTabs: [],
  activeSshTerminalId: null,

  openSshTerminal: (connection) => {
    const existing = get().sshTerminalTabs.find((tab) => tab.connection.id === connection.id)
    if (existing) {
      set({ activeSshTerminalId: existing.id })
      useTabStore.getState().activateWorkspaceTab({ id: existing.id, kind: 'terminal' })
      return
    }
    const id = crypto.randomUUID()
    set((state) => ({
      sshTerminalTabs: [...state.sshTerminalTabs, { id, connection }],
      activeSshTerminalId: id
    }))
    useTabStore.getState().activateWorkspaceTab({ id, kind: 'terminal' })
  },

  createSshTerminal: (connection) => {
    const id = crypto.randomUUID()
    set((state) => ({
      sshTerminalTabs: [...state.sshTerminalTabs, { id, connection }],
      activeSshTerminalId: id
    }))
    useTabStore.getState().activateWorkspaceTab({ id, kind: 'terminal' })
  },

  closeSshTerminal: (id) => {
    useTabStore.getState().closeWithFallback('terminal', id)
  }
}))
