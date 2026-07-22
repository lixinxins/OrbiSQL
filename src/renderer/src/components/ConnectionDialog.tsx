import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CaretDown, CaretRight, Database, Eye, EyeSlash, FolderOpen, Key, Plug, ShieldCheck, X } from '@phosphor-icons/react'
import type { ConnectionGroup, ConnectionSecurityFileKind, CreateConnectionInput, DatabaseConnection, SshConfig, SslConfig, UpdateConnectionInput } from '../../../shared/connections'

interface ConnectionDialogProps {
  editingConnection?: DatabaseConnection | null
  onClose: () => void
  onSaved: () => void
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

const engineDefaults: Record<CreateConnectionInput['engine'], Pick<CreateConnectionInput, 'host' | 'port' | 'username' | 'defaultDatabase'>> = {
  MySQL: { host: 'localhost', port: 3306, username: 'root', defaultDatabase: '' },
  PostgreSQL: { host: 'localhost', port: 5432, username: 'postgres', defaultDatabase: 'postgres' },
  SQLite: { host: '', port: 0, username: '', defaultDatabase: '' }
}

function ConnectionDialog({ editingConnection, onClose, onSaved }: ConnectionDialogProps) {
  const editing = Boolean(editingConnection)
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
  const [sshExpanded, setSshExpanded] = useState(Boolean(editingConnection?.ssh?.enabled))
  const [sslExpanded, setSslExpanded] = useState(Boolean(editingConnection?.ssl?.enabled))
  const [groups, setGroups] = useState<ConnectionGroup[]>([])

  useEffect(() => { void window.omnidb.connections.listGroups().then(setGroups) }, [])

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
        throw new Error('文件选择服务尚未加载，请重启 OrbiSQL 后重试')
      }
      const filePath = await window.omnidb.connections.selectSqliteFile()
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
      if (result.success) onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="connection-dialog" onSubmit={saveConnection}>
        <div className="dialog-header">
          <span className="dialog-icon"><Database weight="fill" /></span>
          <div><h2>{editing ? '编辑数据库连接' : '新建数据库连接'}</h2><p>填写 {connection.engine} 的连接信息</p></div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><X /></button>
        </div>

        <div className="dialog-body">
          <label className="form-field">
            <span>数据库类型</span>
            <select value={connection.engine} onChange={(event) => {
              const engine = event.target.value as CreateConnectionInput['engine']
              setConnection((current) => ({
                ...current, engine, ...engineDefaults[engine], savePassword: engine !== 'SQLite',
                ssh: { ...initialConnection.ssh!, ...current.ssh, enabled: engine === 'SQLite' ? false : current.ssh?.enabled ?? false },
                ssl: { ...initialConnection.ssl!, ...current.ssl, enabled: engine === 'SQLite' ? false : current.ssl?.enabled ?? false }
              }))
              setFeedback(null)
            }}>
              <option value="MySQL">MySQL</option>
              <option value="PostgreSQL">PostgreSQL</option>
              <option value="SQLite">SQLite</option>
            </select>
          </label>
          <label className="form-field">
            <span>连接名称</span>
            <input autoFocus value={connection.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：本地 MySQL" />
          </label>
          <label className="form-field">
            <span>连接分组</span>
            <select value={connection.groupId ?? ''} onChange={(event) => update('groupId', event.target.value ? Number(event.target.value) : null)}>
              <option value="">未分组（默认）</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <div className={connection.engine === 'SQLite' ? '' : 'form-grid'}>
            <label className="form-field host-field">
              <span>{connection.engine === 'SQLite' ? '数据库文件路径' : '主机'}</span>
              {connection.engine === 'SQLite' ? (
                <span className="sqlite-file-picker">
                  <input readOnly value={connection.host} placeholder="请选择 SQLite 数据库文件" title={connection.host} />
                  <button type="button" onClick={() => void selectSqliteFile()} disabled={selectingFile}>
                    <FolderOpen />{selectingFile ? '选择中…' : '选择文件'}
                  </button>
                </span>
              ) : <input value={connection.host} onChange={(event) => update('host', event.target.value)} placeholder="localhost" />}
            </label>
            {connection.engine !== 'SQLite' && <label className="form-field port-field">
              <span>端口</span>
              <input type="number" min="1" max="65535" value={connection.port} onChange={(event) => update('port', Number(event.target.value))} />
            </label>}
          </div>
          {connection.engine === 'PostgreSQL' && <label className="form-field">
            <span>默认数据库</span>
            <input value={connection.defaultDatabase} onChange={(event) => update('defaultDatabase', event.target.value)} placeholder="postgres" />
          </label>}
          {connection.engine !== 'SQLite' && <label className="form-field">
            <span>用户名</span>
            <input value={connection.username} onChange={(event) => update('username', event.target.value)} />
          </label>}
          {connection.engine !== 'SQLite' && <label className="form-field">
            <span>密码</span>
            <span className="password-input">
              <input type={showPassword ? 'text' : 'password'} value={connection.password} onChange={(event) => update('password', event.target.value)} placeholder={editing ? '留空表示继续使用原密码' : '请输入数据库密码'} />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label="显示或隐藏密码">
                {showPassword ? <EyeSlash /> : <Eye />}
              </button>
            </span>
          </label>}
          {connection.engine !== 'SQLite' && <label className="save-password">
            <input type="checkbox" checked={connection.savePassword} onChange={(event) => update('savePassword', event.target.checked)} />
            <span>安全保存密码</span>
          </label>}
          {connection.engine !== 'SQLite' && <section className={`connection-security-panel${connection.ssh?.enabled ? ' enabled' : ''}`}>
            <div className="connection-security-heading" role="button" tabIndex={0} onClick={() => setSshExpanded((current) => !current)} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setSshExpanded((current) => !current)}>
              {sshExpanded ? <CaretDown /> : <CaretRight />}<Key /><span><strong>SSH 隧道</strong><small>通过 SSH 转发数据库连接</small></span>
              <label className="security-switch" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={connection.ssh?.enabled ?? false} onChange={(event) => { updateSsh('enabled', event.target.checked); setSshExpanded(event.target.checked || sshExpanded) }} />
                <i />
              </label>
            </div>
            {sshExpanded && <div className="connection-security-content">
              <div className="form-grid"><label className="form-field host-field"><span>SSH 主机</span><input value={connection.ssh?.host ?? ''} onChange={(event) => updateSsh('host', event.target.value)} disabled={!connection.ssh?.enabled} /></label>
                <label className="form-field port-field"><span>端口</span><input type="number" min="1" max="65535" value={connection.ssh?.port ?? 22} onChange={(event) => updateSsh('port', Number(event.target.value))} disabled={!connection.ssh?.enabled} /></label></div>
              <label className="form-field"><span>SSH 用户名</span><input value={connection.ssh?.username ?? ''} onChange={(event) => updateSsh('username', event.target.value)} disabled={!connection.ssh?.enabled} /></label>
              <label className="form-field"><span>认证方式</span><select value={connection.ssh?.authType ?? 'password'} onChange={(event) => updateSsh('authType', event.target.value as SshConfig['authType'])} disabled={!connection.ssh?.enabled}><option value="password">密码</option><option value="privateKey">私钥文件</option></select></label>
              {connection.ssh?.authType === 'privateKey' ? <>
                <label className="form-field"><span>私钥文件</span><span className="sqlite-file-picker"><input readOnly value={connection.ssh.privateKeyPath ?? ''} placeholder="选择私钥文件" /><button type="button" onClick={() => void selectSecurityFile('sshPrivateKey', 'sshPrivateKeyPath')} disabled={!connection.ssh?.enabled}><FolderOpen />选择</button></span></label>
                <label className="form-field"><span>私钥密码（可选）</span><input type="password" value={connection.ssh.passphrase ?? ''} placeholder={editing ? '留空表示保留原密码' : ''} onChange={(event) => updateSsh('passphrase', event.target.value)} disabled={!connection.ssh?.enabled} /></label>
              </> : <label className="form-field"><span>SSH 密码</span><input type="password" value={connection.ssh?.password ?? ''} placeholder={editing ? '留空表示保留原密码' : ''} onChange={(event) => updateSsh('password', event.target.value)} disabled={!connection.ssh?.enabled} /></label>}
            </div>}
          </section>}
          {connection.engine !== 'SQLite' && <section className={`connection-security-panel${connection.ssl?.enabled ? ' enabled' : ''}`}>
            <div className="connection-security-heading" role="button" tabIndex={0} onClick={() => setSslExpanded((current) => !current)} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setSslExpanded((current) => !current)}>
              {sslExpanded ? <CaretDown /> : <CaretRight />}<ShieldCheck /><span><strong>SSL/TLS</strong><small>加密客户端与数据库之间的连接</small></span>
              <label className="security-switch" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={connection.ssl?.enabled ?? false} onChange={(event) => { updateSsl('enabled', event.target.checked); setSslExpanded(event.target.checked || sslExpanded) }} /><i /></label>
            </div>
            {sslExpanded && <div className="connection-security-content">
              <label className="save-password"><input type="checkbox" checked={connection.ssl?.rejectUnauthorized === false} onChange={(event) => updateSsl('rejectUnauthorized', !event.target.checked)} disabled={!connection.ssl?.enabled} /><span>跳过服务器证书验证（仅开发环境）</span></label>
              {([['CA 证书', 'sslCa', 'sslCaPath', 'caPath'], ['客户端证书', 'sslCert', 'sslCertPath', 'certPath'], ['客户端私钥', 'sslKey', 'sslKeyPath', 'keyPath']] as const).map(([label, kind, target, key]) => <label className="form-field" key={key}><span>{label}（可选）</span><span className="sqlite-file-picker"><input readOnly value={connection.ssl?.[key] ?? ''} /><button type="button" onClick={() => void selectSecurityFile(kind, target)} disabled={!connection.ssl?.enabled}><FolderOpen />选择</button></span></label>)}
            </div>}
          </section>}
          {feedback && <div className={`form-feedback${feedback.success ? ' success' : ' error'}`}>{feedback.message}</div>}
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
    </div>
  )
}

export default ConnectionDialog
