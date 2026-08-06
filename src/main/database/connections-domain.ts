import type { ConnectionEnvironment, CreateConnectionInput, UpdateConnectionInput } from '../../shared/connections'
import { sshTunnelManager } from '../services/ssh-tunnel-manager'
import type { SqliteDatabase } from '../services/sqlite-runtime'
import { decryptPassword, encryptPassword } from './password-crypto'

export interface StoredConnection {
  id: number
  name: string
  engine: CreateConnectionInput['engine']
  host: string
  port: number
  username: string
  defaultDatabase: string
  password: string
  savePassword: boolean
  open: boolean
  color?: string
  environment: ConnectionEnvironment | null
  groupId: number | null
  groupName: string
  sshEnabled: boolean
  sshHost: string
  sshPort: number
  sshUsername: string
  sshAuthType: 'password' | 'privateKey'
  sshPassword: string
  sshPrivateKeyPath: string
  sshPassphrase: string
  sslEnabled: boolean
  sslRejectUnauthorized: boolean
  sslCaPath: string
  sslCertPath: string
  sslKeyPath: string
  sortOrder: number
}

interface ConnectionRow {
  id: number
  name: string
  engine: CreateConnectionInput['engine']
  host: string
  port: number
  username: string
  database_name: string
  password_cipher: Uint8Array | null
  save_password: number
  is_open: number
  color: string | null
  environment: string | null
  group_id: number | null
  sort_order: number | null
  group_name: string | null
  ssh_enabled: number
  ssh_host: string
  ssh_port: number
  ssh_username: string
  ssh_auth_type: string
  ssh_password_cipher: Uint8Array | null
  ssh_private_key_path: string
  ssh_passphrase_cipher: Uint8Array | null
  ssl_enabled: number
  ssl_reject_unauthorized: number
  ssl_ca_path: string
  ssl_cert_path: string
  ssl_key_path: string
}

const CONNECTION_SELECT = `
  SELECT c.id, c.name, c.engine, c.host, c.port, c.username, c.database_name, c.password_cipher, c.save_password, c.is_open, c.color, c.environment,
    c.group_id, g.name AS group_name, COALESCE(c.sort_order, 0) AS sort_order,
    ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_type, ssh_password_cipher, ssh_private_key_path, ssh_passphrase_cipher,
    ssl_enabled, ssl_reject_unauthorized, ssl_ca_path, ssl_cert_path, ssl_key_path
  FROM saved_connections c LEFT JOIN connection_groups g ON g.id = c.group_id
`

export class ConnectionsRepository {
  constructor(private readonly database: SqliteDatabase) {}

  private mapRow(row: ConnectionRow): StoredConnection {
    return {
      id: Number(row.id),
      name: row.name,
      engine: row.engine,
      host: row.host,
      port: Number(row.port),
      username: row.username,
      defaultDatabase: row.database_name,
      password: decryptPassword(row.password_cipher) ?? '',
      savePassword: Boolean(row.save_password),
      open: Boolean(row.is_open),
      color: row.color || undefined,
      environment: (row.environment || null) as ConnectionEnvironment | null,
      groupId: row.group_id == null ? null : Number(row.group_id),
      groupName: row.group_name || '',
      sortOrder: Number(row.sort_order ?? 0),
      sshEnabled: Boolean(row.ssh_enabled),
      sshHost: row.ssh_host,
      sshPort: Number(row.ssh_port),
      sshUsername: row.ssh_username,
      sshAuthType: row.ssh_auth_type === 'privateKey' ? 'privateKey' : 'password',
      sshPassword: decryptPassword(row.ssh_password_cipher) ?? '',
      sshPrivateKeyPath: row.ssh_private_key_path,
      sshPassphrase: decryptPassword(row.ssh_passphrase_cipher) ?? '',
      sslEnabled: Boolean(row.ssl_enabled),
      sslRejectUnauthorized: Boolean(row.ssl_reject_unauthorized),
      sslCaPath: row.ssl_ca_path,
      sslCertPath: row.ssl_cert_path,
      sslKeyPath: row.ssl_key_path
    }
  }

  list(): StoredConnection[] {
    const rows = this.database
      .prepare(`
        ${CONNECTION_SELECT}
        ORDER BY COALESCE(g.name, ''), COALESCE(c.sort_order, 0) ASC, c.id ASC
      `)
      .all() as unknown as ConnectionRow[]

    return rows.map((row) => this.mapRow(row))
  }

  getById(id: number): StoredConnection | null {
    const row = this.database
      .prepare(`
        ${CONNECTION_SELECT}
        WHERE c.id = ?
      `)
      .get(id) as unknown as ConnectionRow | undefined

    if (!row) return null
    const tunnel = sshTunnelManager.getEndpoint(id)
    const mapped = this.mapRow(row)
    return tunnel ? { ...mapped, host: tunnel.localHost, port: tunnel.localPort } : mapped
  }

  create(input: CreateConnectionInput): number {
    const passwordCipher = input.savePassword && input.password
      ? encryptPassword(input.password)
      : null
    const sshPasswordCipher = input.ssh?.enabled && input.ssh.authType === 'password' && input.ssh.password
      ? encryptPassword(input.ssh.password)
      : null
    const sshPassphraseCipher = input.ssh?.enabled && input.ssh.authType === 'privateKey' && input.ssh.passphrase
      ? encryptPassword(input.ssh.passphrase)
      : null

    const result = this.database
      .prepare(`
        INSERT INTO saved_connections (
          name, engine, host, port, username, database_name, password_cipher, save_password, color, environment, group_id,
          ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_type, ssh_password_cipher, ssh_private_key_path, ssh_passphrase_cipher,
          ssl_enabled, ssl_reject_unauthorized, ssl_ca_path, ssl_cert_path, ssl_key_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.name.trim(),
        input.engine,
        input.host.trim(),
        input.port,
        input.username.trim(),
        input.defaultDatabase.trim(),
        passwordCipher,
        input.savePassword ? 1 : 0,
        input.color || '',
        input.environment ?? '',
        input.groupId ?? null,
        input.ssh?.enabled ? 1 : 0,
        input.ssh?.host.trim() || '',
        input.ssh?.port || 22,
        input.ssh?.username.trim() || '',
        input.ssh?.authType || 'password',
        sshPasswordCipher,
        input.ssh?.privateKeyPath?.trim() || '',
        sshPassphraseCipher,
        input.ssl?.enabled ? 1 : 0,
        input.ssl?.rejectUnauthorized === false ? 0 : 1,
        input.ssl?.caPath?.trim() || '',
        input.ssl?.certPath?.trim() || '',
        input.ssl?.keyPath?.trim() || ''
      )

    return Number(result.lastInsertRowid)
  }

  updateSortOrders(orders: Array<{ id: number; sortOrder: number }>): void {
    const stmt = this.database.prepare('UPDATE saved_connections SET sort_order = ? WHERE id = ?')
    this.database.exec('BEGIN TRANSACTION')
    try {
      for (const item of orders) {
        stmt.run(item.sortOrder, item.id)
      }
      this.database.exec('COMMIT')
    } catch (err) {
      this.database.exec('ROLLBACK')
      throw err
    }
  }

  updateColor(id: number, color: string): void {
    this.database.prepare('UPDATE saved_connections SET color=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(color, id)
  }

  updateEnvironment(id: number, environment: ConnectionEnvironment | null): void {
    this.database.prepare('UPDATE saved_connections SET environment=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(environment, id)
  }

  update(input: UpdateConnectionInput): void {
    const current = this.database.prepare(`
      SELECT password_cipher, ssh_password_cipher, ssh_passphrase_cipher FROM saved_connections WHERE id = ?
    `).get(input.id) as unknown as Pick<ConnectionRow, 'password_cipher' | 'ssh_password_cipher' | 'ssh_passphrase_cipher'> | undefined
    if (!current) throw new Error('连接不存在')
    const passwordCipher = !input.savePassword ? null : input.password ? encryptPassword(input.password) : current.password_cipher
    const sshPasswordCipher = !input.ssh?.enabled || input.ssh.authType !== 'password'
      ? null : input.ssh.password ? encryptPassword(input.ssh.password) : current.ssh_password_cipher
    const sshPassphraseCipher = !input.ssh?.enabled || input.ssh.authType !== 'privateKey'
      ? null : input.ssh.passphrase ? encryptPassword(input.ssh.passphrase) : current.ssh_passphrase_cipher
    this.database.prepare(`
      UPDATE saved_connections SET
        name=?,engine=?,host=?,port=?,username=?,database_name=?,password_cipher=?,save_password=?,color=?,environment=?,group_id=?,
        ssh_enabled=?,ssh_host=?,ssh_port=?,ssh_username=?,ssh_auth_type=?,ssh_password_cipher=?,ssh_private_key_path=?,ssh_passphrase_cipher=?,
        ssl_enabled=?,ssl_reject_unauthorized=?,ssl_ca_path=?,ssl_cert_path=?,ssl_key_path=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      input.name.trim(), input.engine, input.host.trim(), input.port, input.username.trim(), input.defaultDatabase.trim(),
      passwordCipher, input.savePassword ? 1 : 0, input.color || '', input.environment ?? '', input.groupId ?? null,
      input.ssh?.enabled ? 1 : 0, input.ssh?.host.trim() || '', input.ssh?.port || 22,
      input.ssh?.username.trim() || '', input.ssh?.authType || 'password', sshPasswordCipher,
      input.ssh?.privateKeyPath?.trim() || '', sshPassphraseCipher,
      input.ssl?.enabled ? 1 : 0, input.ssl?.rejectUnauthorized === false ? 0 : 1,
      input.ssl?.caPath?.trim() || '', input.ssl?.certPath?.trim() || '', input.ssl?.keyPath?.trim() || '', input.id
    )
  }

  setOpen(id: number, open: boolean): void {
    this.database.prepare(`
      UPDATE saved_connections SET is_open = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(open ? 1 : 0, id)
  }

  delete(id: number): void {
    this.database.prepare('DELETE FROM saved_connections WHERE id = ?').run(id)
  }

  duplicate(id: number): number {
    const source = this.database.prepare(`
      SELECT name, engine, host, port, username, database_name, password_cipher, save_password, color, environment, group_id,
        ssh_enabled,ssh_host,ssh_port,ssh_username,ssh_auth_type,ssh_password_cipher,ssh_private_key_path,ssh_passphrase_cipher,
        ssl_enabled,ssl_reject_unauthorized,ssl_ca_path,ssl_cert_path,ssl_key_path
      FROM saved_connections WHERE id = ?
    `).get(id) as unknown as Omit<ConnectionRow, 'id' | 'is_open'> | undefined
    if (!source) throw new Error('连接不存在')

    const existingNames = new Set(
      (this.database.prepare('SELECT name FROM saved_connections').all() as unknown as Array<{ name: string }>)
        .map((row) => row.name)
    )
    let copyName = `${source.name} 副本`
    let suffix = 2
    while (existingNames.has(copyName)) copyName = `${source.name} 副本 ${suffix++}`

    const result = this.database.prepare(`
      INSERT INTO saved_connections (
        name, engine, host, port, username, database_name, password_cipher, save_password, color, environment, group_id,
        ssh_enabled,ssh_host,ssh_port,ssh_username,ssh_auth_type,ssh_password_cipher,ssh_private_key_path,ssh_passphrase_cipher,
        ssl_enabled,ssl_reject_unauthorized,ssl_ca_path,ssl_cert_path,ssl_key_path,is_open
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      copyName, source.engine, source.host, source.port, source.username, source.database_name,
      source.password_cipher, source.save_password, source.color, source.environment, source.group_id,
      source.ssh_enabled, source.ssh_host, source.ssh_port, source.ssh_username, source.ssh_auth_type,
      source.ssh_password_cipher, source.ssh_private_key_path, source.ssh_passphrase_cipher,
      source.ssl_enabled, source.ssl_reject_unauthorized, source.ssl_ca_path, source.ssl_cert_path, source.ssl_key_path
    )
    return Number(result.lastInsertRowid)
  }
}
