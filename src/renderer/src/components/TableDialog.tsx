import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BracketsCurly,
  CheckCircle,
  Clock,
  FloppyDisk,
  Key,
  Link,
  Plus,
  Table,
  Trash,
  User,
  WarningCircle
} from '@phosphor-icons/react'
import type {
  CreateTableInput,
  DatabaseConnection,
  DatabaseItem,
  MySQLColumnType,
  TableColumnDefinition,
  TableForeignKeyDefinition,
  TableIndexDefinition,
  TableItem,
  UpdateTableInput
} from '@/shared/connections'
import SearchableSelect, { SearchableOption } from './SearchableSelect'
import { useTableDesignerTabsStore } from '../stores/tabs/useTableDesignerTabs'

/** 给列表项附加前端专用的稳定 ID，避免数组 index 作为 key 导致 reorder 时状态错位 */
type WithId<T> = T & { _id: string }
const uid = (): string => crypto.randomUUID()

interface TableDialogProps {
  id: string
  active: boolean
  connection: DatabaseConnection
  database: DatabaseItem
  table?: TableItem
  onSaved: (tableName: string) => void
}

type TableTab = 'fields' | 'indexes' | 'foreignKeys' | 'sql'

const columnTypes: MySQLColumnType[] = [
  'CHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT',
  'DECIMAL', 'FLOAT', 'DOUBLE', 'BIT', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'DATETIME', 'TIMESTAMP', 'DATE', 'TIME',
  'YEAR', 'BOOLEAN', 'JSON', 'ENUM', 'SET',
  'UUID', 'JSONB', 'INET', 'CIDR', 'MACADDR', 'BYTEA', 'HSTORE'
]

const columnTypeOptions: SearchableOption[] = columnTypes.map((type) => ({
  value: type,
  label: type,
  keywords: ['INT', 'BIGINT', 'VARCHAR', 'DATETIME', 'TINYINT', 'DECIMAL', 'TEXT', 'JSON', 'UUID', 'JSONB', 'INET'].includes(type) ? '常用 PG PostgreSQL' : ''
}))

const initialColumn = (): WithId<TableColumnDefinition> => ({
  _id: uid(),
  name: 'id',
  type: 'BIGINT',
  length: '',
  decimals: '',
  notNull: true,
  primaryKey: true,
  autoIncrement: true,
  comment: '主键 ID'
})

function TableDialog({ id, active, connection, database, table, onSaved }: TableDialogProps) {
  const feedbackTimer = useRef<number | null>(null)
  const initialSnapshotRef = useRef<string>('')
  const isLoadedRef = useRef<boolean>(!table)
  const [activeTab, setActiveTab] = useState<TableTab>('fields')
  const [tableName, setTableName] = useState(table?.name ?? '')
  const [tableComment, setTableComment] = useState('')
  const [tableEngine, setTableEngine] = useState('InnoDB')
  const [tableCharset, setTableCharset] = useState('utf8mb4')
  const [tableCollation, setTableCollation] = useState('utf8mb4_general_ci')
  const [columns, setColumns] = useState<WithId<TableColumnDefinition>[]>(table ? [] : [initialColumn()])
  const [indexes, setIndexes] = useState<WithId<TableIndexDefinition>[]>([])
  const [foreignKeys, setForeignKeys] = useState<WithId<TableForeignKeyDefinition>[]>([])
  const [loading, setLoading] = useState(Boolean(table))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const getSnapshot = useCallback(() => {
    const stripId = <T extends { _id: string }>(items: T[]): Omit<T, '_id'>[] =>
      items.map(({ _id: _, ...rest }) => rest)
    return JSON.stringify({
      tableName: tableName.trim(),
      tableComment: tableComment.trim(),
      tableEngine,
      tableCharset,
      tableCollation,
      columns: stripId(columns),
      indexes: stripId(indexes),
      foreignKeys: stripId(foreignKeys)
    })
  }, [columns, foreignKeys, indexes, tableCharset, tableCollation, tableComment, tableEngine, tableName])

  useEffect(() => {
    if (!table) {
      initialSnapshotRef.current = getSnapshot()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
  }, [])

  useEffect(() => {
    if (!table) return
    let cancelled = false
    setLoading(true)
    void window.omnidb.tables.getDefinition(connection.id, database.name, table.name).then((result) => {
      if (cancelled) return
      if (!result.success || !result.columns || !result.indexes || !result.foreignKeys) {
        setError(result.message)
        setSaveFeedback({ type: 'error', message: result.message })
        return
      }
      const loadedCols = result.columns.map((c) => ({ ...c, _id: uid() }))
      const loadedIdxs = result.indexes.map((i) => ({ ...i, _id: uid() }))
      const loadedFks = result.foreignKeys.map((fk) => ({ ...fk, _id: uid() }))
      const loadedName = result.tableName ?? table.name
      const loadedComment = result.tableComment ?? ''
      setTableName(loadedName)
      setTableComment(loadedComment)
      setColumns(loadedCols)
      setIndexes(loadedIdxs)
      setForeignKeys(loadedFks)

      const stripId = <T extends { _id: string }>(items: T[]): Omit<T, '_id'>[] =>
        items.map(({ _id: _, ...rest }) => rest)
      initialSnapshotRef.current = JSON.stringify({
        tableName: loadedName.trim(),
        tableComment: loadedComment.trim(),
        tableEngine: 'InnoDB',
        tableCharset: 'utf8mb4',
        tableCollation: 'utf8mb4_general_ci',
        columns: stripId(loadedCols),
        indexes: stripId(loadedIdxs),
        foreignKeys: stripId(loadedFks)
      })
      isLoadedRef.current = true
    }).catch((loadError: unknown) => {
      if (!cancelled) {
        const message = loadError instanceof Error ? loadError.message : '表结构加载失败'
        setError(message)
        setSaveFeedback({ type: 'error', message })
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [connection.id, database.name, table])

  const updateColumn = <KeyName extends keyof TableColumnDefinition>(
    id: string,
    key: KeyName,
    value: TableColumnDefinition[KeyName]
  ): void => {
    setColumns((current) => current.map((column) =>
      column._id === id ? { ...column, [key]: value } : column))
  }

  const changeType = (id: string, type: MySQLColumnType): void => {
    const length = ['CHAR', 'VARCHAR'].includes(type) ? '255' : type === 'DECIMAL' ? '10' : ''
    const decimals = type === 'DECIMAL' ? '2' : ''
    setColumns((current) => current.map((column) =>
      column._id === id ? { ...column, type, typeDefinition: undefined, length, decimals } : column))
  }

  const moveColumnUp = (index: number): void => {
    if (index <= 0) return
    setColumns((current) => {
      const next = [...current]
      const temp = next[index - 1]
      next[index - 1] = next[index]
      next[index] = temp
      return next
    })
  }

  const moveColumnDown = (index: number): void => {
    if (index >= columns.length - 1) return
    setColumns((current) => {
      const next = [...current]
      const temp = next[index + 1]
      next[index + 1] = next[index]
      next[index] = temp
      return next
    })
  }

  const addPresetAuditColumns = (): void => {
    setColumns((current) => [
      ...current,
      { _id: uid(), name: 'created_at', type: 'DATETIME', length: '', decimals: '', notNull: true, primaryKey: false, defaultValue: 'CURRENT_TIMESTAMP', comment: '创建时间' },
      { _id: uid(), name: 'updated_at', type: 'DATETIME', length: '', decimals: '', notNull: true, primaryKey: false, defaultValue: 'CURRENT_TIMESTAMP', comment: '更新时间' }
    ])
  }

  const addPresetSoftDeleteColumn = (): void => {
    setColumns((current) => [
      ...current,
      { _id: uid(), name: 'is_deleted', type: 'TINYINT', length: '1', decimals: '', notNull: true, primaryKey: false, defaultValue: '0', comment: '是否逻辑删除: 0未删除, 1已删除' }
    ])
  }

  const addPresetOperatorColumns = (): void => {
    setColumns((current) => [
      ...current,
      { _id: uid(), name: 'created_by', type: 'BIGINT', length: '', decimals: '', notNull: false, primaryKey: false, defaultValue: null, comment: '创建人 ID' },
      { _id: uid(), name: 'updated_by', type: 'BIGINT', length: '', decimals: '', notNull: false, primaryKey: false, defaultValue: null, comment: '更新人 ID' }
    ])
  }

  const updateIndex = <KeyName extends keyof TableIndexDefinition>(
    id: string,
    key: KeyName,
    value: TableIndexDefinition[KeyName]
  ): void => setIndexes((current) => current.map((item) =>
    item._id === id ? { ...item, [key]: value } : item))

  const handleIndexColumnsChange = (id: string, selectedCols: string[]): void => {
    setIndexes((current) => current.map((item) => {
      if (item._id !== id) return item
      const typePrefix = item.type === 'UNIQUE' ? 'uk_' : 'idx_'
      const autoName = selectedCols.length ? `${typePrefix}${selectedCols.join('_')}` : item.name
      return {
        ...item,
        columns: selectedCols,
        name: !item.name || item.name.startsWith('idx_') || item.name.startsWith('uk_') ? autoName : item.name
      }
    }))
  }

  const updateForeignKey = <KeyName extends keyof TableForeignKeyDefinition>(
    id: string,
    key: KeyName,
    value: TableForeignKeyDefinition[KeyName]
  ): void => setForeignKeys((current) => current.map((item) =>
    item._id === id ? { ...item, [key]: value } : item))

  const sqlPreview = useMemo(() => {
    const quote = (value: string): string => connection.engine === 'PostgreSQL'
      ? `"${(value || '未命名').replaceAll('"', '""')}"`
      : `\`${value || '未命名'}\``

    const previewType = (column: TableColumnDefinition): string => {
      if (connection.engine === 'MySQL') {
        let type = column.typeDefinition ?? column.type
        if (!column.typeDefinition && ['CHAR', 'VARCHAR', 'BINARY', 'VARBINARY'].includes(column.type) && column.length) type += `(${column.length})`
        if (!column.typeDefinition && column.type === 'DECIMAL' && column.length) type += `(${column.length},${column.decimals || '0'})`
        return type
      }
      if (connection.engine === 'SQLite') {
        if (['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'YEAR', 'BOOLEAN', 'BIT'].includes(column.type)) return 'INTEGER'
        if (column.type === 'DECIMAL') return 'NUMERIC'
        if (['FLOAT', 'DOUBLE'].includes(column.type)) return 'REAL'
        if (['BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'].includes(column.type)) return 'BLOB'
        return 'TEXT'
      }
      const postgresTypes: Partial<Record<MySQLColumnType, string>> = {
        TINYINT: 'SMALLINT', MEDIUMINT: 'INTEGER', INT: 'INTEGER', DOUBLE: 'DOUBLE PRECISION',
        TINYTEXT: 'TEXT', MEDIUMTEXT: 'TEXT', LONGTEXT: 'TEXT', TINYBLOB: 'BYTEA', BLOB: 'BYTEA',
        MEDIUMBLOB: 'BYTEA', LONGBLOB: 'BYTEA', BINARY: 'BYTEA', VARBINARY: 'BYTEA',
        DATETIME: 'TIMESTAMP', YEAR: 'SMALLINT', JSON: 'JSONB', ENUM: 'TEXT', SET: 'TEXT'
      }
      if (['CHAR', 'VARCHAR'].includes(column.type)) return `${column.type}(${column.length || '255'})`
      if (column.type === 'DECIMAL') return `DECIMAL(${column.length || '10'},${column.decimals || '0'})`
      return postgresTypes[column.type] ?? column.type
    }

    const definitions = columns.map((column) => {
      let def = `  ${quote(column.name)} ${previewType(column)} ${column.notNull || column.primaryKey ? 'NOT NULL' : 'NULL'}`
      if (column.autoIncrement && connection.engine === 'MySQL') def += ' AUTO_INCREMENT'
      if (column.defaultValue !== undefined && column.defaultValue !== null && column.defaultValue !== '') {
        const valUpper = column.defaultValue.toUpperCase()
        if (valUpper === 'NULL' || valUpper === 'CURRENT_TIMESTAMP' || valUpper.includes('()')) {
          def += ` DEFAULT ${column.defaultValue}`
        } else {
          def += ` DEFAULT '${column.defaultValue.replaceAll("'", "''")}'`
        }
      }
      if (connection.engine === 'MySQL' && column.comment) def += ` COMMENT '${column.comment.replaceAll("'", "''")}'`
      return def
    })

    const primary = columns.filter((column) => column.primaryKey)
    if (primary.length) definitions.push(`  PRIMARY KEY (${primary.map((column) => quote(column.name)).join(', ')})`)
    if (connection.engine === 'MySQL') indexes.forEach((index) => definitions.push(`  ${index.type === 'INDEX' ? 'KEY' : `${index.type} KEY`} ${quote(index.name)} (${index.columns.map(quote).join(', ')})`))
    foreignKeys.forEach((foreignKey) => definitions.push(
      `  CONSTRAINT ${quote(foreignKey.name)} FOREIGN KEY (${quote(foreignKey.column)}) REFERENCES ${quote(foreignKey.referencedTable)} (${quote(foreignKey.referencedColumn)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
    ))

    const tableReference = connection.engine === 'MySQL' ? `${quote(database.name)}.${quote(tableName)}` : quote(tableName)
    const commentSql = tableComment.replaceAll("'", "''")
    const createTable = `CREATE TABLE ${tableReference} (\n${definitions.join(',\n')}\n)${connection.engine === 'MySQL' ? ` ENGINE=${tableEngine} DEFAULT CHARSET=${tableCharset} COLLATE=${tableCollation}${tableComment ? ` COMMENT='${commentSql}'` : ''}` : ''};`
    const indexStatements = connection.engine === 'MySQL' ? [] : indexes.map((index) =>
      `CREATE ${index.type === 'UNIQUE' ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(tableName)} (${index.columns.map(quote).join(', ')});`)
    const tableCommentStatement = tableComment
      ? connection.engine === 'PostgreSQL'
        ? `COMMENT ON TABLE ${quote(tableName)} IS '${commentSql}';`
        : connection.engine === 'SQLite' ? `-- 表注释：${tableComment.replaceAll('\n', ' ')}` : ''
      : ''
    return [createTable, ...indexStatements, tableCommentStatement].filter(Boolean).join('\n')
  }, [columns, connection.engine, database.name, foreignKeys, indexes, tableCharset, tableCollation, tableComment, tableEngine, tableName])

  const performSave = useCallback(async (): Promise<boolean> => {
    setError('')
    setSaveFeedback(null)

    if (!tableName.trim()) {
      const msg = '数据表名称不能为空'
      setError(msg)
      setSaveFeedback({ type: 'error', message: msg })
      return false
    }

    if (columns.length === 0) {
      const msg = '数据表至少需要包含一个字段'
      setError(msg)
      setSaveFeedback({ type: 'error', message: msg })
      return false
    }

    if (columns.some((c) => !c.name.trim())) {
      const msg = '数据表中存在未填写的字段名称'
      setError(msg)
      setSaveFeedback({ type: 'error', message: msg })
      return false
    }

    setSaving(true)
    try {
      const stripId = <T extends { _id: string }>(items: T[]): Omit<T, '_id'>[] =>
        items.map(({ _id: _, ...rest }) => rest)
      const input: CreateTableInput = {
        connectionId: connection.id,
        databaseName: database.name,
        tableName: tableName.trim(),
        tableComment,
        columns: stripId(columns),
        indexes: stripId(indexes),
        foreignKeys: stripId(foreignKeys)
      }
      const result = table
        ? await window.omnidb.tables.update({ ...input, currentTableName: table.name } as UpdateTableInput)
        : await window.omnidb.tables.create(input)
      if (result.success) {
        setSaveFeedback({ type: 'success', message: result.message || '保存成功' })
        setSaving(false)
        initialSnapshotRef.current = getSnapshot()
        useTableDesignerTabsStore.getState().setTabDirty(id, false)
        onSaved(tableName.trim())
        return true
      } else {
        const msg = result.message || '保存失败'
        setError(msg)
        setSaveFeedback({ type: 'error', message: msg })
        setSaving(false)
        return false
      }
    } catch (saveError) {
      const msg = saveError instanceof Error ? saveError.message : '保存失败，请稍后重试'
      setError(msg)
      setSaveFeedback({ type: 'error', message: msg })
      setSaving(false)
      return false
    }
  }, [columns, connection.id, database.name, foreignKeys, getSnapshot, id, indexes, onSaved, table, tableComment, tableName])

  const performSaveRef = useRef(performSave)
  performSaveRef.current = performSave

  useEffect(() => {
    if (!isLoadedRef.current) return
    const currentSnapshot = getSnapshot()
    const isDirty = currentSnapshot !== initialSnapshotRef.current
    useTableDesignerTabsStore.getState().setTabDirty(id, isDirty, () => performSaveRef.current())
  }, [getSnapshot, id])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current)
      feedbackTimer.current = null
    }
    const ok = await performSave()
    if (ok) {
      feedbackTimer.current = window.setTimeout(() => {
        setSaveFeedback(null)
        feedbackTimer.current = null
      }, 2000)
    }
  }

  const tabs: Array<{ key: TableTab; label: string; icon: ReactNode; count?: number }> = [
    { key: 'fields', label: '字段', icon: <Table />, count: columns.length },
    { key: 'indexes', label: '索引', icon: <Key />, count: indexes.length },
    { key: 'foreignKeys', label: '外键', icon: <Link />, count: foreignKeys.length },
    { key: 'sql', label: 'SQL 预览', icon: <BracketsCurly /> }
  ]

  return (
    <form className={`table-designer${active ? ' active' : ''}`} onSubmit={submit}>
      <div className="table-designer-context">
        <span>{connection.name}</span><i>/</i><strong>{database.name}</strong>{table && <><i>/</i><strong>{table.name}</strong></>}
      </div>
      <div className="table-name-row">
        <div className="table-identity-fields">
          <label><span>表名称</span><input autoFocus value={tableName} onChange={(event) => setTableName(event.target.value)} placeholder="请输入表名称" /></label>
          <label><span>表注释</span><input value={tableComment} onChange={(event) => setTableComment(event.target.value)} placeholder="请输入表用途说明（可选）" /></label>
          {connection.engine === 'MySQL' && (
            <>
              <label>
                <span>存储引擎</span>
                <select value={tableEngine} onChange={(e) => setTableEngine(e.target.value)}>
                  <option value="InnoDB">InnoDB</option>
                  <option value="MyISAM">MyISAM</option>
                  <option value="MEMORY">MEMORY</option>
                </select>
              </label>
              <label>
                <span>字符集</span>
                <select value={tableCharset} onChange={(e) => setTableCharset(e.target.value)}>
                  <option value="utf8mb4">utf8mb4</option>
                  <option value="utf8mb3">utf8mb3</option>
                  <option value="latin1">latin1</option>
                </select>
              </label>
              <label>
                <span>排序规则</span>
                <select value={tableCollation} onChange={(e) => setTableCollation(e.target.value)}>
                  <option value="utf8mb4_general_ci">utf8mb4_general_ci</option>
                  <option value="utf8mb4_unicode_ci">utf8mb4_unicode_ci</option>
                  <option value="utf8mb4_bin">utf8mb4_bin</option>
                </select>
              </label>
            </>
          )}
        </div>
        {saveFeedback && <div className={`table-save-feedback ${saveFeedback.type}`} role="status" aria-live="polite" title={saveFeedback.message}>
          {saveFeedback.type === 'success' ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
          <span>{saveFeedback.message}</span>
        </div>}
        <button type="submit" className="table-save-button" disabled={saving || loading}>
          {saveFeedback?.type === 'success' ? <CheckCircle weight="fill" /> : <FloppyDisk />}
          {saveFeedback?.type === 'success' ? '保存成功' : saving ? '正在保存…' : '保存'}
        </button>
      </div>
      <div className="table-tabs">
        {tabs.map((tab) => (
          <button type="button" className={activeTab === tab.key ? 'active' : ''} key={tab.key} onClick={() => setActiveTab(tab.key)}>
            {tab.icon}{tab.label}{tab.count !== undefined && <span>{tab.count}</span>}
          </button>
        ))}
      </div>
      <div className="table-dialog-body">
          {loading && <div className="table-designer-loading">正在读取表结构…</div>}
          {!loading && activeTab === 'fields' && (
            <div className="table-config-panel">
              <div className="table-config-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                <strong>字段设置</strong>
                <button type="button" onClick={() => setColumns((current) => [...current, {
                  _id: uid(), name: '', type: 'VARCHAR', length: '255', decimals: '', notNull: false, primaryKey: false, comment: ''
                }])}><Plus />添加字段</button>

                <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />

                <button type="button" className="action-btn" title="快捷插入 created_at, updated_at 字段" onClick={addPresetAuditColumns}>
                  <Clock />+ 审计时间 (created_at/updated_at)
                </button>
                <button type="button" className="action-btn" title="快捷插入 is_deleted 字段" onClick={addPresetSoftDeleteColumn}>
                  <Trash />+ 软删除 (is_deleted)
                </button>
                <button type="button" className="action-btn" title="快捷插入 created_by, updated_by 字段" onClick={addPresetOperatorColumns}>
                  <User />+ 操作人 (created_by/updated_by)
                </button>
              </div>

              <div className="table-grid-scroll">
                <div className="field-grid field-grid-header">
                  <span>名称</span><span>类型</span><span>长度</span><span>小数</span><span>默认值</span><span>非空</span><span>主键</span><span>自增</span><span>注释</span><span>操作</span>
                </div>
                <div className="field-grid-body">
                  {columns.map((column, index) => (
                    <div className="field-grid" key={column._id}>
                      <input value={column.name} onChange={(event) => updateColumn(column._id, 'name', event.target.value)} placeholder="字段名称" />
                      <SearchableSelect
                        value={column.type}
                        options={columnTypeOptions}
                        placeholder="类型"
                        onChange={(val) => changeType(column._id, val as MySQLColumnType)}
                      />
                      <input value={column.length} disabled={!['CHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'DECIMAL'].includes(column.type)} onChange={(event) => { updateColumn(column._id, 'length', event.target.value); updateColumn(column._id, 'typeDefinition', undefined) }} placeholder="—" />
                      <input value={column.decimals} disabled={column.type !== 'DECIMAL'} onChange={(event) => { updateColumn(column._id, 'decimals', event.target.value); updateColumn(column._id, 'typeDefinition', undefined) }} placeholder="—" />
                      <input value={column.defaultValue ?? ''} onChange={(event) => updateColumn(column._id, 'defaultValue', event.target.value)} placeholder="默认值 (如 0, NULL)" />
                      <label style={{ display: 'grid', placeItems: 'center' }}><input type="checkbox" checked={column.notNull} disabled={column.primaryKey} onChange={(event) => updateColumn(column._id, 'notNull', event.target.checked)} /></label>
                      <label style={{ display: 'grid', placeItems: 'center' }}><input type="checkbox" checked={column.primaryKey} onChange={(event) => updateColumn(column._id, 'primaryKey', event.target.checked)} /></label>
                      <label style={{ display: 'grid', placeItems: 'center' }}><input type="checkbox" checked={Boolean(column.autoIncrement)} disabled={!['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'].includes(column.type)} onChange={(event) => updateColumn(column._id, 'autoIncrement', event.target.checked)} /></label>
                      <input value={column.comment} onChange={(event) => updateColumn(column._id, 'comment', event.target.value)} placeholder="字段注释" />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <button type="button" className="remove-column" disabled={index === 0} title="向上移动" onClick={() => moveColumnUp(index)}><ArrowUp /></button>
                        <button type="button" className="remove-column" disabled={index === columns.length - 1} title="向下移动" onClick={() => moveColumnDown(index)}><ArrowDown /></button>
                        <button type="button" className="remove-column" disabled={columns.length === 1} title="删除字段" onClick={() => setColumns((current) => current.filter((c) => c._id !== column._id))}><Trash /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!loading && activeTab === 'indexes' && (
            <div className="table-config-panel">
              <div className="table-config-actions"><strong>索引设置</strong><button type="button" onClick={() => setIndexes((current) => [...current, { _id: uid(), name: '', type: 'INDEX', columns: [] }])}><Plus />添加索引</button></div>
              <div className="table-grid-scroll">
                <div className="index-grid index-grid-header"><span>索引名称</span><span>索引类型</span><span>字段（多个字段使用逗号分隔）</span><span /></div>
                {indexes.map((index) => (
                  <div className="index-grid" key={index._id}>
                    <input value={index.name} onChange={(event) => updateIndex(index._id, 'name', event.target.value)} placeholder="自动生成或自定义名称" />
                    <select value={index.type} onChange={(event) => updateIndex(index._id, 'type', event.target.value as TableIndexDefinition['type'])}><option>INDEX</option><option>UNIQUE</option><option>FULLTEXT</option></select>
                    <input value={index.columns.join(', ')} onChange={(event) => handleIndexColumnsChange(index._id, event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder={columns.map((column) => column.name).filter(Boolean).join(', ')} />
                    <button type="button" className="remove-column" onClick={() => setIndexes((current) => current.filter((item) => item._id !== index._id))}><Trash /></button>
                  </div>
                ))}
              </div>
              {!indexes.length && <div className="table-config-empty">暂未添加索引</div>}
            </div>
          )}

          {!loading && activeTab === 'foreignKeys' && (
            <div className="table-config-panel">
              <div className="table-config-actions"><strong>外键设置</strong><button type="button" onClick={() => setForeignKeys((current) => [...current, {
                _id: uid(), name: '', column: columns[0]?.name ?? '', referencedTable: '', referencedColumn: '', onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
              }])}><Plus />添加外键</button></div>
              <div className="table-grid-scroll">
                <div className="foreign-key-header"><span>名称</span><span>当前字段</span><span>引用表</span><span>引用字段</span><span>删除时</span><span>更新时</span><span /></div>
                {foreignKeys.map((foreignKey) => {
                  const referencedTable = database.tables.find((tableItem) => tableItem.name === foreignKey.referencedTable)
                  return <div className="foreign-key-grid" key={foreignKey._id}>
                    <input value={foreignKey.name} onChange={(event) => updateForeignKey(foreignKey._id, 'name', event.target.value)} placeholder="fk_name" />
                    <select value={foreignKey.column} onChange={(event) => updateForeignKey(foreignKey._id, 'column', event.target.value)}><option value="">选择字段</option>{columns.map((column) => <option key={column.name}>{column.name}</option>)}</select>
                    <select value={foreignKey.referencedTable} onChange={(event) => { updateForeignKey(foreignKey._id, 'referencedTable', event.target.value); updateForeignKey(foreignKey._id, 'referencedColumn', '') }}><option value="">选择表</option>{database.tables.map((tableItem) => <option key={tableItem.name}>{tableItem.name}</option>)}</select>
                    <select value={foreignKey.referencedColumn} onChange={(event) => updateForeignKey(foreignKey._id, 'referencedColumn', event.target.value)}><option value="">选择字段</option>{referencedTable?.columns.map((col) => <option key={col.name}>{col.name}</option>)}</select>
                    <select value={foreignKey.onDelete} onChange={(event) => updateForeignKey(foreignKey._id, 'onDelete', event.target.value as TableForeignKeyDefinition['onDelete'])}><option>RESTRICT</option><option>CASCADE</option><option>SET NULL</option><option>NO ACTION</option></select>
                    <select value={foreignKey.onUpdate} onChange={(event) => updateForeignKey(foreignKey._id, 'onUpdate', event.target.value as TableForeignKeyDefinition['onUpdate'])}><option>RESTRICT</option><option>CASCADE</option><option>SET NULL</option><option>NO ACTION</option></select>
                    <button type="button" className="remove-column" onClick={() => setForeignKeys((current) => current.filter((item) => item._id !== foreignKey._id))}><Trash /></button>
                  </div>
                })}
              </div>
              {!foreignKeys.length && <div className="table-config-empty">暂未添加外键</div>}
            </div>
          )}

          {!loading && activeTab === 'sql' && <pre className="create-table-preview">{sqlPreview}</pre>}
          {error && <div className="form-feedback error table-create-error">{error}</div>}
      </div>
    </form>
  )
}

export default TableDialog
