import { useEffect, useState } from 'react'
import { Cpu, Database, Gear, Globe, Lightning, HardDrives, Terminal, Table as TableIcon } from '@phosphor-icons/react'
import { useUIStore, useDialogStore } from '../../stores'

interface MemoryStats {
  rssMB: number
  heapTotalMB: number
  heapUsedMB: number
  externalMB: number
  arrayBuffersMB: number
}

const MEMORY_POLL_INTERVAL = 10_000

export default function StatusBar() {
  const statusInfo = useUIStore((s) => s.statusInfo)
  const setShowSettingsDialog = useDialogStore((s) => s.actions.setShowSettingsDialog)
  const [mem, setMem] = useState<MemoryStats | null>(null)
  const [gcLoading, setGcLoading] = useState(false)

  const fetchMem = async () => {
    try {
      const stats = await window.omnidb.memory.getStats()
      if (mounted) setMem(stats)
    } catch { /* ignore */ }
  }

  let mounted = true
  useEffect(() => {
    mounted = true
    fetchMem()
    const timer = setInterval(fetchMem, MEMORY_POLL_INTERVAL)
    return () => { mounted = false; clearInterval(timer) }
  }, [])

  const handleForceGc = async () => {
    if (gcLoading) return
    setGcLoading(true)
    try {
      await window.omnidb.memory.forceGc()
      await fetchMem()
    } catch { /* ignore */ }
    setTimeout(() => setGcLoading(false), 500)
  }

  const { ping, version, dbConnectedCount, sshConnectedCount, focusedItem } = statusInfo
  const hasAnyConnection = dbConnectedCount > 0 || sshConnectedCount > 0

  // 构建聚焦项显示文本
  const focusedLabel = focusedItem
    ? focusedItem.tableName
      ? `${focusedItem.connectionName} / ${focusedItem.databaseName} / ${focusedItem.tableName}`
      : focusedItem.databaseName
        ? `${focusedItem.connectionName} / ${focusedItem.databaseName}`
        : focusedItem.connectionName
    : null

  return (
    <footer className="global-status-bar" role="contentinfo" aria-label="状态栏">
      {/* 当前聚焦项 */}
      {focusedLabel && (
        <span className="global-status-bar__item focused-item" title={focusedItem?.engine ? `${focusedLabel} (${focusedItem.engine})` : focusedLabel}>
          {focusedItem?.tableName ? <TableIcon weight="fill" /> : focusedItem?.databaseName ? <Database weight="fill" /> : null}
          <span className="focused-item-label">{focusedLabel}</span>
        </span>
      )}

      <span className="global-status-bar__item">
        <i className="footer-status" />
        <span>系统就绪</span>
      </span>

      {/* 数据库连接状态：有活跃标签页时显示 Ping，否则显示连接数 */}
      {ping !== null ? (
        <span className="global-status-bar__item status-ping" title="当前连接数据库响应时间">
          <Lightning weight="fill" />
          <span>{ping} ms</span>
        </span>
      ) : hasAnyConnection ? (
        <span className="global-status-bar__item" title="已打开的数据库连接数">
          <Database weight="fill" />
          <span>{dbConnectedCount} 个数据库连接</span>
        </span>
      ) : (
        <span className="global-status-bar__item" title="无活跃数据库连接">
          <Database />
          <span>未连接数据库</span>
        </span>
      )}

      {/* SSH 连接状态 */}
      {sshConnectedCount > 0 && (
        <span className="global-status-bar__item" title="已打开的 SSH 终端会话数">
          <Terminal weight="fill" />
          <span>{sshConnectedCount} 个 SSH 连接</span>
        </span>
      )}

      {version && (
        <span className="global-status-bar__item" title="数据库服务版本">
          <Cpu />
          <span>引擎版本: {version}</span>
        </span>
      )}

      <span className="global-status-bar__push" />

      {mem && (
        <button
          type="button"
          className="global-status-bar__item status-bar-btn"
          style={{ opacity: gcLoading ? 0.6 : 1 }}
          title={`点击进行垃圾回收并释放内存\n主进程 RSS (常驻内存): ${mem.rssMB.toFixed(0)} MB | JS 堆已用: ${mem.heapUsedMB.toFixed(0)} MB | V8 堆总分配: ${mem.heapTotalMB.toFixed(0)} MB | 外部 Native 内存: ${mem.externalMB.toFixed(0)} MB`}
          onClick={handleForceGc}
        >
          <HardDrives className={gcLoading ? 'animate-spin' : ''} />
          <span>{mem.rssMB.toFixed(0)} MB</span>
        </button>
      )}

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

      <span className="global-status-bar__item version-tag">QuillDB v1.0.1</span>
    </footer>
  )
}
