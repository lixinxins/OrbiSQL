import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, CaretDown, CaretRight, Database, Eye, EyeSlash, FolderOpen, Key, Plug, ShieldCheck, TerminalWindow, X } from '@phosphor-icons/react'
import type { ConnectionGroup, ConnectionProtocol, ConnectionSecurityFileKind, CreateConnectionInput, DatabaseConnection, SshConfig, SslConfig, UpdateConnectionInput } from '@/shared/connections'

interface ConnectionDialogProps {
  editingConnection?: DatabaseConnection | null
  onClose: () => void
  onSaved: (connectionId?: number) => void
}

const initialConnection: CreateConnectionInput = {
  name: '',
  engine: 'MySQL',
  host: 'localhost',
  port: 3306,
  username: 'root',
  password: '',
  defaultDatabase: '',
  savePassword: true,
  groupId: null,
  ssh: { enabled: false, host: '', port: 22, username: '', authType: 'password', password: '', privateKeyPath: '', passphrase: '' },
  ssl: { enabled: false, rejectUnauthorized: true, caPath: '', certPath: '', keyPath: '' }
}

const initialSshConnection: CreateConnectionInput = {
  name: '',
  engine: 'SSH',
  host: '',
  port: 22,
  username: 'root',
  password: '',
  defaultDatabase: '',
  savePassword: true,
  groupId: null,
  ssh: { enabled: true, host: '', port: 22, username: 'root', authType: 'password', password: '', privateKeyPath: '', passphrase: '' }
}

const engineDefaults: Partial<Record<ConnectionProtocol, Pick<CreateConnectionInput, 'host' | 'port' | 'username' | 'defaultDatabase'>>> = {
  MySQL: { host: 'localhost', port: 3306, username: 'root', defaultDatabase: '' },
  MariaDB: { host: 'localhost', port: 3306, username: 'root', defaultDatabase: '' },
  PostgreSQL: { host: 'localhost', port: 5432, username: 'postgres', defaultDatabase: 'postgres' },
  SQLite: { host: '', port: 0, username: '', defaultDatabase: '' },
  'SQL Server': { host: 'localhost', port: 1433, username: 'sa', defaultDatabase: 'master' },
  Oracle: { host: 'localhost', port: 1521, username: 'SYSTEM', defaultDatabase: 'ORCL' },
  TiDB: { host: 'localhost', port: 4000, username: 'root', defaultDatabase: 'test' },
  ClickHouse: { host: 'localhost', port: 8123, username: 'default', defaultDatabase: 'default' },
  MongoDB: { host: 'localhost', port: 27017, username: 'admin', defaultDatabase: 'admin' },
  Redis: { host: 'localhost', port: 6379, username: '', defaultDatabase: '0' },
  DuckDB: { host: '', port: 0, username: '', defaultDatabase: '' },
  Elasticsearch: { host: 'localhost', port: 9200, username: 'elastic', defaultDatabase: '' },
  达梦: { host: 'localhost', port: 5236, username: 'SYSDBA', defaultDatabase: '' },
  人大金仓: { host: 'localhost', port: 54321, username: 'SYSTEM', defaultDatabase: 'security' },
  SSH: { host: '', port: 22, username: 'root', defaultDatabase: '' }
}

function ConnectionDialog({ editingConnection, onClose, onSaved }: ConnectionDialogProps) {
  const editing = Boolean(editingConnection)
  const [connectionCategory, setConnectionCategory] = useState<'database' | 'ssh' | null>(() => {
    if (!editingConnection) return null
    return editingConnection.engine === 'SSH' ? 'ssh' : 'database'
  })
  const [connection, setConnection] = useState<CreateConnectionInput>(() => editingConnection
    ? {
        name: editingConnection.name,
        engine: editingConnection.engine as CreateConnectionInput['engine'],
        host: editingConnection.host,
        port: editingConnection.port,
        username: editingConnection.username,
        password: '',
        defaultDatabase: editingConnection.defaultDatabase,
        savePassword: true,
        color: editingConnection.color,
        groupId: editingConnection.groupId ?? null,
        ssh: editingConnection.ssh ?? initialConnection.ssh,
        ssl: editingConnection.ssl ?? initialConnection.ssl
      }
    : initialConnection)
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectingFile, setSelectingFile] = useState(false)
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null)
  const [sshExpanded, setSshExpanded] = useState(true)
  const [sslExpanded, setSslExpanded] = useState(true)
  const [groups, setGroups] = useState<ConnectionGroup[]>([])

  useEffect(() => { void window.omnidb.connections.listGroups().then(setGroups) }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const selectCategory = (category: 'database' | 'ssh'): void => {
    setConnectionCategory(category)
    if (category === 'ssh') {
      setConnection(initialSshConnection)
    } else {
      setConnection(initialConnection)
    }
    setFeedback(null)
  }

  const update = <Key extends keyof CreateConnectionInput>(
    key: Key,
    value: CreateConnectionInput[Key]
  ): void => {
    setConnection((current) => ({ ...current, [key]: value }))
    setFeedback(null)
  }

  const updateSsh = <KeyName extends keyof SshConfig>(key: KeyName, value: SshConfig[KeyName]): void => {
    setConnection((current) => ({ ...current, ssh: { ...initialConnection.ssh!, ...current.ssh, [key]: value } }))
    setFeedback(null)
  }

  const updateSsl = <KeyName extends keyof SslConfig>(key: KeyName, value: SslConfig[KeyName]): void => {
    setConnection((current) => ({ ...current, ssl: { ...initialConnection.ssl!, ...current.ssl, [key]: value } }))
    setFeedback(null)
  }

  const selectSecurityFile = async (kind: ConnectionSecurityFileKind, target: 'sshPrivateKeyPath' | 'sslCaPath' | 'sslCertPath' | 'sslKeyPath'): Promise<void> => {
    const path = await window.omnidb.connections.selectSecurityFile(kind)
    if (!path) return
    if (target === 'sshPrivateKeyPath') updateSsh('privateKeyPath', path)
    if (target === 'sslCaPath') updateSsl('caPath', path)
    if (target === 'sslCertPath') updateSsl('certPath', path)
    if (target === 'sslKeyPath') updateSsl('keyPath', path)
  }

  const testConnection = async (): Promise<void> => {
    setTesting(true)
    setFeedback(null)
    try {
      setFeedback(editingConnection
        ? await window.omnidb.connections.testUpdate({ ...connection, id: editingConnection.id })
        : await window.omnidb.connections.test(connection))
    } finally {
      setTesting(false)
    }
  }

  const selectSqliteFile = async (): Promise<void> => {
    setSelectingFile(true)
    setFeedback(null)
    try {
      if (!window.omnidb.connections.selectSqliteFile) {
        throw new Error('文件选择服务尚未加载，请重启 QuillDB 后重试')
      }
      const filePath = await window.omnidb.connections.selectSqliteFile(connection.engine)
      if (filePath) update('host', filePath)
    } catch (error) {
      setFeedback({
        success: false,
        message: error instanceof Error ? error.message : '无法打开文件选择窗口'
      })
    } finally {
      setSelectingFile(false)
    }
  }

  const saveConnection = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setFeedback(null)
    try {
      const result = editingConnection
        ? await window.omnidb.connections.update({ ...connection, id: editingConnection.id } as UpdateConnectionInput)
        : await window.omnidb.connections.create(connection)
      setFeedback(result)
      if (result.success) onSaved(result.connectionId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {connectionCategory === null ? (
        <div className="connection-dialog" onMouseDown={(e) => e.stopPropagation()}>
          <div className="dialog-header">
            <span className="dialog-icon"><Plug weight="fill" /></span>
            <div>
              <h2>创建连接</h2>
              <p>请选择您想要创建的连接类型</p>
            </div>
            <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><X /></button>
          </div>

          <div className="dialog-body connection-type-body">
            <div className="connection-type-grid">
              <div
                className="connection-type-card"
                role="button"
                tabIndex={0}
                onClick={() => selectCategory('database')}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && selectCategory('database')}
              >
                <div className="connection-type-card-header">
                  <span className="connection-card-icon database"><Database weight="fill" /></span>
                  <span className="connection-card-badge">数据管理</span>
                </div>
                <div className="connection-type-card-content">
                  <h3>数据库</h3>
                  <p>连接并管理 MySQL、PostgreSQL、SQLite 等主流关系型数据库。</p>
                </div>
                <div className="connection-type-card-footer">
                  <span>配置连接</span>
                  <CaretRight weight="bold" />
                </div>
              </div>

              <div
                className="connection-type-card ssh-card"
                role="button"
                tabIndex={0}
                onClick={() => selectCategory('ssh')}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && selectCategory('ssh')}
              >
                <div className="connection-type-card-header">
                  <span className="connection-card-icon ssh"><TerminalWindow weight="fill" /></span>
                  <span className="connection-card-badge ssh">远程终端</span>
                </div>
                <div className="connection-type-card-content">
                  <h3>SSH 客户端</h3>
                  <p>通过 SSH 协议连接远程 Linux 服务器，提供控制台终端与远程命令交互。</p>
                </div>
                <div className="connection-type-card-footer">
                  <span>配置 SSH 连接</span>
                  <CaretRight weight="bold" />
                </div>
              </div>
            </div>
          </div>

          <div className="dialog-footer">
            <span className="dialog-footer-spacer" />
            <button type="button" className="cancel-button" onClick={onClose}>取消</button>
          </div>
        </div>
      ) : connectionCategory === 'ssh' ? (
        <form className="connection-dialog" onSubmit={saveConnection}>
          <div className="dialog-header">
            {!editing && (
              <button type="button" className="icon-back-btn" onClick={() => setConnectionCategory(null)} title="返回选择连接类型">
                <ArrowLeft />
              </button>
            )}
            <span className="dialog-icon ssh"><TerminalWindow weight="fill" /></span>
            <div>
              <h2>{editing ? '编辑 SSH 客户端连接' : '新建 SSH 客户端连接'}</h2>
              <p>填写 SSH 远程服务器的主机与身份认证信息</p>
            </div>
            <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><X /></button>
          </div>

          <div className="dialog-body">
            {feedback && <div className={`form-feedback${feedback.success ? ' success' : ' error'}`}>{feedback.message}</div>}

            <label className="form-field">
              <span>连接名称</span>
              <input
                autoFocus
                value={connection.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="例如：阿里云生产 Linux 服务器"
              />
            </label>

            <label className="form-field">
              <span>连接分组</span>
              <select
                value={connection.groupId ?? ''}
                onChange={(event) => update('groupId', event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">未分组（默认）</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>

            <div className="form-grid">
              <label className="form-field host-field">
                <span>SSH 主机 / IP</span>
                <input
                  value={connection.host}
                  onChange={(event) => {
                    update('host', event.target.value)
                    updateSsh('host', event.target.value)
                  }}
                  placeholder="例如：192.168.1.100 或 server.example.com"
                />
              </label>

              <label className="form-field port-field">
                <span>端口</span>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={connection.port || 22}
                  onChange={(event) => {
                    const portVal = Number(event.target.value)
                    update('port', portVal)
                    updateSsh('port', portVal)
                  }}
                />
              </label>
            </div>

            <label className="form-field">
              <span>SSH 用户名</span>
              <input
                value={connection.username}
                onChange={(event) => {
                  update('username', event.target.value)
                  updateSsh('username', event.target.value)
                }}
                placeholder="root"
              />
            </label>

            <label className="form-field">
              <span>认证方式</span>
              <select
                value={connection.ssh?.authType ?? 'password'}
                onChange={(event) => updateSsh('authType', event.target.value as SshConfig['authType'])}
              >
                <option value="password">密码认证</option>
                <option value="privateKey">SSH 私钥文件认证</option>
              </select>
            </label>

            {connection.ssh?.authType === 'privateKey' ? (
              <>
                <label className="form-field">
                  <span>私钥文件</span>
                  <span className="sqlite-file-picker">
                    <input
                      readOnly
                      value={connection.ssh?.privateKeyPath ?? ''}
                      placeholder="选择私钥文件 (.pem, .key, .ppk)"
                    />
                    <button
                      type="button"
                      onClick={() => void selectSecurityFile('sshPrivateKey', 'sshPrivateKeyPath')}
                    >
                      <FolderOpen />选择文件
                    </button>
                  </span>
                </label>

                <label className="form-field">
                  <span>私钥密码（可选）</span>
                  <input
                    type="password"
                    value={connection.ssh?.passphrase ?? ''}
                    placeholder={editing ? '留空表示保留原私钥密码' : '若私钥设置了 Passphrase 请输入'}
                    onChange={(event) => updateSsh('passphrase', event.target.value)}
                  />
                </label>
              </>
            ) : (
              <label className="form-field">
                <span>SSH 登录密码</span>
                <span className="password-input">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={connection.password || connection.ssh?.password || ''}
                    onChange={(event) => {
                      update('password', event.target.value)
                      updateSsh('password', event.target.value)
                    }}
                    placeholder={editing ? '留空表示保留原密码' : '请输入 SSH 服务器登录密码'}
                  />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label="显示或隐藏密码">
                    {showPassword ? <EyeSlash /> : <Eye />}
                  </button>
                </span>
              </label>
            )}

          </div>

          <div className="dialog-footer">
            <button type="button" className="secondary-button" onClick={testConnection} disabled={testing || saving}>
              <Plug />{testing ? '正在测试…' : '测试连接'}
            </button>
            <span className="dialog-footer-spacer" />
            <button type="button" className="cancel-button" onClick={onClose}>取消</button>
            <button type="submit" className="save-button" disabled={testing || saving}>{saving ? '正在保存…' : editing ? '保存修改' : '保存 SSH 连接'}</button>
          </div>
        </form>
      ) : (
        <form className="connection-dialog" onSubmit={saveConnection}>
          <div className="dialog-header">
            {!editing && (
              <button type="button" className="icon-back-btn" onClick={() => setConnectionCategory(null)} title="返回选择连接类型">
                <ArrowLeft />
              </button>
            )}
            <span className="dialog-icon"><Database weight="fill" /></span>
            <div><h2>{editing ? '编辑数据库连接' : '新建数据库连接'}</h2><p>填写 {connection.engine} 的连接信息</p></div>
            <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><X /></button>
          </div>

          <div className="dialog-body">
            {feedback && <div className={`form-feedback${feedback.success ? ' success' : ' error'}`}>{feedback.message}</div>}

            <label className="form-field">
              <span>数据库类型</span>
              <select
                value={connection.engine}
                onChange={(event) => {
                  const engine = event.target.value as CreateConnectionInput['engine']
                  const isFileEngine = engine === 'SQLite' || engine === 'DuckDB'
                  setConnection((current) => ({
                    ...current,
                    engine,
                    ...(engineDefaults[engine] ?? {}),
                    savePassword: !isFileEngine,
                    ssh: { ...initialConnection.ssh!, ...current.ssh, enabled: isFileEngine ? false : current.ssh?.enabled ?? false },
                    ssl: { ...initialConnection.ssl!, ...current.ssl, enabled: isFileEngine ? false : current.ssl?.enabled ?? false }
                  }))
                  setFeedback(null)
                }}
              >
                <optgroup label="关系型数据库 (SQL)">
                  <option value="MySQL">MySQL</option>
                  <option value="PostgreSQL">PostgreSQL</option>
                  <option value="MariaDB">MariaDB</option>
                  <option value="SQL Server">SQL Server (MSSQL)</option>
                  <option value="Oracle">Oracle Database</option>
                  <option value="SQLite">SQLite (本地文件)</option>
                  <option value="TiDB">TiDB (分布式)</option>
                </optgroup>
                <optgroup label="国产数据库">
                  <option value="达梦">达梦数据库 (DM)</option>
                  <option value="人大金仓">人大金仓 (Kingbase)</option>
                </optgroup>
                <optgroup label="分析型 / NoSQL 数据库">
                  <option value="ClickHouse">ClickHouse (列式 OLAP 分析数据库)</option>
                  <option value="DuckDB">DuckDB (嵌入式 OLAP 分析数据库)</option>
                  <option value="Redis">Redis (内存键值分析)</option>
                  <option value="MongoDB">MongoDB (文档型 NoSQL 分析)</option>
                  <option value="Elasticsearch">Elasticsearch (搜索引擎 / 日志分析)</option>
                </optgroup>
              </select>
            </label>
            <label className="form-field">
              <span>连接名称</span>
              <input autoFocus value={connection.name} onChange={(event) => update('name', event.target.value)} placeholder={`例如：本地 ${connection.engine}`} />
            </label>
            <label className="form-field">
              <span>连接分组</span>
              <select value={connection.groupId ?? ''} onChange={(event) => update('groupId', event.target.value ? Number(event.target.value) : null)}>
                <option value="">未分组（默认）</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <div className={(connection.engine === 'SQLite' || connection.engine === 'DuckDB') ? '' : 'form-grid'}>
              <label className="form-field host-field">
                <span>{(connection.engine === 'SQLite' || connection.engine === 'DuckDB') ? '数据库文件路径' : '主机 / IP'}</span>
                {(connection.engine === 'SQLite' || connection.engine === 'DuckDB') ? (
                  <span className="sqlite-file-picker">
                    <input readOnly value={connection.host} placeholder={`请选择 ${connection.engine} 数据库文件`} title={connection.host} />
                    <button type="button" onClick={() => void selectSqliteFile()} disabled={selectingFile}>
                      <FolderOpen />{selectingFile ? '选择中…' : '选择文件'}
                    </button>
                  </span>
                ) : <input value={connection.host} onChange={(event) => update('host', event.target.value)} placeholder="localhost" />}
              </label>
              {connection.engine !== 'SQLite' && connection.engine !== 'DuckDB' && <label className="form-field port-field">
                <span>端口</span>
                <input type="number" min="1" max="65535" value={connection.port} onChange={(event) => update('port', Number(event.target.value))} />
              </label>}
            </div>
            {connection.engine !== 'SQLite' && connection.engine !== 'DuckDB' && <label className="form-field">
              <span>默认数据库 / SID / Schema</span>
              <input value={connection.defaultDatabase} onChange={(event) => update('defaultDatabase', event.target.value)} placeholder="留空或输入默认数据库" />
            </label>}
            {connection.engine !== 'SQLite' && connection.engine !== 'DuckDB' && <label className="form-field">
              <span>用户名</span>
              <input value={connection.username} onChange={(event) => update('username', event.target.value)} />
            </label>}
            {connection.engine !== 'SQLite' && connection.engine !== 'DuckDB' && <label className="form-field">
              <span>密码</span>
              <span className="password-input">
                <input type={showPassword ? 'text' : 'password'} value={connection.password} onChange={(event) => update('password', event.target.value)} placeholder={editing ? '留空表示继续使用原密码' : '请输入数据库密码'} />
                <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label="显示或隐藏密码">
                  {showPassword ? <EyeSlash /> : <Eye />}
                </button>
              </span>
            </label>}
            {connection.engine !== 'SQLite' && connection.engine !== 'DuckDB' && <label className="save-password">
              <input type="checkbox" checked={connection.savePassword} onChange={(event) => update('savePassword', event.target.checked)} />
              <span>安全保存密码</span>
            </label>}
            {connection.engine !== 'SQLite' && connection.engine !== 'DuckDB' && <section className={`connection-security-panel${connection.ssh?.enabled ? ' enabled' : ''}`}>
              <div className="connection-security-heading" role="button" tabIndex={0} onClick={() => setSshExpanded((current) => !current)} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setSshExpanded((current) => !current)}>
                {sshExpanded ? <CaretDown /> : <CaretRight />}<Key /><span><strong>SSH 隧道</strong><small>通过 SSH 转发数据库连接</small></span>
                <label className="security-switch" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={connection.ssh?.enabled ?? false} onChange={(event) => { updateSsh('enabled', event.target.checked); setSshExpanded(event.target.checked || sshExpanded) }} />
                  <i />
                </label>
              </div>
              {sshExpanded && <div className="connection-security-content">
                <div className="form-grid"><label className="form-field host-field"><span>SSH 主机</span><input value={connection.ssh?.host ?? ''} onChange={(event) => updateSsh('host', event.target.value)} /></label>
                  <label className="form-field port-field"><span>端口</span><input type="number" min="1" max="65535" value={connection.ssh?.port ?? 22} onChange={(event) => updateSsh('port', Number(event.target.value))} /></label></div>
                <label className="form-field"><span>SSH 用户名</span><input value={connection.ssh?.username ?? ''} onChange={(event) => updateSsh('username', event.target.value)} /></label>
                <label className="form-field"><span>认证方式</span><select value={connection.ssh?.authType ?? 'password'} onChange={(event) => updateSsh('authType', event.target.value as SshConfig['authType'])}><option value="password">密码</option><option value="privateKey">私钥文件</option></select></label>
                {connection.ssh?.authType === 'privateKey' ? <>
                  <label className="form-field"><span>私钥文件</span><span className="sqlite-file-picker"><input readOnly value={connection.ssh.privateKeyPath ?? ''} placeholder="选择私钥文件" /><button type="button" onClick={() => void selectSecurityFile('sshPrivateKey', 'sshPrivateKeyPath')}><FolderOpen />选择</button></span></label>
                  <label className="form-field"><span>私钥密码（可选）</span><input type="password" value={connection.ssh.passphrase ?? ''} placeholder={editing ? '留空表示保留原密码' : ''} onChange={(event) => updateSsh('passphrase', event.target.value)} /></label>
                </> : <label className="form-field"><span>SSH 密码</span><input type="password" value={connection.ssh?.password ?? ''} placeholder={editing ? '留空表示保留原密码' : ''} onChange={(event) => updateSsh('password', event.target.value)} /></label>}
              </div>}
            </section>}
            {connection.engine !== 'SQLite' && <section className={`connection-security-panel${connection.ssl?.enabled ? ' enabled' : ''}`}>
              <div className="connection-security-heading" role="button" tabIndex={0} onClick={() => setSslExpanded((current) => !current)} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setSslExpanded((current) => !current)}>
                {sslExpanded ? <CaretDown /> : <CaretRight />}<ShieldCheck /><span><strong>SSL/TLS</strong><small>加密客户端与数据库之间的连接</small></span>
                <label className="security-switch" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={connection.ssl?.enabled ?? false} onChange={(event) => { updateSsl('enabled', event.target.checked); setSslExpanded(event.target.checked || sslExpanded) }} /><i /></label>
              </div>
              {sslExpanded && <div className="connection-security-content">
                <label className="save-password"><input type="checkbox" checked={connection.ssl?.rejectUnauthorized === false} onChange={(event) => updateSsl('rejectUnauthorized', !event.target.checked)} /><span>跳过服务器证书验证（仅开发环境）</span></label>
                {([['CA 证书', 'sslCa', 'sslCaPath', 'caPath'], ['客户端证书', 'sslCert', 'sslCertPath', 'certPath'], ['客户端私钥', 'sslKey', 'sslKeyPath', 'keyPath']] as const).map(([label, kind, target, key]) => <label className="form-field" key={key}><span>{label}（可选）</span><span className="sqlite-file-picker"><input readOnly value={connection.ssl?.[key] ?? ''} /><button type="button" onClick={() => void selectSecurityFile(kind, target)}><FolderOpen />选择</button></span></label>)}
              </div>}
            </section>}
          </div>

          <div className="dialog-footer">
            <button type="button" className="secondary-button" onClick={testConnection} disabled={testing || saving || selectingFile}>
              <Plug />{testing ? '正在测试…' : '测试连接'}
            </button>
            <span className="dialog-footer-spacer" />
            <button type="button" className="cancel-button" onClick={onClose}>取消</button>
            <button type="submit" className="save-button" disabled={testing || saving || selectingFile}>{saving ? '正在保存…' : editing ? '保存修改' : '保存连接'}</button>
          </div>
        </form>
      )}
    </div>
  )
}

export default ConnectionDialog
