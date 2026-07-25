import { createPortal } from 'react-dom'
import {
  ArrowsClockwise,
  Broom,
  CaretRight,
  Code,
  Copy,
  DownloadSimple,
  FileCode,
  FileSql,
  FolderOpen,
  Info,
  PencilSimple,
  Plus,
  Power,
  Rows,
  Trash,
  UploadSimple,
  Wrench
} from '@phosphor-icons/react'
import type { ConnectionGroup, DatabaseConnection } from '@/shared/connections'
import { useSidebarStore } from '../stores/useSidebarStore'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useTerminalTabsStore } from '../stores/tabs/useTerminalTabs'
import { useQueryTabsStore } from '../stores/tabs/useQueryTabs'
import { useTableDataTabsStore } from '../stores/tabs/useTableDataTabs'
import { useTableDesignerTabsStore } from '../stores/tabs/useTableDesignerTabs'
import { useDialogStore } from '../stores/useDialogStore'
import { useTableOperations } from '../hooks/useTableOperations'
import { useConfirmDialog } from './ConfirmDialog'

interface SidebarContextMenuProps {
  connectionGroups: ConnectionGroup[]
  expandedDatabases: Set<string>
  onToggleConnectionFromMenu: (connection: DatabaseConnection) => Promise<void>
  onDatabaseClick: (
    databaseKey: string,
    connection: DatabaseConnection,
    database: import('@/shared/connections').DatabaseItem
  ) => Promise<void>
  onAssignGroup: (connectionId: number, groupId: number | null) => Promise<void>
}

export default function SidebarContextMenu({
  connectionGroups,
  expandedDatabases,
  onToggleConnectionFromMenu,
  onDatabaseClick,
  onAssignGroup
}: SidebarContextMenuProps) {
  const menu = useSidebarStore((s) => s.contextMenu)
  const sidebarActions = useSidebarStore((s) => s.actions)
  const connActions = useConnectionStore((s) => s.actions)
  const openSshTerminal = useTerminalTabsStore((s) => s.openSshTerminal)
  const createSshTerminal = useTerminalTabsStore((s) => s.createSshTerminal)
  const sshTerminalTabs = useTerminalTabsStore((s) => s.sshTerminalTabs)
  const closeSshTerminal = useTerminalTabsStore((s) => s.closeSshTerminal)
  const addQueryTab = useQueryTabsStore((s) => s.addQueryTab)
  const openTableData = useTableDataTabsStore((s) => s.openTableData)
  const designTable = useTableDesignerTabsStore((s) => s.designTable)
  const openTableDesigner = useTableDesignerTabsStore((s) => s.openTableDesigner)
  const dialogActions = useDialogStore((s) => s.actions)
  const tableOps = useTableOperations()
  const { confirm, confirmDialog } = useConfirmDialog()

  if (!menu) return null

  const close = (): void => sidebarActions.setContextMenu(null)
  const clampX = (x: number): number => Math.min(x, window.innerWidth - 196)

  return createPortal(
    <>
      <div
        className="connection-context-menu"
        style={{ left: menu.x, top: menu.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 1. 连接节点右键菜单 ── */}
        {menu.kind === 'connection' && (() => {
          const isSsh = menu.connection.engine === 'SSH'
          const sshTab = isSsh ? sshTerminalTabs.find((t) => t.connection.id === menu.connection.id) : null
          const sshTerminalOpen = !!sshTab
          return (
          <>
            {isSsh ? (
              <>
                {sshTerminalOpen ? (
                  <>
                    <button type="button" onClick={() => {
                      createSshTerminal(menu.connection)
                      close()
                    }}>
                      <Plus />
                      创建 SSH 终端
                    </button>
                    <button type="button" onClick={() => {
                      closeSshTerminal(sshTab.id)
                      close()
                    }}>
                      <Trash />
                      关闭 SSH 终端
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => {
                    openSshTerminal(menu.connection)
                    close()
                  }}>
                    <Power />
                    打开 SSH 终端
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={() => {
                void onToggleConnectionFromMenu(menu.connection)
                close()
              }}>
                <Power />
                {menu.connection.open ? '关闭连接' : '打开连接'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                dialogActions.setEditingConnection(menu.connection)
                dialogActions.setShowConnectionDialog(true)
                close()
              }}
            >
              <PencilSimple />
              编辑连接
            </button>
            <button
              type="button"
              onClick={() => {
                dialogActions.setEditingConnection(null)
                dialogActions.setShowConnectionDialog(true)
                close()
              }}
            >
              <Plus />
              新建连接
            </button>
            <button
              type="button"
              onClick={() => {
                void connActions.duplicateConnection(menu.connection)
                close()
              }}
            >
              <Copy />
              复制连接
            </button>
            <span className="context-menu-divider" />
            <div className="context-menu-danger-zone">
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const conn = menu.connection
                  const confirmed = await confirm({
                    title: '⚠️ 危险操作：删除连接',
                    message: `确定要删除连接【${conn.name}】吗？`,
                    detail: '删除后该连接的所有配置信息将被彻底清除，此操作不可撤销。',
                    confirmLabel: '确认删除连接'
                  })
                  close()
                  if (confirmed) {
                    await connActions.deleteConnection(conn)
                  }
                }}
              >
                <Trash />
                删除连接
              </button>
            </div>
            <span className="context-menu-divider" />
            <div className="context-submenu-host">
              <button type="button">
                <FolderOpen />
                <span className="context-menu-label">移动到分组</span>
                <CaretRight className="context-submenu-caret" />
              </button>
              <div
                className={`connection-context-menu context-submenu${menu.x > window.innerWidth - 390 ? ' left' : ''}`}
              >
                <button type="button" onClick={() => void onAssignGroup(menu.connection.id, null)}>
                  {!menu.connection.groupId ? '✓ ' : ''}未分组
                </button>
                {connectionGroups.map((group) => (
                  <button
                    type="button"
                    key={group.id}
                    onClick={() => void onAssignGroup(menu.connection.id, group.id)}
                  >
                    {menu.connection.groupId === group.id ? '✓ ' : ''}
                    {group.name}
                  </button>
                ))}
                {!connectionGroups.length && (
                  <button type="button" disabled>
                    请先在侧栏新建分组
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void connActions.refreshConnection(menu.connection.id)
                void connActions.loadConnections()
                close()
              }}
            >
              <ArrowsClockwise />
              刷新
            </button>
            <div className="context-submenu-host">
              <button type="button">
                <Wrench />
                <span className="context-menu-label">环境标识</span>
                <CaretRight className="context-submenu-caret" />
              </button>
              <div
                className={`connection-context-menu context-submenu${menu.x > window.innerWidth - 390 ? ' left' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    void connActions.setConnectionEnvironment(menu.connection, 'production', '#ef4444')
                    close()
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#ef4444',
                      display: 'inline-block'
                    }}
                  />{' '}
                  生产环境 (PROD)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void connActions.setConnectionEnvironment(menu.connection, 'staging', '#f59e0b')
                    close()
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#f59e0b',
                      display: 'inline-block'
                    }}
                  />{' '}
                  测试环境 (TEST)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void connActions.setConnectionEnvironment(menu.connection, 'development', '#10b981')
                    close()
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#10b981',
                      display: 'inline-block'
                    }}
                  />{' '}
                  开发环境 (DEV)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void connActions.setConnectionEnvironment(menu.connection, null, '#6366f1')
                    close()
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#6366f1',
                      display: 'inline-block'
                    }}
                  />{' '}
                  经典蓝 (Classic)
                </button>
              </div>
            </div>
            {menu.connection.engine !== 'SSH' && (
              <>
                <button
                  type="button"
                  disabled={!menu.connection.open}
                  onClick={() => {
                    addQueryTab({
                      connectionId: menu.connection.id,
                      connectionName: menu.connection.name,
                      databaseName: menu.connection.databases[0]?.name || '',
                      title: `活动进程 · ${menu.connection.name}`,
                      isProcessList: true
                    })
                    close()
                  }}
                >
                  <Rows />
                  查看活动会话 / 进程
                </button>
                <button
                  type="button"
                  disabled={!menu.connection.open}
                  onClick={() => {
                    void connActions.runSqlFile(menu.connection)
                    close()
                  }}
                >
                  <FileSql />
                  运行 SQL 文件
                </button>
              </>
            )}
          </>
          )
        })()}

        {/* ── 2. 数据库节点右键菜单 ── */}
        {menu.kind === 'database' && (
          <>
            <button
              type="button"
              onClick={() => {
                void onDatabaseClick(menu.databaseKey, menu.connection, menu.database)
                close()
              }}
            >
              <Power />
              {expandedDatabases.has(menu.databaseKey) ? '关闭数据库' : '打开数据库'}
            </button>
            <button
              type="button"
              onClick={() => {
                openTableDesigner(menu.connection, menu.database)
                close()
              }}
            >
              <Plus />
              新建数据表
            </button>
            {menu.connection.engine !== 'SQLite' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    dialogActions.setDatabaseDialog({ connection: menu.connection, database: null })
                    close()
                  }}
                >
                  <Plus />
                  新建数据库
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dialogActions.setDatabaseDialog({ connection: menu.connection, database: menu.database })
                    close()
                  }}
                >
                  <PencilSimple />
                  编辑数据库
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                void connActions.refreshDatabase(menu.connection.id, menu.database.name)
                close()
              }}
            >
              <ArrowsClockwise />
              刷新数据库
            </button>
            <button
              type="button"
              onClick={() => {
                addQueryTab({
                  connectionId: menu.connection.id,
                  connectionName: menu.connection.name,
                  databaseName: menu.database.name
                })
                close()
              }}
            >
              <Code />
              新建查询
            </button>
            <button
              type="button"
              onClick={() => {
                tableOps.handleExportDataDictionary(menu.connection, menu.database)
                close()
              }}
            >
              <FileCode />
              生成/导出数据字典 (Markdown)
            </button>
            <button
              type="button"
              onClick={() => {
                void connActions.runDatabaseSqlFile(menu.connection, menu.database)
                close()
              }}
            >
              <FileSql />
              运行 SQL 文件
            </button>
            <div className="context-submenu-host">
              <button type="button">
                <DownloadSimple />
                <span className="context-menu-label">导出 SQL</span>
                <CaretRight className="context-submenu-caret" />
              </button>
              <div
                className={`connection-context-menu context-submenu${clampX(menu.x) > window.innerWidth - 390 ? ' left' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    dialogActions.setExportSqlPreviewDialog({
                      connection: menu.connection,
                      database: menu.database,
                      includeData: false
                    })
                    close()
                  }}
                >
                  <DownloadSimple />
                  仅导出结构
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dialogActions.setExportSqlPreviewDialog({
                      connection: menu.connection,
                      database: menu.database,
                      includeData: true
                    })
                    close()
                  }}
                >
                  <DownloadSimple weight="fill" />
                  导出结构和数据
                </button>
              </div>
            </div>
            <span className="context-menu-divider" />
            <div className="context-menu-danger-zone">
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const { connection, database } = menu
                  const confirmed = await confirm({
                    title: '⚠️ 极高风险操作：清空全库表数据',
                    message: `确定要清空数据库【${database.name}】中的所有数据表记录吗？`,
                    detail: `注意：数据库"${database.name}"中全库所有表中的所有数据行都将被擦除！此操作不可撤销恢复！`,
                    confirmLabel: '确认清空全库所有数据'
                  })
                  close()
                  if (confirmed) {
                    for (const tbl of database.tables) {
                      await window.omnidb.tables.truncate(connection.id, database.name, tbl.name)
                    }
                    await connActions.refreshConnection(connection.id)
                  }
                }}
              >
                <Broom />
                清空全库所有表数据
              </button>
              {menu.connection.engine !== 'SQLite' && (
                <button
                  type="button"
                  className="danger"
                  onClick={async () => {
                    const { connection, database } = menu
                    const confirmed = await confirm({
                      title: '⚠️ 极高风险操作：删除数据库',
                      message: `确定要删除数据库【${database.name}】吗？`,
                      detail: `数据库 "${database.name}" 及其下所有表和数据都将被永久销毁，此操作不可撤销！`,
                      confirmLabel: '确认销毁数据库'
                    })
                    close()
                    if (confirmed) {
                      await connActions.deleteDatabase(connection, database)
                    }
                  }}
                >
                  <Trash />
                  删除数据库 (Drop Database)
                </button>
              )}
            </div>
          </>
        )}

        {/* ── 3. 数据表节点右键菜单 (精简架构) ── */}
        {menu.kind === 'table' && (
          <>
            <button
              type="button"
              onClick={() => {
                openTableData(menu.connection, menu.database, menu.table)
                close()
              }}
            >
              <FolderOpen />
              打开表数据
            </button>
            <button
              type="button"
              onClick={() => {
                designTable(menu.connection, menu.database, menu.table)
                close()
              }}
            >
              <PencilSimple />
              设计表
            </button>
            <button
              type="button"
              onClick={() => {
                openTableDesigner(menu.connection, menu.database)
                close()
              }}
            >
              <Plus />
              新建表
            </button>
            <button
              type="button"
              onClick={() => {
                void connActions.refreshTable(menu.connection.id, menu.database.name, menu.table.name)
                close()
              }}
            >
              <ArrowsClockwise />
              刷新表
            </button>
            <span className="context-menu-divider" />
            <div className="context-submenu-host">
              <button type="button">
                <Copy />
                <span className="context-menu-label">复制表对象</span>
                <CaretRight className="context-submenu-caret" />
              </button>
              <div
                className={`connection-context-menu context-submenu${clampX(menu.x) > window.innerWidth - 390 ? ' left' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    void tableOps.handleCopyTable(menu.connection, menu.database, menu.table, false)
                    close()
                  }}
                >
                  <Copy />
                  仅复制结构
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void tableOps.handleCopyTable(menu.connection, menu.database, menu.table, true)
                    close()
                  }}
                >
                  <Copy weight="fill" />
                  复制结构和数据
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(menu.table.name)
                close()
              }}
            >
              <Copy />
              复制表名称
            </button>
            <div className="context-submenu-host">
              <button type="button">
                <FileCode />
                <span className="context-menu-label">生成 / 复制 SQL</span>
                <CaretRight className="context-submenu-caret" />
              </button>
              <div
                className={`connection-context-menu context-submenu${clampX(menu.x) > window.innerWidth - 390 ? ' left' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'select')
                    close()
                  }}
                >
                  <Code />
                  生成 SELECT 语句
                </button>
                <button
                  type="button"
                  onClick={() => {
                    tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'insert')
                    close()
                  }}
                >
                  <Plus />
                  生成 INSERT 模板
                </button>
                <button
                  type="button"
                  onClick={() => {
                    tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'update')
                    close()
                  }}
                >
                  <PencilSimple />
                  生成 UPDATE 模板
                </button>
                <button
                  type="button"
                  onClick={() => {
                    tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'delete')
                    close()
                  }}
                >
                  <Trash />
                  生成 DELETE 模板
                </button>
                <span className="context-menu-divider" />
                <button
                  type="button"
                  onClick={() => {
                    tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'ddl')
                    close()
                  }}
                >
                  <FileSql />
                  查看建表 DDL
                </button>
              </div>
            </div>
            <div className="context-submenu-host">
              <button type="button">
                <DownloadSimple />
                <span className="context-menu-label">导出 SQL / 数据</span>
                <CaretRight className="context-submenu-caret" />
              </button>
              <div
                className={`connection-context-menu context-submenu${clampX(menu.x) > window.innerWidth - 390 ? ' left' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    dialogActions.setExportSqlPreviewDialog({
                      connection: menu.connection,
                      database: menu.database,
                      table: menu.table,
                      includeData: false
                    })
                    close()
                  }}
                >
                  <DownloadSimple />
                  仅导出结构 (.sql)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dialogActions.setExportSqlPreviewDialog({
                      connection: menu.connection,
                      database: menu.database,
                      table: menu.table,
                      includeData: true
                    })
                    close()
                  }}
                >
                  <DownloadSimple weight="fill" />
                  导出结构和数据 (.sql)
                </button>
                <span className="context-menu-divider" />
                <button
                  type="button"
                  onClick={() => {
                    void tableOps.handleExportTable(menu.connection, menu.database, menu.table)
                    close()
                  }}
                >
                  <DownloadSimple />
                  导出数据为 CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void tableOps.handleExportTable(menu.connection, menu.database, menu.table)
                    close()
                  }}
                >
                  <DownloadSimple />
                  导出数据为 JSON
                </button>
              </div>
            </div>
            <div className="context-submenu-host">
              <button type="button">
                <Wrench />
                <span className="context-menu-label">表维护工具</span>
                <CaretRight className="context-submenu-caret" />
              </button>
              <div
                className={`connection-context-menu context-submenu${clampX(menu.x) > window.innerWidth - 390 ? ' left' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    tableOps.handleMaintainTable(menu.connection, menu.database, menu.table, 'check')
                    close()
                  }}
                >
                  <Wrench />
                  检查表 (CHECK TABLE)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    tableOps.handleMaintainTable(menu.connection, menu.database, menu.table, 'optimize')
                    close()
                  }}
                >
                  <Broom />
                  优化表 (OPTIMIZE TABLE)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    tableOps.handleMaintainTable(menu.connection, menu.database, menu.table, 'analyze')
                    close()
                  }}
                >
                  <ArrowsClockwise />
                  分析表 (ANALYZE TABLE)
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                dialogActions.openTableInfoDialog(menu.connection, menu.database, menu.table)
                close()
              }}
            >
              <Info />
              查看表属性与信息
            </button>
            <button
              type="button"
              onClick={() => {
                dialogActions.openRenameTableDialog(menu.connection, menu.database, menu.table)
                close()
              }}
            >
              <PencilSimple />
              重命名表
            </button>
            <span className="context-menu-divider" />
            <div className="context-menu-danger-zone">
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const { connection, database, table } = menu
                  await tableOps.handleTruncateTable(connection, database, table)
                  close()
                }}
              >
                <Broom />
                清空表数据 (Truncate)
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const { connection, database, table } = menu
                  await tableOps.handleDeleteTable(connection, database, table)
                  close()
                }}
              >
                <Trash />
                删除表 (Drop Table)
              </button>
            </div>
          </>
        )}

        {/* ── 4. 表分组节点右键菜单 ── */}
        {menu.kind === 'tableGroup' && (
          <>
            <button
              type="button"
              onClick={() => {
                openTableDesigner(menu.connection, menu.database)
                close()
              }}
            >
              <Plus />
              新建数据表
            </button>
            <button
              type="button"
              onClick={() => {
                dialogActions.setTablePicker({ connection: menu.connection, database: menu.database, mode: 'import' })
                close()
              }}
            >
              <UploadSimple />
              导入 CSV / JSON / Excel
            </button>
            <button
              type="button"
              onClick={() => {
                dialogActions.setTablePicker({ connection: menu.connection, database: menu.database, mode: 'export' })
                close()
              }}
            >
              <DownloadSimple />
              导出 CSV / JSON / Excel
            </button>
          </>
        )}

        {/* ── 5. 对象节点右键菜单 (视图/存储过程/函数/触发器) ── */}
        {menu.kind === 'object' && (
          <>
            <button
              type="button"
              onClick={() => {
                addQueryTab({
                  connectionId: menu.connection.id,
                  connectionName: menu.connection.name,
                  databaseName: menu.database.name,
                  title: `查询 · ${menu.objectName}`,
                  initialSql: `SELECT * FROM \`${menu.objectName}\` LIMIT 100;`,
                  autoRun: true
                })
                close()
              }}
            >
              <Code />
              打开/查询该{menu.groupLabel.slice(0, 2)}
            </button>
            <button
              type="button"
              onClick={() => {
                const typeMap: Record<string, string> = {
                  views: 'VIEW',
                  procedures: 'PROCEDURE',
                  functions: 'FUNCTION',
                  triggers: 'TRIGGER'
                }
                const objectType = typeMap[menu.groupKey] || 'TABLE'
                addQueryTab({
                  connectionId: menu.connection.id,
                  connectionName: menu.connection.name,
                  databaseName: menu.database.name,
                  title: `DDL · ${menu.objectName}`,
                  initialSql: `SHOW CREATE ${objectType} \`${menu.objectName}\`;`,
                  autoRun: true
                })
                close()
              }}
            >
              <FileCode />
              查看定义 DDL
            </button>
            {menu.groupKey === 'procedures' && (
              <button
                type="button"
                onClick={() => {
                  dialogActions.setAdvancedTool({ mode: 'routine' })
                  close()
                }}
              >
                <PencilSimple />
                可视化编辑存储过程
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(menu.objectName)
                close()
              }}
            >
              <Copy />
              复制名称
            </button>
            <span className="context-menu-divider" />
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const { connection, database, groupLabel, objectName, groupKey } = menu
                const confirmed = await confirm({
                  title: `删除${groupLabel.slice(0, 2)}`,
                  message: `确定要删除 ${groupLabel.slice(0, 2)}【${objectName}】吗？`,
                  detail: '此操作不可撤销。',
                  confirmLabel: '删除对象'
                })
                close()
                if (confirmed) {
                  const typeMap: Record<string, string> = {
                    views: 'VIEW',
                    procedures: 'PROCEDURE',
                    functions: 'FUNCTION',
                    triggers: 'TRIGGER'
                  }
                  const objectType = typeMap[groupKey] || 'TABLE'
                  await window.omnidb.queries.execute(
                    connection.id,
                    database.name,
                    `DROP ${objectType} \`${objectName}\`;`
                  )
                  await connActions.refreshConnection(connection.id)
                }
              }}
            >
              <Trash />
              删除该{menu.groupLabel.slice(0, 2)}
            </button>
          </>
        )}

        {/* ── 6. 对象分类组节点右键菜单 ── */}
        {menu.kind === 'objectGroup' && (
          <>
            <button
              type="button"
              onClick={() => {
                if (menu.groupKey === 'procedures' || menu.groupKey === 'functions') {
                  dialogActions.setAdvancedTool({ mode: 'routine' })
                } else {
                  addQueryTab({
                    connectionId: menu.connection.id,
                    connectionName: menu.connection.name,
                    databaseName: menu.database.name,
                    title: `新建${menu.groupLabel.slice(0, 2)}`,
                    initialSql:
                      menu.groupKey === 'views'
                        ? 'CREATE VIEW new_view AS\nSELECT 1;'
                        : 'CREATE PROCEDURE new_procedure()\nBEGIN\n  -- SQL statements\nEND;'
                  })
                }
                close()
              }}
            >
              <Plus />
              新建{menu.groupLabel.slice(0, 2)}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(menu.groupLabel)
                close()
              }}
            >
              <Copy />
              复制分类名称
            </button>
          </>
        )}
      </div>
      {confirmDialog}
      {tableOps.confirmDialog}
    </>,
    document.body
  )
}
