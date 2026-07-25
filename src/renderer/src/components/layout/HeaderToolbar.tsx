import { DownloadSimple, FileSql, FolderOpen, GearSix, GitDiff, Plus, UploadSimple } from '@phosphor-icons/react'
import omniDbIcon from '../../../../../resources/icon.png'
import { isHarmonyPlatform } from '../../platform/platform-bridge'

interface HeaderToolbarProps {
  onOpenNewConnectionDialog: () => void
  onOpenNewConnectionGroupDialog: () => void
  onOpenDefaultQuery: () => void
  onOpenAdvancedTool: (mode: 'schema' | 'er') => void
  onOpenSettingsDialog: () => void
  onExportConnections?: () => void
  onImportConnections?: () => void
}

export default function HeaderToolbar({
  onOpenNewConnectionDialog,
  onOpenNewConnectionGroupDialog,
  onOpenDefaultQuery,
  onOpenAdvancedTool,
  onOpenSettingsDialog,
  onExportConnections,
  onImportConnections
}: HeaderToolbarProps) {
  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh')
  const modKey = isMac ? '⌘' : 'Ctrl+'

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-icon">
          <img src={omniDbIcon} alt="" />
        </span>
        <span className="brand-name">OrbiSQL</span>
      </div>

      <div className="toolbar-actions">
        <button className="tool-button primary" onClick={onOpenNewConnectionDialog} title={`新建连接 (${modKey}N)`}>
          <Plus weight="bold" />
          <span>新建连接</span>
          <kbd className="key-badge">{modKey}N</kbd>
        </button>
        <button className="tool-button" onClick={onOpenDefaultQuery} title={`新建查询 (${modKey}T)`}>
          <FileSql />
          <span>新建查询</span>
          <kbd className="key-badge">{modKey}T</kbd>
        </button>
        <span className="toolbar-divider" />
        <button
          className="tool-button"
          onClick={onOpenNewConnectionGroupDialog}
        >
          <FolderOpen weight="fill" />
          <span>新建分组</span>
        </button>
        <button
          className="tool-button"
          onClick={onExportConnections}
          title="导出数据库连接配置文件 (JSON)"
        >
          <DownloadSimple />
          <span>导出连接</span>
        </button>
        <button
          className="tool-button"
          onClick={onImportConnections}
          title="从 JSON 配置文件导入数据库连接"
        >
          <UploadSimple />
          <span>导入连接</span>
        </button>
        <button
          className="tool-button"
          onClick={() => onOpenAdvancedTool('schema')}
        >
          <GitDiff />
          <span>高级工具</span>
        </button>
        {isHarmonyPlatform() && (
          <button
            className="tool-button"
            onClick={onOpenSettingsDialog}
          >
            <GearSix />
            <span>设置</span>
          </button>
        )}
      </div>
    </header>
  )
}
