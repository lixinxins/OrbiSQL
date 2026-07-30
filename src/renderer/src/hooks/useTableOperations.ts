import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useDialogStore, useQueryTabsStore, useTableDesignerTabsStore } from '../stores'
import { useDocTabsStore } from '../stores/tabs/useDocTabs'
import { useConfirmDialog } from '../components/ConfirmDialog'

export function useTableOperations() {
  const { confirm, confirmDialog } = useConfirmDialog()
  const connActions = useConnectionStore((s) => s.actions)
  const addQueryTab = useQueryTabsStore((s) => s.addQueryTab)
  const updateTableDialog = useTableDesignerTabsStore((s) => s.updateTableDialog)
  const dialogActions = useDialogStore((s) => s.actions)
  const renameTableDialog = useDialogStore((s) => s.renameTableDialog)
  const renameTableName = useDialogStore((s) => s.renameTableName)
  const renamingTable = useDialogStore((s) => s.renamingTable)

  const handleDeleteTable = async (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem
  ): Promise<void> => {
    const confirmed = await confirm({
      title: '永久删除数据表',
      message: `确定要删除数据表"${table.name}"吗？`,
      detail: `数据库"${database.name}"中的表结构和全部数据都会被永久删除，此操作无法撤销。`,
      confirmLabel: '永久删除'
    })
    if (!confirmed) return
    const result = await window.omnidb.tables.delete(connection.id, database.name, table.name)
    if (!result.success) window.alert(result.message)
    if (result.success) await connActions.refreshConnection(connection.id)
  }

  const handleTruncateTable = async (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem
  ): Promise<void> => {
    const confirmed = await confirm({
      title: '清空数据表',
      message: `确定要清空数据表"${table.name}"吗？`,
      detail: '表结构会保留，但表中的全部记录都会被永久删除，此操作无法撤销。',
      confirmLabel: '确认清空'
    })
    if (!confirmed) return
    const result = await window.omnidb.tables.truncate(connection.id, database.name, table.name)
    if (!result.success) window.alert(result.message)
    if (result.success) await connActions.refreshConnection(connection.id)
  }

  const handleCopyTable = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem,
    includeData: boolean
  ): void => {
    dialogActions.setCopyTableDialog({ connection, database, table, includeData })
  }

  const handleRenameTable = async (
    renameTableInTabs: (oldName: string, newName: string, connectionId: number, databaseName: string) => void
  ): Promise<void> => {
    if (!renameTableDialog || renamingTable) return
    const newTableName = renameTableName.trim()
    if (!newTableName) {
      dialogActions.setRenameTableError('请输入新的表名称')
      return
    }

    const { connection, database, table } = renameTableDialog
    dialogActions.setRenamingTable(true)
    dialogActions.setRenameTableError('')
    const result = await window.omnidb.tables.rename({
      connectionId: connection.id,
      databaseName: database.name,
      currentTableName: table.name,
      newTableName
    })
    dialogActions.setRenamingTable(false)
    if (!result.success) {
      dialogActions.setRenameTableError(result.message)
      return
    }

    renameTableInTabs(table.name, newTableName, connection.id, database.name)
    dialogActions.setRenameTableDialog(null)
    await connActions.loadConnections()
  }

  const handleTableSaved = async (id: string, tableName: string): Promise<void> => {
    updateTableDialog(id, {
      name: tableName,
      columns: [],
      indexes: [],
      foreignKeys: [],
      checks: [],
      triggers: []
    } as TableItem)
    await connActions.loadConnections()
  }

  const handleConnectionSaved = async (): Promise<void> => {
    dialogActions.setShowConnectionDialog(false)
    dialogActions.setEditingConnection(null)
    await connActions.loadConnections()
  }

  const handleDatabaseSaved = async (): Promise<void> => {
    dialogActions.setDatabaseDialog(null)
    await connActions.loadConnections()
  }

  const handleImportTable = async (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem
  ): Promise<void> => {
    const res = await window.omnidb.tables.previewImport(connection.id, database.name, table.name)
    if (res.canceled) return
    if (!res.success) {
      window.alert(res.message || '数据文件解析失败')
      return
    }
    dialogActions.setImportPreviewData(res)
  }

  const handleExportTable = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem
  ): void => {
    dialogActions.setExportDataDialog({ connection, database, table })
  }

  const handleGenerateSql = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem,
    sqlKind: 'select' | 'insert' | 'update' | 'delete' | 'ddl',
    schemaName?: string
  ): void => {
    const isDoubleQuoteEngine =
      connection.engine === 'PostgreSQL' ||
      connection.engine === 'Oracle' ||
      connection.engine === '人大金仓' ||
      connection.engine === '达梦' ||
      connection.engine === 'SQLite' ||
      connection.engine === 'DuckDB'

    const isSqlServer = connection.engine === 'SQL Server'
    const q = (identifier: string) => {
      if (isSqlServer) return `[${identifier}]`
      if (isDoubleQuoteEngine) return `"${identifier}"`
      return `\`${identifier}\``
    }

    const schemaPrefix = schemaName ? `${q(schemaName)}.` : ''
    const qualifiedTable = `${schemaPrefix}${q(table.name)}`

    const columns = table.columns ?? []
    const firstColName = columns[0]?.name || 'id'
    let initialSql = ''
    let title = ''

    if (sqlKind === 'select') {
      if (connection.engine === 'SQL Server') {
        initialSql = `SELECT TOP 100 *\nFROM ${qualifiedTable};`
      } else if (connection.engine === 'Oracle') {
        initialSql = `SELECT *\nFROM ${qualifiedTable}\nWHERE ROWNUM <= 100;`
      } else {
        initialSql = `SELECT *\nFROM ${qualifiedTable}\nLIMIT 100;`
      }
      title = `SELECT · ${table.name}`
    } else if (sqlKind === 'insert') {
      const colList = columns.length
        ? columns.map((col) => q(col.name)).join(', ')
        : 'column1, column2'
      const valList = columns.length ? columns.map(() => `'...'`).join(', ') : "'val1', 'val2'"
      initialSql = `INSERT INTO ${qualifiedTable} (${colList})\nVALUES (${valList});`
      title = `INSERT · ${table.name}`
    } else if (sqlKind === 'update') {
      const setList = columns.length
        ? columns.map((col) => `${q(col.name)} = '...'`).join(',\n  ')
        : `${q('column')} = 'val'`
      initialSql = `UPDATE ${qualifiedTable}\nSET ${setList}\nWHERE ${q(firstColName)} = '...';`
      title = `UPDATE · ${table.name}`
    } else if (sqlKind === 'delete') {
      initialSql = `DELETE FROM ${qualifiedTable}\nWHERE ${q(firstColName)} = '...';`
      title = `DELETE · ${table.name}`
    } else if (sqlKind === 'ddl') {
      if (isDoubleQuoteEngine) {
        initialSql = `-- 查看表 ${table.name} 定义\nSELECT column_name, data_type, is_nullable\nFROM information_schema.columns\nWHERE table_name = '${table.name}';`
      } else {
        initialSql = `-- 查看数据表 ${table.name} 结构 DDL\nSHOW CREATE TABLE ${q(table.name)};`
      }
      title = `DDL · ${table.name}`
    }

    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      title,
      initialSql,
      autoRun: sqlKind === 'select' || sqlKind === 'ddl'
    })
  }

  const handleMaintainTable = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem,
    action: 'check' | 'optimize' | 'analyze',
    schemaName?: string
  ): void => {
    const isPgOrOracle = connection.engine === 'PostgreSQL' || connection.engine === 'Oracle'
    const q = (identifier: string) => (isPgOrOracle ? `"${identifier}"` : `\`${identifier}\``)
    const keywordMap = { check: 'CHECK TABLE', optimize: 'OPTIMIZE TABLE', analyze: 'ANALYZE TABLE' }
    const actionLabel = { check: '检查表', optimize: '优化表', analyze: '分析表' }
    const schemaPrefix = schemaName ? `${q(schemaName)}.` : ''
    const qualifiedTable = `${schemaPrefix}${q(table.name)}`
    const initialSql = `${keywordMap[action]} ${qualifiedTable};`

    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      title: `${actionLabel[action]} · ${table.name}`,
      initialSql,
      autoRun: true
    })
  }

  const handleShowTableInfo = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem
  ): void => {
    dialogActions.openTableInfoDialog(connection, database, table)
  }

  const handleCopySqlStatement = async (
    connection: DatabaseConnection,
    _database: DatabaseItem,
    table: TableItem,
    type: 'select' | 'insert'
  ): Promise<void> => {
    const isPgOrOracle = connection.engine === 'PostgreSQL' || connection.engine === 'Oracle'
    const q = (identifier: string) => (isPgOrOracle ? `"${identifier}"` : `\`${identifier}\``)
    const columns = table.columns ?? []

    let sql = ''
    if (type === 'select') {
      sql = `SELECT ${columns.length ? columns.map((col) => q(col.name)).join(', ') : '*'} FROM ${q(table.name)};`
    } else {
      const colList = columns.length ? columns.map((col) => q(col.name)).join(', ') : 'col1, col2'
      const valList = columns.length ? columns.map(() => `'...'`).join(', ') : "'val1', 'val2'"
      sql = `INSERT INTO ${q(table.name)} (${colList}) VALUES (${valList});`
    }

    await navigator.clipboard.writeText(sql)
  }

  const handleExportDataDictionary = async (
    connection: DatabaseConnection,
    database: DatabaseItem
  ): Promise<void> => {
    let md = `# 数据库数据字典 - ${database.name}\n\n`
    md += `> **生成时间**: ${new Date().toLocaleString('zh-CN')}\n`
    md += `> **数据库引擎**: ${connection.engine}\n`
    md += `> **连接名称**: ${connection.name}\n`
    md += `> **包含数据表**: ${database.tables.length} 张\n\n`
    md += `---\n\n`

    if (!database.tables.length) {
      md += `*当前数据库暂无数据表定义。*\n`
    } else {
      for (let index = 0; index < database.tables.length; index++) {
        const table = database.tables[index]
        let cols: import('@/shared/connections').TableColumnDefinition[] = []
        try {
          const defRes = await window.omnidb.tables.getDefinition(connection.id, database.name, table.name)
          if (defRes.success && defRes.columns) {
            cols = defRes.columns
          }
        } catch {
          // ignore
        }

        md += `### ${index + 1}. 数据表：${table.name}\n\n`
        if (table.comment) md += `> **表说明**: ${table.comment}\n\n`
        md += `| 序号 | 字段名称 | 数据类型 | 允许 NULL | 主键 | 默认值 | 字段说明 / 备注 |\n`
        md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`

        if (!cols.length) {
          md += `| - | *无字段定义* | - | - | - | - | - |\n`
        } else {
          cols.forEach((col, cIdx) => {
            const typeStr = col.typeDefinition || col.type || 'VARCHAR'
            const nullStr = col.notNull ? '否' : '是'
            const pkStr = col.primaryKey ? '`YES`' : '-'
            const defaultStr =
              col.defaultValue !== undefined && col.defaultValue !== null
                ? `\`${col.defaultValue}\``
                : '-'
            const commentStr = col.comment || (col.autoIncrement ? 'AUTO_INCREMENT' : '-')
            md += `| ${cIdx + 1} | \`${col.name}\` | \`${typeStr}\` | ${nullStr} | ${pkStr} | ${defaultStr} | ${commentStr} |\n`
          })
        }

        md += `\n`
        if (table.indexes?.length) {
          md += `**索引列表**: ${table.indexes.map((i) => `\`${i}\``).join(', ')}\n\n`
        }
        md += `---\n\n`
      }
    }

    useDocTabsStore.getState().openDocTab({
      connectionName: connection.name,
      databaseName: database.name,
      title: `数据字典 · ${database.name}`,
      content: md
    })
  }

  return {
    confirmDialog,
    handleDeleteTable,
    handleTruncateTable,
    handleCopyTable,
    handleRenameTable,
    handleTableSaved,
    handleConnectionSaved,
    handleDatabaseSaved,
    handleImportTable,
    handleExportTable,
    handleGenerateSql,
    handleMaintainTable,
    handleShowTableInfo,
    handleCopySqlStatement,
    handleExportDataDictionary
  }
}
