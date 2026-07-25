import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Code,
  Database,
  DotsThree,
  FileCode,
  PushPin,
  Rows,
  Sparkle,
  TerminalWindow,
  X
} from '@phosphor-icons/react'
import type {
  ClosableWorkspaceKind,
  DatabaseOverviewTab,
  DocTab,
  QueryTab,
  SshTerminalTab,
  TableDataTab,
  TableDesignerTab,
  WorkspaceKind,
  WorkspaceTabReference
} from '../../stores'
import { AI_DATABASE_TAB_ID } from '../../stores'

interface WorkspaceTabBarProps {
  activeWorkspace: WorkspaceKind | null
  activateWorkspaceTab: (tab: WorkspaceTabReference | null) => void
  databaseTabs: DatabaseOverviewTab[]
  activeDatabaseTabId: string | null
  closeDatabaseOverview: (id: string) => void
  tableDialogs: TableDesignerTab[]
  activeTableDialogId: string | null
  closeTableDesigner: (id: string) => void
  queryTabs: QueryTab[]
  activeQueryId: string | null
  closeQuery: (id: string) => void
  tableDataTabs: TableDataTab[]
  activeTableDataId: string | null
  closeTableData: (id: string) => void
  sshTerminalTabs: SshTerminalTab[]
  activeSshTerminalId: string | null
  closeSshTerminal: (id: string) => void
  docTabs?: DocTab[]
  activeDocId?: string | null
  closeDocTab?: (id: string) => void
  aiDatabaseOpen: boolean
  pinnedTabIds: Set<string>
  togglePinTab: (id: string) => void
  closeWithFallback: (sliceKey: ClosableWorkspaceKind, closingId: string) => void
  openTabContextMenu: (event: ReactMouseEvent, tab: WorkspaceTabReference) => void
  maxVisibleWorkspaceTabs?: number
  showTabOverflow: boolean
  setShowTabOverflow: (updater: boolean | ((prev: boolean) => boolean)) => void
  workspaceTabbarRef: React.RefObject<HTMLDivElement | null>
}

export default function WorkspaceTabBar({
  activeWorkspace,
  activateWorkspaceTab,
  databaseTabs,
  activeDatabaseTabId,
  closeDatabaseOverview,
  tableDialogs,
  activeTableDialogId,
  closeTableDesigner,
  queryTabs,
  activeQueryId,
  closeQuery,
  tableDataTabs,
  activeTableDataId,
  closeTableData,
  sshTerminalTabs,
  activeSshTerminalId,
  closeSshTerminal,
  docTabs = [],
  activeDocId,
  aiDatabaseOpen,
  pinnedTabIds,
  togglePinTab,
  closeWithFallback,
  openTabContextMenu,
  showTabOverflow,
  setShowTabOverflow,
  workspaceTabbarRef
}: WorkspaceTabBarProps) {
  const buildWorkspaceTabs = (): WorkspaceTabReference[] => [
    ...databaseTabs.map((tab) => ({ id: tab.id, kind: 'database' as const })),
    ...tableDialogs.map((tab) => ({ id: tab.id, kind: 'tables' as const })),
    ...queryTabs.map((tab) => ({ id: tab.id, kind: 'queries' as const })),
    ...tableDataTabs.map((tab) => ({ id: tab.id, kind: 'data' as const })),
    ...sshTerminalTabs.map((tab) => ({ id: tab.id, kind: 'terminal' as const })),
    ...docTabs.map((tab) => ({ id: tab.id, kind: 'doc' as const })),
    ...(aiDatabaseOpen ? [{ id: AI_DATABASE_TAB_ID, kind: 'ai' as const }] : [])
  ]

  const contextMenuTabs = buildWorkspaceTabs()
  const getActiveWorkspaceTab = (): WorkspaceTabReference | null => {
    if (activeWorkspace === 'database' && activeDatabaseTabId)
      return { id: activeDatabaseTabId, kind: 'database' }
    if (activeWorkspace === 'tables' && activeTableDialogId)
      return { id: activeTableDialogId, kind: 'tables' }
    if (activeWorkspace === 'queries' && activeQueryId)
      return { id: activeQueryId, kind: 'queries' }
    if (activeWorkspace === 'data' && activeTableDataId)
      return { id: activeTableDataId, kind: 'data' }
    if (activeWorkspace === 'terminal' && activeSshTerminalId)
      return { id: activeSshTerminalId, kind: 'terminal' }
    if (activeWorkspace === 'doc' && activeDocId)
      return { id: activeDocId, kind: 'doc' }
    if (activeWorkspace === 'ai' && aiDatabaseOpen)
      return { id: AI_DATABASE_TAB_ID, kind: 'ai' }
    return null
  }

  const activeTabReference = getActiveWorkspaceTab()

  // Auto-scroll active tab into view
  const tabsContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tabsContainerRef.current || !activeTabReference) return
    const activeEl = tabsContainerRef.current.querySelector('.home-tab.active')
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activeWorkspace, activeDatabaseTabId, activeTableDialogId, activeQueryId, activeTableDataId, activeSshTerminalId, activeDocId, aiDatabaseOpen])

  const handleTabsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0 && tabsContainerRef.current) {
      tabsContainerRef.current.scrollLeft += e.deltaY
    }
  }

  const workspaceTabLabel = (tab: WorkspaceTabReference): string => {
    if (tab.kind === 'database') {
      const item = databaseTabs.find((candidate) => candidate.id === tab.id)
      return `数据表 · ${item?.databaseName ?? '数据库'}`
    }
    if (tab.kind === 'tables') {
      const item = tableDialogs.find((candidate) => candidate.id === tab.id)
      return item?.table
        ? `设计表 · ${item.table.name}`
        : `新建表 · ${item?.database.name ?? '数据库'}`
    }
    if (tab.kind === 'queries') {
      const item = queryTabs.find((candidate) => candidate.id === tab.id)
      return item?.context.title || `查询 · ${item?.context.databaseName || '未选择数据库'}`
    }
    if (tab.kind === 'terminal') {
      const item = sshTerminalTabs.find((candidate) => candidate.id === tab.id)
      return `终端 · ${item?.connection.name ?? 'SSH'}`
    }
    if (tab.kind === 'ai') return 'AI数据库'
    const item = tableDataTabs.find((candidate) => candidate.id === tab.id)
    return `数据 · ${item?.table.name ?? '数据表'}`
  }

  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 110, right: 16 })

  const handleToggleOverflow = (event: ReactMouseEvent): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      right: Math.max(12, window.innerWidth - rect.right)
    })
    setShowTabOverflow((current) => !current)
  }

  return (
    <div ref={workspaceTabbarRef} className="workspace-tabbar">
      <div
        ref={tabsContainerRef}
        className="content-tabs table-designer-window-tabs query-window-tabs"
        role="tablist"
        onWheel={handleTabsWheel}
      >
        <div
          className={`home-tab workbench-tab${activeWorkspace === null ? ' active' : ''}`}
          role="tab"
          aria-selected={activeWorkspace === null}
          tabIndex={0}
          onClick={() => activateWorkspaceTab(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ')
              activateWorkspaceTab(null)
          }}
        >
          <Database weight="fill" />
          <span>工作台</span>
        </div>
        {databaseTabs.map((tab) => (
          <div
            className={`home-tab query-tab database-overview-tab${pinnedTabIds.has(tab.id) ? ' pinned' : ''}${activeWorkspace === 'database' && activeDatabaseTabId === tab.id ? ' active' : ''}`}
            key={tab.id}
            role="tab"
            tabIndex={0}
            title={`${tab.connectionName} / ${tab.databaseName}`}
            onContextMenu={(event) =>
              openTabContextMenu(event, { id: tab.id, kind: 'database' })
            }
            onClick={() =>
              activateWorkspaceTab({ id: tab.id, kind: 'database' })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ')
                activateWorkspaceTab({ id: tab.id, kind: 'database' })
            }}
          >
            <Database weight="fill" />
            <span>数据表 · {tab.databaseName}</span>
            <button
              type="button"
              className="tab-pin-btn"
              title={pinnedTabIds.has(tab.id) ? '取消固定' : '固定标签页'}
              onClick={(event) => {
                event.stopPropagation()
                togglePinTab(tab.id)
              }}
            >
              <PushPin weight={pinnedTabIds.has(tab.id) ? 'fill' : 'regular'} />
            </button>
            {!pinnedTabIds.has(tab.id) && (
              <button
                type="button"
                className="tab-close-btn"
                onClick={(event) => {
                  event.stopPropagation()
                  closeDatabaseOverview(tab.id)
                }}
                aria-label={`关闭 ${tab.databaseName} 数据表页面`}
              >
                <X />
              </button>
            )}
          </div>
        ))}
        {tableDialogs.map((tab) => (
          <div
            className={`home-tab query-tab table-designer-tab${activeWorkspace === 'tables' && activeTableDialogId === tab.id ? ' active' : ''}`}
            key={tab.id}
            role="tab"
            tabIndex={0}
            title={`${tab.connection.name} / ${tab.database.name}${tab.table ? ` / ${tab.table.name}` : ''}`}
            onContextMenu={(event) =>
              openTabContextMenu(event, { id: tab.id, kind: 'tables' })
            }
            onClick={() =>
              activateWorkspaceTab({ id: tab.id, kind: 'tables' })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ')
                activateWorkspaceTab({ id: tab.id, kind: 'tables' })
            }}
          >
            <Database weight="fill" />
            <span>
              {tab.table
                ? `设计表 · ${tab.table.name}`
                : `新建表 · ${tab.database.name}`}
            </span>
            <button
              type="button"
              className="tab-close-btn"
              onClick={(event) => {
                event.stopPropagation()
                closeTableDesigner(tab.id)
              }}
              aria-label={`关闭 ${tab.database.name} 新建表页面`}
            >
              <X />
            </button>
          </div>
        ))}
        {queryTabs.map((tab) => (
          <div
            className={`home-tab query-tab query-document-tab${activeWorkspace === 'queries' && activeQueryId === tab.id ? ' active' : ''}`}
            key={tab.id}
            role="tab"
            tabIndex={0}
            title={`${tab.context.connectionName || '未选择连接'} / ${tab.context.databaseName || '未选择数据库'}`}
            onContextMenu={(event) =>
              openTabContextMenu(event, { id: tab.id, kind: 'queries' })
            }
            onClick={() =>
              activateWorkspaceTab({ id: tab.id, kind: 'queries' })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ')
                activateWorkspaceTab({ id: tab.id, kind: 'queries' })
            }}
          >
            <Code />
            <span>
              {tab.context.title ||
                `查询 · ${tab.context.databaseName || '未选择数据库'}`}
            </span>
            <button
              type="button"
              className="tab-close-btn"
              onClick={(event) => {
                event.stopPropagation()
                closeQuery(tab.id)
              }}
              aria-label="关闭查询页面"
            >
              <X />
            </button>
          </div>
        ))}
        {tableDataTabs.map((tab) => (
          <div
            className={`home-tab query-tab table-data-tab${activeWorkspace === 'data' && activeTableDataId === tab.id ? ' active' : ''}`}
            key={tab.id}
            role="tab"
            tabIndex={0}
            title={`${tab.connection.name} / ${tab.database.name} / ${tab.table.name}`}
            onContextMenu={(event) =>
              openTabContextMenu(event, { id: tab.id, kind: 'data' })
            }
            onClick={() =>
              activateWorkspaceTab({ id: tab.id, kind: 'data' })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ')
                activateWorkspaceTab({ id: tab.id, kind: 'data' })
            }}
          >
            <Rows />
            <span>数据 · {tab.table.name}</span>
            <button
              type="button"
              className="tab-close-btn"
              onClick={(event) => {
                event.stopPropagation()
                closeTableData(tab.id)
              }}
              aria-label={`关闭 ${tab.table.name} 数据页面`}
            >
              <X />
            </button>
          </div>
        ))}
        {sshTerminalTabs.map((tab) => (
          <div
            className={`home-tab query-tab ssh-terminal-tab${activeWorkspace === 'terminal' && activeSshTerminalId === tab.id ? ' active' : ''}`}
            key={tab.id}
            role="tab"
            tabIndex={0}
            title={`SSH 终端 / ${tab.connection.name}`}
            onContextMenu={(event) =>
              openTabContextMenu(event, { id: tab.id, kind: 'terminal' })
            }
            onClick={() =>
              activateWorkspaceTab({ id: tab.id, kind: 'terminal' })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ')
                activateWorkspaceTab({ id: tab.id, kind: 'terminal' })
            }}
          >
            <TerminalWindow />
            <span>终端 · {tab.connection.name}</span>
            <button
              type="button"
              className="tab-close-btn"
              onClick={(event) => {
                event.stopPropagation()
                closeSshTerminal(tab.id)
              }}
              aria-label={`关闭 ${tab.connection.name} 终端`}
            >
              <X />
            </button>
          </div>
        ))}
        {docTabs.map((tab) => (
          <div
            className={`home-tab query-tab doc-tab${activeWorkspace === 'doc' && activeDocId === tab.id ? ' active' : ''}`}
            key={tab.id}
            role="tab"
            tabIndex={0}
            title={`${tab.connectionName} / ${tab.databaseName}`}
            onContextMenu={(event) =>
              openTabContextMenu(event, { id: tab.id, kind: 'doc' })
            }
            onClick={() =>
              activateWorkspaceTab({ id: tab.id, kind: 'doc' })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ')
                activateWorkspaceTab({ id: tab.id, kind: 'doc' })
            }}
          >
            <FileCode weight="fill" />
            <span>{tab.title}</span>
            <button
              type="button"
              className="tab-pin-btn"
              title={pinnedTabIds.has(tab.id) ? '取消固定' : '固定标签页'}
              onClick={(event) => {
                event.stopPropagation()
                togglePinTab(tab.id)
              }}
            >
              <PushPin weight={pinnedTabIds.has(tab.id) ? 'fill' : 'regular'} />
            </button>
            {!pinnedTabIds.has(tab.id) && (
              <button
                type="button"
                className="tab-close-btn"
                onClick={(event) => {
                  event.stopPropagation()
                  closeWithFallback('doc', tab.id)
                }}
                aria-label={`关闭 ${tab.title} 标签页`}
              >
                <X />
              </button>
            )}
          </div>
        ))}
        {aiDatabaseOpen && (
          <div
            className={`home-tab query-tab ai-database-tab${activeWorkspace === 'ai' ? ' active' : ''}`}
            role="tab"
            tabIndex={0}
            title="AI数据库"
            onContextMenu={(event) =>
              openTabContextMenu(event, { id: AI_DATABASE_TAB_ID, kind: 'ai' })
            }
            onClick={() =>
              activateWorkspaceTab({ id: AI_DATABASE_TAB_ID, kind: 'ai' })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ')
                activateWorkspaceTab({ id: AI_DATABASE_TAB_ID, kind: 'ai' })
            }}
          >
            <Sparkle weight="fill" />
            <span>AI数据库</span>
            <button
              type="button"
              className="tab-close-btn"
              onClick={(event) => {
                event.stopPropagation()
                closeWithFallback('ai', AI_DATABASE_TAB_ID)
              }}
              aria-label="关闭 AI数据库"
            >
              <X />
            </button>
          </div>
        )}
      </div>
      <div className="workspace-tab-overflow-host">
        <button
          type="button"
          className={`workspace-tab-more${showTabOverflow ? ' active' : ''}`}
          title={`${contextMenuTabs.length + 1} 个已打开的页面`}
          aria-label="显示所有打开的页面"
          aria-expanded={showTabOverflow}
          onClick={handleToggleOverflow}
        >
          <DotsThree weight="bold" />
          <span>{contextMenuTabs.length + 1}</span>
        </button>
        {showTabOverflow && createPortal(
          <div
            className="workspace-tab-overflow-menu"
            style={{ top: menuPos.top, right: menuPos.right }}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <strong>打开的页面</strong>
              <span>{contextMenuTabs.length + 1}</span>
            </header>
            <div>
              <div className="workspace-tab-overflow-item">
                <button
                  type="button"
                  className={`workspace-tab-overflow-open${activeWorkspace === null ? ' active' : ''}`}
                  onClick={() => {
                    activateWorkspaceTab(null)
                    setShowTabOverflow(false)
                  }}
                >
                  <Database weight="fill" />
                  <span>工作台</span>
                </button>
              </div>
              {contextMenuTabs.map((tab) => (
                <div
                  className="workspace-tab-overflow-item"
                  key={tab.id}
                  onContextMenu={(event) => openTabContextMenu(event, tab)}
                >
                  <button
                    type="button"
                    className="workspace-tab-overflow-open"
                    title={workspaceTabLabel(tab)}
                    onClick={() => {
                      activateWorkspaceTab(tab)
                      setShowTabOverflow(false)
                    }}
                  >
                    {tab.kind === 'queries' ? (
                      <Code />
                    ) : tab.kind === 'data' ? (
                      <Rows />
                    ) : tab.kind === 'terminal' ? (
                      <TerminalWindow />
                    ) : (
                      <Database weight="fill" />
                    )}
                    <span>{workspaceTabLabel(tab)}</span>
                  </button>
                  <button
                    type="button"
                    className="workspace-tab-overflow-close"
                    title="关闭页面"
                    aria-label={`关闭 ${workspaceTabLabel(tab)}`}
                    onClick={() => {
                      if (tab.kind === 'database') closeDatabaseOverview(tab.id)
                      else if (tab.kind === 'tables') closeTableDesigner(tab.id)
                      else if (tab.kind === 'queries') closeQuery(tab.id)
                      else if (tab.kind === 'data') closeTableData(tab.id)
                      else if (tab.kind === 'terminal') closeSshTerminal(tab.id)
                      else if (tab.kind === 'ai') closeWithFallback('ai', AI_DATABASE_TAB_ID)
                    }}
                  >
                    <X />
                  </button>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}

