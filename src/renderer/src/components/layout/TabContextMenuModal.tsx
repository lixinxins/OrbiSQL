import { createPortal } from 'react-dom'
import { CaretLeft, CaretRight, Rows, X } from '@phosphor-icons/react'
import type { TabContextMenu, WorkspaceTabReference } from '../../stores'

interface TabContextMenuModalProps {
  tabContextMenu: TabContextMenu | null
  contextMenuTabs: WorkspaceTabReference[]
  contextMenuTabIndex: number
  onRunTabContextAction: (action: 'current' | 'others' | 'left' | 'right') => void
}

export default function TabContextMenuModal({
  tabContextMenu,
  contextMenuTabs,
  contextMenuTabIndex,
  onRunTabContextAction
}: TabContextMenuModalProps) {
  if (!tabContextMenu) return null

  return createPortal(
    <div
      className="connection-context-menu tab-context-menu"
      style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={() => onRunTabContextAction('current')}>
        <X />
        关闭当前
      </button>
      <button
        type="button"
        disabled={contextMenuTabs.length <= 1}
        onClick={() => onRunTabContextAction('others')}
      >
        <Rows />
        关闭其他
      </button>
      <span className="context-menu-divider" />
      <button
        type="button"
        disabled={contextMenuTabIndex <= 0}
        onClick={() => onRunTabContextAction('left')}
      >
        <CaretLeft />
        关闭左侧
      </button>
      <button
        type="button"
        disabled={
          contextMenuTabIndex < 0 ||
          contextMenuTabIndex >= contextMenuTabs.length - 1
        }
        onClick={() => onRunTabContextAction('right')}
      >
        <CaretRight />
        关闭右侧
      </button>
    </div>,
    document.body
  )
}
