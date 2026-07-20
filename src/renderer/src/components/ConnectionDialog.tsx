import { useState } from 'react'
import type { FormEvent } from 'react'
import { Database, Eye, EyeSlash, FolderOpen, Plug, X } from '@phosphor-icons/react'
import type { CreateConnectionInput, DatabaseConnection, UpdateConnectionInput } from '../../../shared/connections'

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
  savePassword: true
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
        savePassword: true
      }
    : initialConnection)
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectingFile, setSelectingFile] = useState(false)
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null)

  const update = <Key extends keyof CreateConnectionInput>(
    key: Key,
    value: CreateConnectionInput[Key]
  ): void => {
    setConnection((current) => ({ ...current, [key]: value }))
    setFeedback(null)
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
              setConnection((current) => ({ ...current, engine, ...engineDefaults[engine], savePassword: engine !== 'SQLite' }))
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
