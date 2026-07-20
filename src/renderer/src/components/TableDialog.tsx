import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { BracketsCurly, CheckCircle, FloppyDisk, Key, Link, Plus, Table, Trash, WarningCircle } from '@phosphor-icons/react'
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
} from '../../../shared/connections'

interface TableDialogProps {
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
  'YEAR', 'BOOLEAN', 'JSON', 'ENUM', 'SET'
]

const initialColumn = (): TableColumnDefinition => ({
  name: 'id',
  type: 'BIGINT',
  length: '',
  decimals: '',
  notNull: true,
  primaryKey: true,
  comment: ''
})

function TableDialog({ active, connection, database, table, onSaved }: TableDialogProps) {
  const feedbackTimer = useRef<number | null>(null)
  const [activeTab, setActiveTab] = useState<TableTab>('fields')
  const [tableName, setTableName] = useState(table?.name ?? '')
  const [tableComment, setTableComment] = useState('')
  const [columns, setColumns] = useState<TableColumnDefinition[]>(table ? [] : [initialColumn()])
  const [indexes, setIndexes] = useState<TableIndexDefinition[]>([])
  const [foreignKeys, setForeignKeys] = useState<TableForeignKeyDefinition[]>([])
  const [loading, setLoading] = useState(Boolean(table))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

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
      setTableName(result.tableName ?? table.name)
      setTableComment(result.tableComment ?? '')
      setColumns(result.columns)
      setIndexes(result.indexes)
      setForeignKeys(result.foreignKeys)
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
    index: number,
    key: KeyName,
    value: TableColumnDefinition[KeyName]
  ): void => {
    setColumns((current) => current.map((column, columnIndex) =>
      columnIndex === index ? { ...column, [key]: value } : column))
  }

  const changeType = (index: number, type: MySQLColumnType): void => {
    const length = ['CHAR', 'VARCHAR'].includes(type) ? '255' : type === 'DECIMAL' ? '10' : ''
    const decimals = type === 'DECIMAL' ? '2' : ''
    setColumns((current) => current.map((column, columnIndex) =>
      columnIndex === index ? { ...column, type, typeDefinition: undefined, length, decimals } : column))
  }

  const updateIndex = <KeyName extends keyof TableIndexDefinition>(
    index: number,
    key: KeyName,
    value: TableIndexDefinition[KeyName]
  ): void => setIndexes((current) => current.map((item, itemIndex) =>
    itemIndex === index ? { ...item, [key]: value } : item))

  const updateForeignKey = <KeyName extends keyof TableForeignKeyDefinition>(
    index: number,
    key: KeyName,
    value: TableForeignKeyDefinition[KeyName]
  ): void => setForeignKeys((current) => current.map((item, itemIndex) =>
    itemIndex === index ? { ...item, [key]: value } : item))

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
      return `  ${quote(column.name)} ${previewType(column)} ${column.notNull || column.primaryKey ? 'NOT NULL' : 'NULL'}${connection.engine === 'MySQL' && column.comment ? ` COMMENT '${column.comment.replaceAll("'", "''")}'` : ''}`
    })
    const primary = columns.filter((column) => column.primaryKey)
    if (primary.length) definitions.push(`  PRIMARY KEY (${primary.map((column) => quote(column.name)).join(', ')})`)
    if (connection.engine === 'MySQL') indexes.forEach((index) => definitions.push(`  ${index.type === 'INDEX' ? 'KEY' : `${index.type} KEY`} ${quote(index.name)} (${index.columns.map(quote).join(', ')})`))
    foreignKeys.forEach((foreignKey) => definitions.push(
      `  CONSTRAINT ${quote(foreignKey.name)} FOREIGN KEY (${quote(foreignKey.column)}) REFERENCES ${quote(foreignKey.referencedTable)} (${quote(foreignKey.referencedColumn)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
    ))
    const tableReference = connection.engine === 'MySQL' ? `${quote(database.name)}.${quote(tableName)}` : quote(tableName)
    const commentSql = tableComment.replaceAll("'", "''")
    const createTable = `CREATE TABLE ${tableReference} (\n${definitions.join(',\n')}\n)${connection.engine === 'MySQL' ? ` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${tableComment ? ` COMMENT='${commentSql}'` : ''}` : ''};`
    const indexStatements = connection.engine === 'MySQL' ? [] : indexes.map((index) =>
      `CREATE ${index.type === 'UNIQUE' ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(tableName)} (${index.columns.map(quote).join(', ')});`)
    const tableCommentStatement = tableComment
      ? connection.engine === 'PostgreSQL'
        ? `COMMENT ON TABLE ${quote(tableName)} IS '${commentSql}';`
        : connection.engine === 'SQLite' ? `-- 表注释：${tableComment.replaceAll('\n', ' ')}` : ''
      : ''
    return [createTable, ...indexStatements, tableCommentStatement].filter(Boolean).join('\n')
  }, [columns, connection.engine, database.name, foreignKeys, indexes, tableComment, tableName])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current)
      feedbackTimer.current = null
    }
    setSaving(true)
    setError('')
    setSaveFeedback(null)
    let succeeded = false
    try {
      const input: CreateTableInput = {
        connectionId: connection.id,
        databaseName: database.name,
        tableName,
        tableComment,
        columns,
        indexes,
        foreignKeys
      }
      const result = table
        ? await window.omnidb.tables.update({ ...input, currentTableName: table.name } as UpdateTableInput)
        : await window.omnidb.tables.create(input)
      if (result.success) {
        succeeded = true
        setSaveFeedback({ type: 'success', message: result.message || '保存成功' })
        setSaving(false)
        onSaved(tableName)
        feedbackTimer.current = window.setTimeout(() => {
          setSaveFeedback(null)
          feedbackTimer.current = null
        }, 2000)
      } else {
        setSaveFeedback({ type: 'error', message: result.message || '保存失败' })
      }
    } catch (saveError) {
      setSaveFeedback({
        type: 'error',
        message: saveError instanceof Error ? saveError.message : '保存失败，请稍后重试'
      })
    } finally {
      if (!succeeded) setSaving(false)
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
              <div className="table-config-actions"><strong>字段设置</strong><button type="button" onClick={() => setColumns((current) => [...current, {
                name: '', type: 'VARCHAR', length: '255', decimals: '', notNull: false, primaryKey: false, comment: ''
              }])}><Plus />添加字段</button></div>
              <div className="table-grid-scroll">
                <div className="field-grid field-grid-header"><span>名称</span><span>类型</span><span>长度</span><span>小数点</span><span>不是空</span><span>主键</span><span>注释</span><span /></div>
                <div className="field-grid-body">
                  {columns.map((column, index) => (
                    <div className="field-grid" key={index}>
                      <input value={column.name} onChange={(event) => updateColumn(index, 'name', event.target.value)} placeholder="字段名称" />
                      <select value={column.type} onChange={(event) => changeType(index, event.target.value as MySQLColumnType)}>{columnTypes.map((type) => <option key={type}>{type}</option>)}</select>
                      <input value={column.length} disabled={!['CHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'DECIMAL'].includes(column.type)} onChange={(event) => { updateColumn(index, 'length', event.target.value); updateColumn(index, 'typeDefinition', undefined) }} placeholder="—" />
                    <input value={column.decimals} disabled={column.type !== 'DECIMAL'} onChange={(event) => { updateColumn(index, 'decimals', event.target.value); updateColumn(index, 'typeDefinition', undefined) }} placeholder="—" />
                      <label><input type="checkbox" checked={column.notNull} disabled={column.primaryKey} onChange={(event) => updateColumn(index, 'notNull', event.target.checked)} /></label>
                      <label><input type="checkbox" checked={column.primaryKey} onChange={(event) => updateColumn(index, 'primaryKey', event.target.checked)} /></label>
                      <input value={column.comment} onChange={(event) => updateColumn(index, 'comment', event.target.value)} placeholder="字段注释" />
                      <button type="button" className="remove-column" disabled={columns.length === 1} onClick={() => setColumns((current) => current.filter((_, columnIndex) => columnIndex !== index))}><Trash /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!loading && activeTab === 'indexes' && (
            <div className="table-config-panel">
              <div className="table-config-actions"><strong>索引设置</strong><button type="button" onClick={() => setIndexes((current) => [...current, { name: '', type: 'INDEX', columns: [] }])}><Plus />添加索引</button></div>
              <div className="table-grid-scroll">
                <div className="index-grid index-grid-header"><span>索引名称</span><span>索引类型</span><span>字段（多个字段使用逗号分隔）</span><span /></div>
                {indexes.map((index, indexNumber) => (
                  <div className="index-grid" key={indexNumber}>
                    <input value={index.name} onChange={(event) => updateIndex(indexNumber, 'name', event.target.value)} placeholder="例如：idx_name" />
                    <select value={index.type} onChange={(event) => updateIndex(indexNumber, 'type', event.target.value as TableIndexDefinition['type'])}><option>INDEX</option><option>UNIQUE</option><option>FULLTEXT</option></select>
                    <input value={index.columns.join(', ')} onChange={(event) => updateIndex(indexNumber, 'columns', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder={columns.map((column) => column.name).filter(Boolean).join(', ')} />
                    <button type="button" className="remove-column" onClick={() => setIndexes((current) => current.filter((_, itemIndex) => itemIndex !== indexNumber))}><Trash /></button>
                  </div>
                ))}
              </div>
              {!indexes.length && <div className="table-config-empty">暂未添加索引</div>}
            </div>
          )}

          {!loading && activeTab === 'foreignKeys' && (
            <div className="table-config-panel">
              <div className="table-config-actions"><strong>外键设置</strong><button type="button" onClick={() => setForeignKeys((current) => [...current, {
                name: '', column: columns[0]?.name ?? '', referencedTable: '', referencedColumn: '', onDelete: 'RESTRICT', onUpdate: 'RESTRICT'
              }])}><Plus />添加外键</button></div>
              <div className="table-grid-scroll">
                <div className="foreign-key-header"><span>名称</span><span>当前字段</span><span>引用表</span><span>引用字段</span><span>删除时</span><span>更新时</span><span /></div>
                {foreignKeys.map((foreignKey, index) => {
                  const referencedTable = database.tables.find((table) => table.name === foreignKey.referencedTable)
                  return <div className="foreign-key-grid" key={index}>
                    <input value={foreignKey.name} onChange={(event) => updateForeignKey(index, 'name', event.target.value)} placeholder="fk_name" />
                    <select value={foreignKey.column} onChange={(event) => updateForeignKey(index, 'column', event.target.value)}><option value="">选择字段</option>{columns.map((column) => <option key={column.name}>{column.name}</option>)}</select>
                    <select value={foreignKey.referencedTable} onChange={(event) => { updateForeignKey(index, 'referencedTable', event.target.value); updateForeignKey(index, 'referencedColumn', '') }}><option value="">选择表</option>{database.tables.map((table) => <option key={table.name}>{table.name}</option>)}</select>
                    <select value={foreignKey.referencedColumn} onChange={(event) => updateForeignKey(index, 'referencedColumn', event.target.value)}><option value="">选择字段</option>{referencedTable?.columns.map((column) => <option key={column}>{column}</option>)}</select>
                    <select value={foreignKey.onDelete} onChange={(event) => updateForeignKey(index, 'onDelete', event.target.value as TableForeignKeyDefinition['onDelete'])}><option>RESTRICT</option><option>CASCADE</option><option>SET NULL</option><option>NO ACTION</option></select>
                    <select value={foreignKey.onUpdate} onChange={(event) => updateForeignKey(index, 'onUpdate', event.target.value as TableForeignKeyDefinition['onUpdate'])}><option>RESTRICT</option><option>CASCADE</option><option>SET NULL</option><option>NO ACTION</option></select>
                    <button type="button" className="remove-column" onClick={() => setForeignKeys((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash /></button>
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
