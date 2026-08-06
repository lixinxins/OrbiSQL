import type { CreateConnectionInput, DatabaseConnection, DatabaseDefinitionInput } from '../../../shared/connections'
import { ConnectionRepository, type StoredConnection } from '../../database/connection-repository'
import { deleteCursorsForConnection } from '../query-cursor-manager'
import { sshTunnelManager } from '../ssh-tunnel-manager'
import { engineEntryOrNull } from '../engine-registry'
import {
  errorMessage,
  publicSecurity,
  quoteIdentifier,
  quoteIdentifierForEngine,
  quoteString,
  storedInput,
  validate,
  validateDatabaseDefinition
} from './connection-utils'

/**
 * 连接服务共享运行时核心：仓库引用 + 跨域通用工具。
 * 连接生命周期、查询执行、元数据读取、进程列表与工作台统计
 * 各模块均基于该核心协作，避免重复实现。
 */
export class ConnectionCore {
  constructor(public readonly repository: ConnectionRepository) {}

  errorMessage(error: unknown): string {
    return errorMessage(error)
  }

  quoteIdentifier(identifier: string): string {
    return quoteIdentifier(identifier)
  }

  quoteIdentifierForEngine(engine: StoredConnection['engine'], identifier: string): string {
    return quoteIdentifierForEngine(engine, identifier)
  }

  quoteString(value: string): string {
    return quoteString(value)
  }

  validate(input: CreateConnectionInput): string | null {
    return validate(input)
  }

  validateDatabaseDefinition(input: DatabaseDefinitionInput): string | null {
    return validateDatabaseDefinition(input)
  }

  storedInput(input: CreateConnectionInput, id = -1): StoredConnection {
    return storedInput(input, id)
  }

  publicSecurity(connection: StoredConnection): Pick<DatabaseConnection, 'ssh' | 'ssl'> {
    return publicSecurity(connection)
  }

  async prepareRuntimeConnection(connection: StoredConnection, key: string | number = connection.id): Promise<StoredConnection> {
    const endpoint = await sshTunnelManager.ensureTunnel(key, connection)
    return connection.sshEnabled
      ? { ...connection, host: endpoint.localHost, port: endpoint.localPort, sslServerName: connection.host } as StoredConnection
      : connection
  }

  runtimeConnection(connection: StoredConnection): StoredConnection {
    const endpoint = sshTunnelManager.getEndpoint(connection.id)
    return endpoint
      ? { ...connection, host: endpoint.localHost, port: endpoint.localPort, sslServerName: connection.host } as StoredConnection
      : connection
  }

  /**
   * 关闭一个保存连接关联的全部运行时资源。
   * 编辑连接前必须先清理，否则连接测试会命中旧地址、旧密码或旧 TLS 配置的缓存。
   */
  async closeRuntimeResources(connection: StoredConnection): Promise<void> {
    const workerPrefix = connection.id > 0
      ? `id:${connection.id}`
      : `${connection.host}:${connection.port}:${connection.username}`
    sshTunnelManager.closeTunnel(connection.id)
    deleteCursorsForConnection(connection.id)
    const entry = engineEntryOrNull(connection.engine)
    if (entry?.closeResources) {
      await Promise.allSettled([entry.closeResources(connection, workerPrefix)])
    }
  }
}
