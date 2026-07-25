import { Cpu, Database, Gear, Globe, Lightning } from '@phosphor-icons/react'
import { useUIStore, useDialogStore } from '../../stores'

export default function StatusBar() {
  const statusInfo = useUIStore((s) => s.statusInfo)
  const setShowSettingsDialog = useDialogStore((s) => s.actions.setShowSettingsDialog)

  return (
    <footer className="global-status-bar" role="contentinfo" aria-label="状态栏">
      <span className="global-status-bar__item">
        <i className="footer-status" />
        <span>系统就绪</span>
      </span>

      {statusInfo.ping !== null ? (
        <span className="global-status-bar__item status-ping" title="当前连接数据库响应时间">
          <Lightning weight="fill" />
          <span>{statusInfo.ping} ms</span>
        </span>
      ) : (
        <span className="global-status-bar__item" title="无活跃数据库连接">
          <Database />
          <span>未连接数据库</span>
        </span>
      )}

      {statusInfo.version && (
        <span className="global-status-bar__item" title="数据库服务版本">
          <Cpu />
          <span>引擎版本: {statusInfo.version}</span>
        </span>
      )}

      <span className="global-status-bar__push" />

      <span className="global-status-bar__item" title="编码格式">
        <Globe />
        <span>{statusInfo.charset || 'UTF-8'}</span>
      </span>

      <button
        type="button"
        className="global-status-bar__item status-bar-btn"
        title="打开偏好设置"
        onClick={() => setShowSettingsDialog(true)}
      >
        <Gear />
        <span>设置</span>
      </button>

      <span className="global-status-bar__item version-tag">QuillDB v0.1.0</span>
    </footer>
  )
}
