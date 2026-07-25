export { useConnectionStore } from './useConnectionStore'
export type { ConnectionState } from './useConnectionStore'

export { useTabStore } from './useTabStore'
export type { TabStoreState } from './useTabStore'

export { useDatabaseTabsStore } from './tabs/useDatabaseTabs'
export type { DatabaseTabsState } from './tabs/useDatabaseTabs'

export { useQueryTabsStore } from './tabs/useQueryTabs'
export type { QueryTabsState } from './tabs/useQueryTabs'

export { useTableDataTabsStore } from './tabs/useTableDataTabs'
export type { TableDataTabsState } from './tabs/useTableDataTabs'

export { useTableDesignerTabsStore } from './tabs/useTableDesignerTabs'
export type { TableDesignerTabsState } from './tabs/useTableDesignerTabs'

export { useTerminalTabsStore } from './tabs/useTerminalTabs'
export type { TerminalTabsState } from './tabs/useTerminalTabs'

export { useDocTabsStore } from './tabs/useDocTabs'
export type { DocTabsState } from './tabs/useDocTabs'

export type {
  WorkspaceKind,
  ClosableWorkspaceKind,
  WorkspaceTabReference,
  TabContextMenu,
  DatabaseOverviewTab,
  DocTab,
  QueryTab,
  TableDataTab,
  TableDesignerTab,
  SshTerminalTab
} from './tabs/types'
export { AI_DATABASE_TAB_ID } from './tabs/types'

export { useDialogStore } from './useDialogStore'
export type { DialogState } from './useDialogStore'

export { useEditorStore } from './useEditorStore'
export type { EditorState } from './useEditorStore'

export { useUIStore } from './useUIStore'
export type { UIState } from './useUIStore'

export { useSidebarStore } from './useSidebarStore'
export type { SidebarState, SidebarContextMenuState, ObjectGroupKey, TableGroupKey, ObjectGroup, EngineTreeConfig } from './useSidebarStore'
