import type { CreateConnectionInput } from '../../../shared/connections'
import type { ConnectionCore } from './connection-core'
import type { ConnectionLifecycle } from './connection-lifecycle'

/** 连接配置导入导出：JSON 备份文件的导出、解析与导入。 */
export class ConfigTransfer {
  constructor(
    private readonly core: ConnectionCore,
    private readonly lifecycle: ConnectionLifecycle
  ) {}

  async exportConfig(options?: {
    targetPath?: string
    selectedIds?: number[]
    includePasswords?: boolean
  }): Promise<{ success: boolean; message: string; filePath?: string }> {
    try {
      let connections = this.core.repository.list()
      const groups = this.core.repository.listGroups()

      if (options?.selectedIds?.length) {
        const idSet = new Set(options.selectedIds)
        connections = connections.filter((c) => idSet.has(c.id))
      }

      const includePwd = options?.includePasswords === true

      const exportData = {
        app: 'OrbiSQL',
        version: '1.0.1',
        exportedAt: new Date().toISOString(),
        groups: groups.map((g) => ({ name: g.name, category: g.category })),
        connections: connections.map((c) => ({
          name: c.name,
          engine: c.engine,
          host: c.host,
          port: c.port,
          username: c.username,
          defaultDatabase: c.defaultDatabase,
          password: includePwd && c.savePassword ? c.password : '',
          savePassword: includePwd && c.savePassword,
          color: c.color,
          environment: c.environment,
          groupName: c.groupName,
          sshEnabled: c.sshEnabled,
          sshHost: c.sshHost,
          sshPort: c.sshPort,
          sshUsername: c.sshUsername,
          sshAuthType: c.sshAuthType,
          sshPassword: includePwd ? c.sshPassword : '',
          sshPrivateKeyPath: c.sshPrivateKeyPath,
          sshPassphrase: includePwd ? c.sshPassphrase : '',
          sslEnabled: c.sslEnabled,
          sslRejectUnauthorized: c.sslRejectUnauthorized,
          sslCaPath: c.sslCaPath,
          sslCertPath: c.sslCertPath,
          sslKeyPath: c.sslKeyPath
        }))
      }

      let filePath = options?.targetPath || ''
      if (!filePath) {
        const { dialog } = await import('electron')
        const selected = await dialog.showSaveDialog({
          title: '导出连接配置文件',
          defaultPath: 'orbisql-connections-backup.json',
          filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
        })
        if (selected.canceled || !selected.filePath) {
          return { success: false, message: '已取消导出' }
        }
        filePath = selected.filePath
      }

      const { writeFile } = await import('fs/promises')
      await writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf8')
      return { success: true, message: `成功导出 ${connections.length} 个连接及 ${groups.length} 个分组`, filePath }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async readImportConfigFile(sourcePath?: string): Promise<{
    success: boolean
    message: string
    filePath?: string
    groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
    connections?: Array<CreateConnectionInput & { groupName?: string }>
  }> {
    try {
      let filePath = sourcePath || ''
      if (!filePath) {
        const { dialog } = await import('electron')
        const selected = await dialog.showOpenDialog({
          title: '选择导入的连接配置文件',
          properties: ['openFile'],
          filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
        })
        if (selected.canceled || !selected.filePaths[0]) {
          return { success: false, message: '已取消导入' }
        }
        filePath = selected.filePaths[0]
      }

      const { readFile } = await import('fs/promises')
      const content = await readFile(filePath, 'utf8')
      const data = JSON.parse(content) as {
        groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
        connections?: Array<CreateConnectionInput & { groupName?: string }>
      }

      if (!Array.isArray(data.connections)) {
        return { success: false, message: '导入文件格式不合法，未找到有效 connections 列表' }
      }

      return {
        success: true,
        message: '解析配置文件成功',
        filePath,
        groups: data.groups || [],
        connections: data.connections || []
      }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async importConfig(options?: {
    filePath?: string
    sourcePath?: string
    groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
    connections?: Array<CreateConnectionInput & { groupName?: string }>
  }): Promise<{ success: boolean; message: string }> {
    try {
      let connections = options?.connections
      let groups = options?.groups

      if (!connections) {
        const readRes = await this.readImportConfigFile(options?.filePath || options?.sourcePath)
        if (!readRes.success || !readRes.connections) {
          return { success: false, message: readRes.message }
        }
        connections = readRes.connections
        groups = readRes.groups
      }

      const existingGroups = this.core.repository.listGroups()
      const groupMap = new Map<string, number>(existingGroups.map((g) => [g.name, g.id]))

      if (Array.isArray(groups)) {
        for (const g of groups) {
          if (g.name && !groupMap.has(g.name)) {
            const res = this.lifecycle.createConnectionGroup(g.name, g.category || 'database')
            if (res.success) {
              const updatedGroups = this.core.repository.listGroups()
              const created = updatedGroups.find((item) => item.name === g.name)
              if (created) groupMap.set(created.name, created.id)
            }
          }
        }
      }

      const existingConnections = this.core.repository.list()
      const existingNames = new Set(existingConnections.map((c) => c.name))
      let importedCount = 0

      for (const conn of connections) {
        if (!conn.name || !conn.engine) continue
        let uniqueName = conn.name
        let suffix = 1
        while (existingNames.has(uniqueName)) {
          uniqueName = `${conn.name} (${suffix++})`
        }
        existingNames.add(uniqueName)

        const groupId = conn.groupName && groupMap.has(conn.groupName) ? groupMap.get(conn.groupName)! : null
        this.core.repository.create({
          name: uniqueName,
          engine: conn.engine,
          host: conn.host || 'localhost',
          port: conn.port || 3306,
          username: conn.username || 'root',
          password: conn.password || '',
          defaultDatabase: conn.defaultDatabase || '',
          savePassword: Boolean(conn.savePassword),
          color: conn.color,
          environment: conn.environment ?? null,
          groupId,
          ssh: conn.ssh,
          ssl: conn.ssl
        })
        importedCount++
      }

      return { success: true, message: `已成功导入 ${importedCount} 个连接配置` }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
