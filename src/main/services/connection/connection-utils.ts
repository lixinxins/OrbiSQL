import type {
  ConnectionProtocol,
  CreateConnectionInput,
  DatabaseConnection,
  DatabaseDefinitionInput
} from '../../../shared/connections'
import type { StoredConnection } from '../../database/connection-repository'

const MYSQL_COLOR = '#f3a83b'

export const isMysqlFamily = (engine: string): boolean => engine === 'MySQL' || engine === 'MariaDB' || engine === 'TiDB'

export const ENGINE_COLORS: Partial<Record<ConnectionProtocol, string>> = {
  MySQL: MYSQL_COLOR,
  PostgreSQL: '#336791',
  SQLite: '#4c9ac0',
  'SQL Server': '#cc2929',
  MongoDB: '#47A248',
  ClickHouse: '#ffcc00',
  Redis: '#dc382d',
  '达梦': '#0072c6',
  '人大金仓': '#e60012',
  SSH: '#818cf8'
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '数据库连接失败'
  const msg = error.message || ''

  // ── SSH 隧道错误 ─────────────────────────────────────
  if (msg.includes('Authentication failed')) return 'SSH 认证失败，请检查用户名、密码或密钥'
  if (msg.includes('All configured authentication methods failed')) return 'SSH 所有认证方式均失败，请检查用户名、密码或密钥是否正确'
  if (msg.includes('connect ECONNREFUSED') || msg.includes('Connection refused')) return 'SSH 连接被拒绝，请检查 SSH 服务是否可用'
  if (msg.includes('Timed out while waiting for handshake')) return 'SSH 连接超时，请检查网络和 SSH 配置'

  if ('code' in error) {
    const code = String((error as { code?: string }).code)
    // ── 网络层 ──────────────────────────────────────────
    if (code === 'ECONNREFUSED') return '无法连接数据库，请确认数据库服务已启动且主机、端口正确'
    if (code === 'ETIMEDOUT' || code === 'HANDSHAKE_TIMEOUT') return '连接数据库超时，请检查网络或防火墙设置'
    if (code === 'ENOTFOUND') return '找不到数据库主机，请检查主机名是否正确'
    if (code === 'EHOSTUNREACH') return '无法访问数据库主机，请检查网络和路由'
    if (code === 'ECONNRESET') return '数据库连接被重置，请重试或检查网络稳定性'
    if (code === 'ECONNABORTED') return '数据库连接被中断，请重试'

    // ── MySQL / MariaDB ─────────────────────────────────
    if (code === 'ER_ACCESS_DENIED_ERROR') return 'MySQL 用户名或密码错误'
    if (code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR') return 'MySQL 不允许无密码登录，请设置密码'
    if (code === 'ER_BAD_DB_ERROR') return 'MySQL 数据库不存在'
    if (code === 'ER_DBACCESS_DENIED_ERROR') return 'MySQL 用户无权访问该数据库'

    // ── PostgreSQL ──────────────────────────────────────
    if (code === '28P01') return 'PostgreSQL 用户名或密码错误'
    if (code === '3D000') return 'PostgreSQL 默认数据库不存在'
    if (code === '28000') return 'PostgreSQL 拒绝连接，请检查 pg_hba.conf 配置'
    if (code === '57P03') return 'PostgreSQL 数据库尚未就绪，请稍后重试'

    // ── SQLite ──────────────────────────────────────────
    if (code === 'SQLITE_CANTOPEN') return '无法打开 SQLite 数据库文件，请检查路径和文件权限'
    if (code === 'SQLITE_NOTADB') return '指定的文件不是有效的 SQLite 数据库'

    // ── SQL Server ────────────────────────────────────
    if (code === 'ELOGIN') return 'SQL Server 登录失败，请检查用户名或密码'
    if (code === 'ERTLSCONNECT') return 'SQL Server 连接超时，请检查网络或服务是否启动'
    if (code === 'ECONNECTION') return 'SQL Server 无法建立连接，请确认主机和端口正确'

    // ── MongoDB ────────────────────────────────────
    if (code === 'MongoServerError' || code === 'MongoNetworkError') return 'MongoDB 连接失败，请检查主机地址和端口'
    if (code === 'MongoAuthError') return 'MongoDB 认证失败，请检查用户名或密码'

    // ── ClickHouse ────────────────────────────────────
    if (code === 'ECONNREFUSED') return 'ClickHouse 连接被拒绝，请检查服务是否启动'
    if (code === 'ETIMEOUT') return 'ClickHouse 连接超时，请检查网络或服务状态'

    // ── Redis ────────────────────────────────────
    if (code === 'ECONNREFUSED') return 'Redis 连接被拒绝，请检查服务是否启动'
    if (code === 'ETIMEDOUT') return 'Redis 连接超时，请检查网络或服务状态'
    if (code === 'WRONGPASS') return 'Redis 密码错误，请检查密码配置'

    // ── 达梦 / 人大金仓 ────────────────────────────────────
    if (code === '28P01') return '数据库认证失败，请检查用户名或密码'
    if (code === '3D000') return '指定的数据库不存在'

    // ── SSL / TLS ──────────────────────────────────────
    if (code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || code === 'CERT_HAS_EXPIRED' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'SSL 证书验证失败，请检查证书配置或关闭 SSL'
  }

  // ── 兜底：返回精简后的原始消息 ──────────────────────
  if (msg.length > 200) return '数据库连接失败：' + msg.slice(0, 200) + '…'
  return msg || '数据库连接失败，请检查连接配置'
}

export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``
}

export function quoteIdentifierForEngine(engine: StoredConnection['engine'], identifier: string): string {
  if (engine === 'PostgreSQL' || engine === 'DuckDB' || engine === 'SQL Server') return `"${identifier.replaceAll('"', '""')}"`
  return quoteIdentifier(identifier)
}

export function quoteString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

export function validate(input: CreateConnectionInput): string | null {
  if (!input.name.trim()) return '请输入连接名称'
  if (input.engine === 'SSH') {
    if (!input.host.trim()) return '请输入 SSH 主机地址'
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) return 'SSH 端口必须在 1 至 65535 之间'
    if (!input.username.trim()) return '请输入 SSH 用户名'
    const authType = input.ssh?.authType ?? 'password'
    if (authType === 'privateKey' && !input.ssh?.privateKeyPath?.trim()) return '请选择 SSH 私钥文件'
    return null
  }
  if (!input.host.trim()) return (input.engine === 'SQLite' || input.engine === 'DuckDB') ? '请输入数据库文件路径' : '请输入主机地址'
  if (input.engine !== 'SQLite' && input.engine !== 'DuckDB' && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) return '端口必须在 1 至 65535 之间'
  if (input.engine !== 'SQLite' && input.engine !== 'DuckDB' && !input.username.trim()) return '请输入用户名'
  if (input.engine === 'PostgreSQL' && !input.defaultDatabase.trim()) return '请输入默认数据库'
  if (input.ssh?.enabled) {
    if (!input.ssh.host.trim()) return '请输入 SSH 主机'
    if (!Number.isInteger(input.ssh.port) || input.ssh.port < 1 || input.ssh.port > 65535) return 'SSH 端口必须在 1 至 65535 之间'
    if (!input.ssh.username.trim()) return '请输入 SSH 用户名'
    if (input.ssh.authType === 'privateKey' && !input.ssh.privateKeyPath?.trim()) return '请选择 SSH 私钥文件'
  }
  return null
}

export function validateDatabaseDefinition(input: DatabaseDefinitionInput): string | null {
  if (!input.name.trim()) return '请输入数据库名称'
  if (input.name.length > 64) return '数据库名称不能超过 64 个字符'
  if (!/^[A-Za-z0-9_]+$/.test(input.charset)) return '字符集格式不正确'
  if (!/^[A-Za-z0-9_]+$/.test(input.collation)) return '排序规则格式不正确'
  return null
}

export function storedInput(input: CreateConnectionInput, id = -1): StoredConnection {
  return {
    id,
    name: input.name,
    engine: input.engine,
    host: input.host,
    port: input.port,
    username: input.username,
    defaultDatabase: input.defaultDatabase,
    password: input.password,
    savePassword: input.savePassword,
    open: true,
    color: input.color,
    environment: input.environment ?? null,
    groupId: input.groupId ?? null,
    groupName: '',
    sortOrder: 0,
    sshEnabled: Boolean(input.ssh?.enabled),
    sshHost: input.ssh?.host || '',
    sshPort: input.ssh?.port || 22,
    sshUsername: input.ssh?.username || '',
    sshAuthType: input.ssh?.authType || 'password',
    sshPassword: input.ssh?.password || '',
    sshPrivateKeyPath: input.ssh?.privateKeyPath || '',
    sshPassphrase: input.ssh?.passphrase || '',
    sslEnabled: Boolean(input.ssl?.enabled),
    sslRejectUnauthorized: input.ssl?.rejectUnauthorized !== false,
    sslCaPath: input.ssl?.caPath || '',
    sslCertPath: input.ssl?.certPath || '',
    sslKeyPath: input.ssl?.keyPath || ''
  }
}

export function publicSecurity(connection: StoredConnection): Pick<DatabaseConnection, 'ssh' | 'ssl'> {
  return {
    ssh: {
      enabled: connection.sshEnabled,
      host: connection.sshHost,
      port: connection.sshPort,
      username: connection.sshUsername,
      authType: connection.sshAuthType,
      password: '',
      privateKeyPath: connection.sshPrivateKeyPath,
      passphrase: ''
    },
    ssl: {
      enabled: connection.sslEnabled,
      rejectUnauthorized: connection.sslRejectUnauthorized,
      caPath: connection.sslCaPath,
      certPath: connection.sslCertPath,
      keyPath: connection.sslKeyPath
    }
  }
}
