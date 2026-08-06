import type {
  ConnectionActionResult,
  ConnectionEnvironment,
  ConnectionGroup,
  CreateConnectionInput,
  DatabaseConnection,
  SaveQueryInput,
  SavedQuery,
  UpdateConnectionInput
} from '../../../shared/connections'
import type { StoredConnection } from '../../database/connection-repository'
import type { ConnectionCore } from './connection-core'
import { ENGINE_COLORS } from './connection-utils'
import type { MetadataReader } from './metadata-reader'

/** 连接生命周期：连接/分组/已存查询的增删改查、打开/关闭/测试与列表水合。 */
export class ConnectionLifecycle {
  constructor(
    private readonly core: ConnectionCore,
    private readonly metadata: MetadataReader
  ) {}

  updateSortOrders(orders: Array<{ id: number; sortOrder: number }>): ConnectionActionResult {
    try {
      this.core.repository.updateSortOrders(orders)
      return { success: true, message: '操作成功' }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async list(): Promise<DatabaseConnection[]> {
    return Promise.all(this.core.repository.list().map((connection) => this.hydrateConnection(connection)))
  }

  async getOne(id: number): Promise<DatabaseConnection | null> {
    const connection = this.core.repository.getById(id)
    if (!connection) return null
    return this.hydrateConnection(connection)
  }

  listConnectionGroups(): ConnectionGroup[] { return this.core.repository.listGroups() }

  createConnectionGroup(name: string, category: 'database' | 'ssh' = 'database'): ConnectionActionResult {
    const normalized = name.trim()
    if (!normalized) return { success: false, message: '请输入分组名称' }
    if (normalized.length > 30) return { success: false, message: '分组名称不能超过 30 个字符' }
    try { this.core.repository.createGroup(normalized, category); return { success: true, message: '分组已创建' } }
    catch (error) { return { success: false, message: this.core.errorMessage(error) } }
  }

  deleteConnectionGroup(id: number): ConnectionActionResult {
    try { this.core.repository.deleteGroup(id); return { success: true, message: '分组已删除，原连接已移至未分组' } }
    catch (error) { return { success: false, message: this.core.errorMessage(error) } }
  }

  renameConnectionGroup(id: number, name: string): ConnectionActionResult {
    const normalized = name.trim()
    if (!normalized) return { success: false, message: '请输入分组名称' }
    if (normalized.length > 30) return { success: false, message: '分组名称不能超过 30 个字符' }
    const groups = this.core.repository.listGroups()
    if (!groups.some((g) => g.id === id)) return { success: false, message: '分组不存在' }
    try {
      this.core.repository.renameGroup(id, normalized)
      return { success: true, message: '分组已重命名' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  setConnectionGroup(connectionId: number, groupId: number | null): ConnectionActionResult {
    const conn = this.core.repository.getById(connectionId)
    if (!conn) return { success: false, message: '连接不存在' }
    if (groupId != null && !this.core.repository.listGroups().some((group) => group.id === groupId)) return { success: false, message: '分组不存在' }
    if (groupId != null) {
      const group = this.core.repository.listGroups().find((g) => g.id === groupId)
      if (group) {
        const isSshEngine = conn.engine === 'SSH'
        const expectedCategory = isSshEngine ? 'ssh' : 'database'
        if (group.category !== expectedCategory) {
          return { success: false, message: '连接类型与分组类型不匹配' }
        }
      }
    }
    this.core.repository.setConnectionGroup(connectionId, groupId)
    return { success: true, message: groupId == null ? '已移至未分组' : '连接分组已更新' }
  }

  listSavedQueries(connectionId: number, databaseName: string): SavedQuery[] {
    if (!this.core.repository.getById(connectionId) || !databaseName.trim()) return []
    return this.core.repository.listSavedQueries(connectionId, databaseName)
  }

  saveQuery(input: SaveQueryInput): ConnectionActionResult {
    if (!this.core.repository.getById(input.connectionId)) return { success: false, message: '连接不存在' }
    if (!input.databaseName.trim()) return { success: false, message: '请先选择数据库' }
    if (!input.name.trim()) return { success: false, message: '请输入查询名称' }
    if (input.name.trim().length > 80) return { success: false, message: '查询名称不能超过 80 个字符' }
    if (!input.sql.trim()) return { success: false, message: 'SQL 语句不能为空' }
    try {
      this.core.repository.saveQuery({ ...input, name: input.name.trim() })
      return { success: true, message: '查询语句已保存' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  deleteSavedQuery(id: number, connectionId: number, databaseName: string): ConnectionActionResult {
    if (!this.core.repository.getById(connectionId)) return { success: false, message: '连接不存在' }
    if (!Number.isInteger(id) || id <= 0 || !databaseName.trim()) return { success: false, message: '查询记录参数不正确' }
    try {
      return this.core.repository.deleteSavedQuery(id, connectionId, databaseName)
        ? { success: true, message: '已保存的查询已删除' }
        : { success: false, message: '查询记录不存在或已被删除' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async create(input: CreateConnectionInput): Promise<ConnectionActionResult> {
    const validationMessage = this.core.validate(input)
    if (validationMessage) return { success: false, message: validationMessage }

    try {
      await this.metadata.readDatabases(input)
      const newId = this.core.repository.create(input)
      return { success: true, message: '连接已保存', connectionId: newId }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async updateColor(id: number, color: string): Promise<ConnectionActionResult> {
    try {
      this.core.repository.updateColor(id, color)
      return { success: true, message: '连接颜色已更新' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async updateEnvironment(id: number, environment: ConnectionEnvironment | null): Promise<ConnectionActionResult> {
    try {
      this.core.repository.updateEnvironment(id, environment)
      return { success: true, message: environment ? `环境标识已更新为 ${environment}` : '环境标识已清除' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async update(input: UpdateConnectionInput): Promise<ConnectionActionResult> {
    const validationMessage = this.core.validate(input)
    if (validationMessage) return { success: false, message: validationMessage }
    const existing = this.core.repository.getById(input.id)
    if (!existing) return { success: false, message: '连接不存在' }

    try {
      await this.core.closeRuntimeResources(existing)
      await this.metadata.readDatabases({
        ...input,
        password: input.password || existing.password,
        ssh: input.ssh ? {
          ...input.ssh,
          password: input.ssh.password || existing.sshPassword,
          passphrase: input.ssh.passphrase || existing.sshPassphrase
        } : input.ssh
      })
      this.core.repository.update(input)
      return { success: true, message: '连接已更新' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async open(id: number): Promise<ConnectionActionResult> {
    console.warn('[ConnectionService] open() called, id =', id)
    try {
      const connection = this.core.repository.getById(id)
      if (!connection) return { success: false, message: '连接不存在' }
      console.warn('[ConnectionService] open() connection loaded', { savePassword: connection.savePassword, hasPassword: !!connection.password })
      if (connection.savePassword && !connection.password) {
        console.error('[ConnectionService] 密码解密失败，拒绝以空密码建立连接')
        return { success: false, message: '密码解密失败，请重新保存连接密码后再试' }
      }
      const databases = await this.metadata.readDatabases(connection, { light: true })
      this.core.repository.replaceDatabaseStats(connection, databases)
      this.core.repository.setOpen(id, true)
      console.warn('[ConnectionService] open() success')
      return { success: true, message: '连接已打开' }
    } catch (error) {
      console.error('[ConnectionService] open() caught error', error)
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async close(id: number): Promise<ConnectionActionResult> {
    try {
      const connection = this.core.repository.getById(id)
      if (!connection) return { success: false, message: '连接不存在' }
      this.core.repository.setOpen(id, false)
      await this.core.closeRuntimeResources(connection)
      return { success: true, message: '连接已关闭' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  duplicate(id: number): ConnectionActionResult {
    try {
      const newId = this.core.repository.duplicate(id)
      return { success: true, message: '连接已复制', connectionId: newId }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async delete(id: number): Promise<ConnectionActionResult> {
    const connection = this.core.repository.getById(id)
    if (!connection) return { success: false, message: '连接不存在' }
    this.core.repository.delete(id)
    await this.core.closeRuntimeResources(connection)
    return { success: true, message: '连接已删除' }
  }

  async test(input: CreateConnectionInput): Promise<ConnectionActionResult> {
    const validationMessage = this.core.validate(input)
    if (validationMessage) return { success: false, message: validationMessage }

    try {
      await this.metadata.readDatabases(input)
      return { success: true, message: '连接成功' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async testUpdate(input: UpdateConnectionInput): Promise<ConnectionActionResult> {
    const existing = this.core.repository.getById(input.id)
    if (!existing) return { success: false, message: '连接不存在' }
    await this.core.closeRuntimeResources(existing)
    return this.test({
      ...input,
      password: input.password || existing.password,
      ssh: input.ssh ? {
        ...input.ssh,
        password: input.ssh.password || existing.sshPassword,
        passphrase: input.ssh.passphrase || existing.sshPassphrase
      } : input.ssh
    })
  }

  private async hydrateConnection(connection: StoredConnection): Promise<DatabaseConnection> {
    const color = connection.color || ENGINE_COLORS[connection.engine] || '#6b7280'
    const environment = connection.environment
    if (!connection.open) {
      return {
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        defaultDatabase: connection.defaultDatabase,
        databases: [],
        color,
        environment,
        connected: false,
        open: false,
        groupId: connection.groupId,
        groupName: connection.groupName,
        ...this.core.publicSecurity(connection)
      }
    }

    try {
      const databases = await this.metadata.readDatabases(connection, { light: true })
      this.core.repository.replaceDatabaseStats(connection, databases)
      return {
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        defaultDatabase: connection.defaultDatabase,
        databases,
        color,
        environment,
        connected: true,
        open: true,
        groupId: connection.groupId,
        groupName: connection.groupName,
        ...this.core.publicSecurity(connection)
      }
    } catch (error) {
      return {
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        defaultDatabase: connection.defaultDatabase,
        databases: [],
        color,
        environment,
        connected: false,
        open: true,
        groupId: connection.groupId,
        groupName: connection.groupName,
        error: this.core.errorMessage(error),
        ...this.core.publicSecurity(connection)
      }
    }
  }
}
