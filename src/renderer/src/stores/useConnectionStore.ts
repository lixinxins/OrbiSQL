import { create } from 'zustand'
import type { ConnectionEnvironment, DatabaseConnection, DatabaseItem } from '@/shared/connections'
import { cachedRequest, invalidateCachePrefix } from '../utils/request-cache'
import { useDialogStore } from './useDialogStore'

export interface ConnectionState {
  connections: DatabaseConnection[]
  connectionLatencies: Record<number, number>
  connectionsLoading: boolean
  connectionsError: string | null
  groupsRefreshRequest: number
  actions: {
    setConnections: (connections: DatabaseConnection[]) => void
    setConnectionLatency: (connectionId: number, latency: number | null) => void
    setConnectionsLoading: (loading: boolean) => void
    setConnectionsError: (error: string | null) => void
    setGroupsRefreshRequest: (updater: number | ((prev: number) => number)) => void
    loadConnections: () => Promise<DatabaseConnection[]>
    refreshConnection: (connectionId: number) => Promise<void>
    refreshDatabase: (connectionId: number, databaseName: string) => Promise<void>
    refreshTable: (connectionId: number, databaseName: string, tableName: string) => Promise<void>
    toggleConnection: (connection: DatabaseConnection) => Promise<{ success: boolean; message: string }>
    duplicateConnection: (connection: DatabaseConnection) => Promise<{ success: boolean; message?: string; connectionId?: number }>
    deleteConnection: (connection: DatabaseConnection) => Promise<{ success: boolean; message: string }>
    runSqlFile: (connection: DatabaseConnection) => Promise<{ success: boolean; message: string }>
    runDatabaseSqlFile: (connection: DatabaseConnection, database: DatabaseItem) => Promise<{ success: boolean; message: string }>
    deleteDatabase: (connection: DatabaseConnection, database: DatabaseItem) => Promise<{ success: boolean; message: string }>
    exportDatabaseSql: (connection: DatabaseConnection, database: DatabaseItem, tableName: string | undefined, includeData: boolean) => Promise<void>
    setConnectionColor: (connection: DatabaseConnection, color: string) => Promise<void>
    setConnectionEnvironment: (connection: DatabaseConnection, environment: ConnectionEnvironment | null, color?: string) => Promise<void>
    exportConfig: (options?: { targetPath?: string; selectedIds?: number[]; includePasswords?: boolean }) => Promise<{ success: boolean; message: string; filePath?: string }>
    importConfig: (options?: { filePath?: string; sourcePath?: string; groups?: Array<{ name: string; category?: 'database' | 'ssh' }>; connections?: Array<import('@/shared/connections').CreateConnectionInput & { groupName?: string }> }) => Promise<{ success: boolean; message: string }>
    mergeDatabaseDetail: (connectionId: number, databaseDetail: DatabaseItem) => void
    loadDatabaseMetadata: (connectionId: number, databaseName: string) => Promise<DatabaseItem | null>
    updateSortOrders: (orders: Array<{ id: number; sortOrder: number }>) => Promise<{ success: boolean; message: string }>
  }
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  connectionLatencies: {},
  connectionsLoading: true,
  connectionsError: null,
  groupsRefreshRequest: 0,

  actions: {
    setConnections: (connections) => set({ connections }),

    setConnectionLatency: (connectionId, latency) =>
      set((state) => {
        const next = { ...state.connectionLatencies }
        if (latency === null) delete next[connectionId]
        else next[connectionId] = latency
        return { connectionLatencies: next }
      }),

    setConnectionsLoading: (loading) => set({ connectionsLoading: loading }),

    setConnectionsError: (error) => set({ connectionsError: error }),

    setGroupsRefreshRequest: (updater) => {
      set((state) => ({ groupsRefreshRequest: typeof updater === 'function' ? (updater as (prev: number) => number)(state.groupsRefreshRequest) : updater }))
    },

    loadConnections: async () => {
      set({ connectionsLoading: true, connectionsError: null })
      try {
        // 并发去重：多个组件同时挂载/刷新时只发一次 IPC
        const loadedConnections = await cachedRequest(
          'connections:list',
          () => window.omnidb.connections.list(),
          { ttlMs: 0 }
        )
        set({ connections: loadedConnections })
        return loadedConnections
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set({ connectionsError: message })
        return get().connections
      } finally {
        set({ connectionsLoading: false })
      }
    },

    refreshConnection: async (connectionId) => {
      const updated = await window.omnidb.connections.getOne(connectionId)
      if (updated) {
        invalidateCachePrefix(`db-meta:${connectionId}:`)
        set((state) => ({
          connections: state.connections.map((c) => (c.id === connectionId ? updated : c))
        }))
      }
    },

    refreshDatabase: async (connectionId, databaseName) => {
      const conn = get().connections.find((c) => c.id === connectionId)
      if (!conn) return
      const updatedConn = await window.omnidb.connections.getOne(connectionId)
      if (!updatedConn) return
      const targetDb = updatedConn.databases.find((d) => d.name === databaseName)
      if (!targetDb) return
      invalidateCachePrefix(`db-meta:${connectionId}:`)

      set((state) => ({
        connections: state.connections.map((c) => {
          if (c.id !== connectionId) return c
          return {
            ...c,
            databases: c.databases.map((db) => (db.name === databaseName ? targetDb : db))
          }
        })
      }))
    },

    refreshTable: async (connectionId, databaseName, tableName) => {
      const conn = get().connections.find((c) => c.id === connectionId)
      if (!conn) return
      const defRes = await window.omnidb.tables.getDefinition(connectionId, databaseName, tableName)
      if (!defRes.success || !defRes.columns) return
      const cols = defRes.columns
      invalidateCachePrefix(`db-meta:${connectionId}:`)

      set((state) => ({
        connections: state.connections.map((c) => {
          if (c.id !== connectionId) return c
          return {
            ...c,
            databases: c.databases.map((db) => {
              if (db.name !== databaseName) return db
              return {
                ...db,
                tables: db.tables.map((t) => {
                  if (t.name !== tableName) return t
                  return {
                    ...t,
                    columns: cols.map((col) => ({
                      name: col.name,
                      type: col.typeDefinition || col.type,
                      nullable: !col.notNull,
                      isPrimaryKey: col.primaryKey,
                      comment: col.comment
                    }))
                  }
                })
              }
            })
          }
        })
      }))
    },

    toggleConnection: async (connection) => {
      const isOpening = !connection.open
      const startTime = performance.now()
      // 乐观更新：先翻转 UI 状态，失败时回滚
      set((state) => ({
        connections: state.connections.map((c) => (c.id === connection.id ? { ...c, open: isOpening } : c))
      }))
      try {
        const result = isOpening
          ? await window.omnidb.connections.open(connection.id)
          : await window.omnidb.connections.close(connection.id)
        if (!result.success) {
          // 回滚乐观状态
          set((state) => ({
            connections: state.connections.map((c) => (c.id === connection.id ? { ...c, open: connection.open } : c))
          }))
          return result
        }
        await get().actions.refreshConnection(connection.id)
        const elapsed = Math.round(performance.now() - startTime)

        if (isOpening) {
          get().actions.setConnectionLatency(connection.id, elapsed)
        } else {
          get().actions.setConnectionLatency(connection.id, null)
        }
        return result
      } catch (err) {
        // 回滚乐观状态
        set((state) => ({
          connections: state.connections.map((c) => (c.id === connection.id ? { ...c, open: connection.open } : c))
        }))
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    },

    duplicateConnection: async (connection) => {
      const result = await window.omnidb.connections.duplicate(connection.id)
      if (result.success && result.connectionId) {
        const newConn = await window.omnidb.connections.getOne(result.connectionId)
        if (newConn) {
          set((state) => ({ connections: [...state.connections, newConn] }))
        }
      }
      return result
    },

    deleteConnection: async (connection) => {
      const result = await window.omnidb.connections.delete(connection.id, connection.name)
      if (result.success) {
        set((state) => ({ connections: state.connections.filter((c) => c.id !== connection.id) }))
      }
      return result
    },

    runSqlFile: async (connection) => {
      const res = await window.omnidb.connections.previewSqlFile(connection.id)
      if (res.canceled) return { success: false, message: '已取消选择文件' }
      if (!res.success) {
        window.alert(res.message || '读取 SQL 文件失败')
        return { success: false, message: res.message || '读取 SQL 文件失败' }
      }
      useDialogStore.getState().actions.setRunSqlFilePreviewData(res)
      return { success: true, message: '已准备预览 SQL 文件' }
    },

    runDatabaseSqlFile: async (connection, database) => {
      const res = await window.omnidb.connections.previewSqlFile(connection.id, database.name)
      if (res.canceled) return { success: false, message: '已取消选择文件' }
      if (!res.success) {
        window.alert(res.message || '读取 SQL 文件失败')
        return { success: false, message: res.message || '读取 SQL 文件失败' }
      }
      useDialogStore.getState().actions.setRunSqlFilePreviewData(res)
      return { success: true, message: '已准备预览 SQL 文件' }
    },

    deleteDatabase: async (connection, database) => {
      const result = await window.omnidb.databases.delete(connection.id, database.name)
      if (result.success) {
        await get().actions.refreshConnection(connection.id)
      }
      return result
    },

    exportDatabaseSql: async (connection, database, tableName, includeData) => {
      useDialogStore.getState().actions.setExportSqlDialog({
        open: true,
        connection,
        database,
        table: database.tables.find((t) => t.name === tableName),
        includeData,
        status: 'selecting',
        progress: 0,
        message: '正在选择保存文件...'
      })
      const result = await window.omnidb.databases.exportSql(connection.id, database.name, tableName, includeData)
      if (result.canceled) {
        useDialogStore.getState().actions.setExportSqlDialog(null)
        return
      }
      useDialogStore.getState().actions.setExportSqlDialog({
        open: true,
        connection,
        database,
        table: database.tables.find((t) => t.name === tableName),
        includeData,
        status: result.success ? 'success' : 'error',
        progress: 100,
        message: result.message || (result.success ? '导出成功' : '导出失败'),
        filePath: result.filePath,
        sqlContent: result.sqlContent,
        totalLength: result.totalLength,
        isTruncated: result.isTruncated,
        error: result.success ? undefined : result.message
      })
    },

    setConnectionColor: async (connection, color) => {
      await window.omnidb.connections.updateColor(connection.id, color)
      await get().actions.refreshConnection(connection.id)
    },

    setConnectionEnvironment: async (connection, environment, color) => {
      await window.omnidb.connections.updateEnvironment(connection.id, environment)
      if (color) await window.omnidb.connections.updateColor(connection.id, color)
      await get().actions.refreshConnection(connection.id)
    },

    exportConfig: async (options) => {
      return await window.omnidb.connections.exportConfig(options)
    },

    importConfig: async (options) => {
      const res = await window.omnidb.connections.importConfig(options)
      if (res.success) {
        set({ groupsRefreshRequest: get().groupsRefreshRequest + 1 })
        await get().actions.loadConnections()
      }
      return res
    },

    mergeDatabaseDetail: (connectionId, databaseDetail) => {
      set((state) => ({
        connections: state.connections.map((c) => {
          if (c.id !== connectionId) return c
          const exists = c.databases.some((db) => db.name === databaseDetail.name)
          return {
            ...c,
            databases: exists
              ? c.databases.map((db) => (db.name === databaseDetail.name ? databaseDetail : db))
              : [...c.databases, databaseDetail]
          }
        })
      }))
    },

    loadDatabaseMetadata: async (connectionId, databaseName) => {
      // 并发去重 + 60s TTL：同一数据库详情短时间内只请求一次
      const detail = await cachedRequest(
        `db-meta:${connectionId}:${databaseName}`,
        () => window.omnidb.connections.readDatabaseDetail(connectionId, databaseName),
        { ttlMs: 60_000 }
      )
      if (!detail) return null
      get().actions.mergeDatabaseDetail(connectionId, detail)
      return detail
    },

    updateSortOrders: async (orders) => {
      const res = await window.omnidb.connections.updateSortOrders(orders)
      if (res.success) {
        await get().actions.loadConnections()
      }
      return res
    }
  }
}))
