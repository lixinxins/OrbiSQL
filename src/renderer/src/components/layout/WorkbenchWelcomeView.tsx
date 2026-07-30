import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  CaretDown,
  CheckCircle,
  Code,
  Database,
  HardDrive,
  Lightning,
  LinkSimple,
  Plug,
  Plus,
  Sparkle,
  Table,
  X
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, WorkspaceConnectionSummary, WorkspaceStats } from '@/shared/connections'

interface WorkbenchWelcomeViewProps {
  connections: DatabaseConnection[]
  recentConnections: Array<{
    connectionId: number
    connectionName: string
    databaseName: string
    engine: string
    ts: number
  }>
  onOpenNewConnectionDialog: () => void
  onOpenDefaultQuery: () => void
  onOpenAdvancedTool: (mode: 'schema' | 'er') => void
  onOpenQueryForRecent: (conn: DatabaseConnection, db: DatabaseItem) => void
}

type ModalKind = 'query' | 'source' | 'ai' | null
type RangeKey = '7d' | '30d' | '90d'

interface MetricItem {
  label: string
  value: string
  delta: string
  note: string
  icon: Icon
  color: string
  glow: string
}

const rangeOptions: Array<{ key: RangeKey; label: string }> = [
  { key: '7d', label: '最近 7 天' },
  { key: '30d', label: '最近 30 天' },
  { key: '90d', label: '最近 90 天' }
]

const buildChartPath = (points: number[]): { line: string; fill: string } => {
  const safePoints = points.length ? points : [0]
  const width = 800
  const height = 180
  const max = Math.max(...safePoints)
  const min = Math.min(...safePoints)
  const coords = safePoints.map((point, index) => {
    const x = Math.round(index * (width / Math.max(1, safePoints.length - 1)))
    const y = Math.round(18 + ((point - min) / (max - min || 1)) * -128 + 128)
    return `${x},${y}`
  })
  const line = `M${coords.join(' L')}`
  return { line, fill: `${line} L${width},${height} L0,${height} Z` }
}

const formatNumber = (value: number): string => value.toLocaleString('zh-CN')

const formatBytes = (value: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`
}

export default function WorkbenchWelcomeView({
  connections,
  onOpenNewConnectionDialog,
  onOpenDefaultQuery
}: WorkbenchWelcomeViewProps) {
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d')
  const [rangeOpen, setRangeOpen] = useState(false)
  const [modal, setModal] = useState<ModalKind>(null)
  const [toast, setToast] = useState('')
  const [aiResult, setAiResult] = useState('正在读取当前工作台上下文。')
  const [aiInput, setAiInput] = useState('')
  const [workspaceStats, setWorkspaceStats] = useState<WorkspaceStats | null>(null)

  useEffect(() => {
    let cancelled = false
    window.omnidb.workspace.getStats(rangeKey)
      .then((stats) => {
        if (!cancelled) setWorkspaceStats(stats)
      })
      .catch(() => {
        if (!cancelled) setWorkspaceStats(null)
      })
    return () => { cancelled = true }
  }, [connections, rangeKey])

  const activeConnections = useMemo(
    () => connections.filter((connection) => connection.open && connection.engine !== 'SSH'),
    [connections]
  )
  const resolvedStats = workspaceStats ?? {
    activeConnections: activeConnections.length,
    savedDatabaseConnections: connections.filter((connection) => connection.engine !== 'SSH').length,
    todayQueryCount: 0,
    todaySuccessfulQueryCount: 0,
      databaseCount: 0,
      tableCount: 0,
      dataObjectCount: 0,
      dataBytes: null,
      healthScore: 0,
      healthStatus: '暂无运行数据',
      healthSummary: '后台数据库暂无工作台统计记录。',
      averageLatencyMs: null,
      failedQueryRate: 0,
      trend: {
        range: rangeKey,
        label: rangeOptions.find((option) => option.key === rangeKey)?.label ?? '最近 7 天',
        subtitle: '暂无查询记录',
        points: [],
        labels: []
      },
      recentQueries: [],
      connectionSummaries: [],
      updatedAt: ''
  }
  const currentRange = resolvedStats.trend
  const chartPath = useMemo(() => buildChartPath(currentRange.points), [currentRange.points])
  const chartYLabels = useMemo(() => {
    const max = Math.max(...currentRange.points, 0)
    const step = Math.ceil(max / 4)
    return [step * 4, step * 3, step * 2, step, 0]
  }, [currentRange.points])
  const dashboardMetrics = useMemo<MetricItem[]>(() => [
    {
      label: '活动连接',
      value: String(resolvedStats.activeConnections),
      delta: `${resolvedStats.savedDatabaseConnections} 个`,
      note: '已保存连接',
      icon: LinkSimple,
      color: '#347ff0',
      glow: 'rgba(52,127,240,.16)'
    },
    {
      label: '今日查询',
      value: formatNumber(resolvedStats.todayQueryCount),
      delta: `${formatNumber(resolvedStats.todaySuccessfulQueryCount)} 条`,
      note: '成功执行',
      icon: Lightning,
      color: '#7559e8',
      glow: 'rgba(117,89,232,.15)'
    },
    {
      label: '数据表',
      value: formatNumber(resolvedStats.tableCount),
      delta: `${formatNumber(resolvedStats.databaseCount)} 个`,
      note: '已加载数据库',
      icon: Table,
      color: '#14a7b8',
      glow: 'rgba(20,167,184,.15)'
    },
    {
      label: '数据规模',
      value: resolvedStats.dataBytes == null ? formatNumber(resolvedStats.dataObjectCount) : formatBytes(resolvedStats.dataBytes),
      delta: `${formatNumber(resolvedStats.tableCount)} 张`,
      note: resolvedStats.dataBytes == null ? '表/视图等对象' : '估算数据量',
      icon: HardDrive,
      color: '#1faf67',
      glow: 'rgba(31,175,103,.15)'
    }
  ], [resolvedStats])
  const connectionSummaries = resolvedStats.connectionSummaries
  const aiSuggestions = useMemo(() => {
    const suggestions: Array<{ task: string; response: string }> = []
    if (resolvedStats.failedQueryRate > 0) {
      suggestions.push({
        task: '分析失败查询',
        response: `后台统计显示失败率为 ${(resolvedStats.failedQueryRate * 100).toFixed(2)}%，建议先查看最近失败 SQL 和错误信息。`
      })
    }
    if (resolvedStats.recentQueries.length) {
      suggestions.push({
        task: '解释最近 SQL',
        response: `最近一条 SQL 是：${resolvedStats.recentQueries[0].sql}`
      })
    }
    if (resolvedStats.tableCount > 0) {
      suggestions.push({
        task: '检查数据规模',
        response: `后台统计当前有 ${formatNumber(resolvedStats.tableCount)} 张表、${formatNumber(resolvedStats.dataObjectCount)} 个对象。`
      })
    }
    return suggestions.slice(0, 4)
  }, [resolvedStats])

  const showToast = (message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast((current) => current === message ? '' : current), 2200)
  }

  const handleAiSuggestion = (task: string): void => {
    setAiInput(task)
    setAiResult(aiSuggestions.find((item) => item.task === task)?.response ?? '后台数据库暂无可用于该建议的统计数据。')
    setModal('ai')
  }

  const handleSendAi = (): void => {
    if (!aiInput.trim()) {
      showToast('请输入数据库任务')
      return
    }
    setAiResult(`已接收任务：“${aiInput.trim()}”。建议先确认目标数据库、时间范围与输出字段。`)
    showToast('AI 分析完成')
  }

  return (
    <section className="qwb-workbench">
      <div className="qwb-container">
        <section className="qwb-hero-grid">
          <article className="qwb-hero-card">
            <div className="qwb-hero-kicker"><Sparkle weight="fill" /> Intelligent Data Workspace</div>
            <h1 className="qwb-hero-title">让复杂数据库操作，变成<span>流畅的思考过程</span></h1>
            <p className="qwb-hero-text">在一个工作台中掌握连接状态、查询活动、性能指标和 AI 分析建议。所有关键信息集中呈现，减少在工具与窗口之间反复切换。</p>
            <div className="qwb-hero-actions">
              <button className="qwb-hero-primary" type="button" onClick={onOpenDefaultQuery}><Code /> 创建 SQL 查询</button>
              <button className="qwb-hero-secondary" type="button" onClick={onOpenNewConnectionDialog}><Plug weight="fill" /> 添加数据源</button>
            </div>
            <div className="qwb-hero-orbit" aria-hidden="true">
              <span className="qwb-orbit-ring qwb-r1" /><span className="qwb-orbit-ring qwb-r2" /><span className="qwb-orbit-ring qwb-r3" />
              <span className="qwb-orbit-node qwb-n1" /><span className="qwb-orbit-node qwb-n2" /><span className="qwb-orbit-node qwb-n3" />
              <span className="qwb-orbit-core"><Database weight="fill" /></span>
            </div>
          </article>

          <article className="qwb-surface-card qwb-health-card">
            <div className="qwb-card-head"><div><h3>Workspace Health</h3><small>所有数据连接实时状态</small></div><span className="qwb-live-pill">LIVE</span></div>
            <div className="qwb-health-score"><div className="qwb-score-ring"><strong>{resolvedStats.healthScore}</strong></div><div className="qwb-score-copy"><h4>{resolvedStats.healthStatus}</h4><p>{resolvedStats.healthSummary}</p></div></div>
            <div className="qwb-health-metrics"><div className="qwb-health-metric"><span>平均延迟</span><strong>{resolvedStats.averageLatencyMs == null ? '未采集' : `${resolvedStats.averageLatencyMs}ms`}</strong><em>后台统计</em></div><div className="qwb-health-metric"><span>失败查询</span><strong>{(resolvedStats.failedQueryRate * 100).toFixed(2)}%</strong><em>近 7 天</em></div></div>
          </article>
        </section>

        <section className="qwb-dashboard-grid">
          <div className="qwb-left-stack">
            <div className="qwb-metric-grid">
              {dashboardMetrics.map((metric) => {
                const MetricIcon = metric.icon
                return <article className="qwb-metric-card" style={{ '--qwb-metric-color': metric.color, '--qwb-metric-glow': metric.glow } as CSSProperties} key={metric.label}>
                  <div className="qwb-metric-top"><span>{metric.label}</span><span className="qwb-metric-icon"><MetricIcon weight="fill" /></span></div>
                  <div className="qwb-metric-value">{metric.value}</div>
                  <div className="qwb-metric-foot"><b>{metric.delta}</b> {metric.note}</div>
                </article>
              })}
            </div>

            <article className="qwb-surface-card qwb-activity-card">
              <div className="qwb-card-head">
                <div><h3>查询活动</h3><small>{currentRange.subtitle}</small></div>
                <div className="qwb-range-wrap">
                  <button className="qwb-ghost-btn" type="button" onClick={(event) => { event.stopPropagation(); setRangeOpen((current) => !current) }}><span>{currentRange.label}</span> <CaretDown /></button>
                  <div className={`qwb-range-menu${rangeOpen ? ' open' : ''}`}>
                    {rangeOptions.map((option) => <button className={rangeKey === option.key ? 'active' : ''} type="button" onClick={() => { setRangeKey(option.key); setRangeOpen(false) }} key={option.key}>{option.label}</button>)}
                  </div>
                </div>
              </div>
              <div className="qwb-chart-wrap">
                <div className="qwb-y-labels">{chartYLabels.map((label) => <span key={label}>{formatNumber(label)}</span>)}</div>
                <div className="qwb-chart-area">
                  <svg className="qwb-chart-svg" viewBox="0 0 800 180" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="qwb-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#347ff0" stopOpacity=".24" /><stop offset="1" stopColor="#347ff0" stopOpacity="0" /></linearGradient>
                      <linearGradient id="qwb-stroke" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#347ff0" /><stop offset=".6" stopColor="#7559e8" /><stop offset="1" stopColor="#14a7b8" /></linearGradient>
                    </defs>
                    <path d={chartPath.fill} fill="url(#qwb-fill)" />
                    <path d={chartPath.line} fill="none" stroke="url(#qwb-stroke)" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="qwb-x-labels">{currentRange.labels.map((label, index) => <span key={`${label}-${index}`}>{label || '·'}</span>)}</div>
              </div>
            </article>

            <article className="qwb-surface-card qwb-recent-card">
              <div className="qwb-card-head"><div><h3>最近查询</h3><small>快速恢复正在进行的工作</small></div></div>
              <div className="qwb-query-list">
                {resolvedStats.recentQueries.length === 0 && <div className="qwb-empty-row">后台数据库暂无查询执行记录</div>}
                {resolvedStats.recentQueries.map((query) => {
                  return <button className="qwb-query-item" type="button" onClick={() => showToast(`最近查询：${query.title}`)} key={query.id}>
                    <div className="qwb-query-type"><Code weight="fill" /></div><div className="qwb-query-copy"><strong>{query.title}</strong><code>{query.sql}</code></div><span className="qwb-query-time">{query.time}</span>
                  </button>
                })}
              </div>
            </article>
          </div>

          <div className="qwb-right-stack">
            <article className="qwb-surface-card qwb-connection-summary">
              <div className="qwb-card-head"><div><h3>连接状态</h3><small>在线数据源与延迟</small></div><button className="qwb-icon-btn" type="button" onClick={onOpenNewConnectionDialog}><Plus /></button></div>
              <div className="qwb-summary-list">
                {connectionSummaries.length === 0 && <div className="qwb-empty-row">后台数据库暂无连接记录</div>}
                {connectionSummaries.map((connection: WorkspaceConnectionSummary) => <div className="qwb-summary-item" key={connection.id}><span className="qwb-summary-dot" style={{ background: connection.color, boxShadow: `0 0 12px ${connection.color}66` }} /><div className="qwb-summary-copy"><strong>{connection.name}</strong><span>{connection.engine} · {connection.database}</span></div><span className="qwb-summary-latency">{connection.open ? connection.latency : '未打开'}</span></div>)}
              </div>
            </article>

            <article className="qwb-surface-card qwb-ai-card">
              <div className="qwb-card-head"><div><h3>AI Database Copilot</h3><small>基于当前数据库上下文</small></div><span className="qwb-live-pill">READY</span></div>
              <div className="qwb-ai-prompt">{resolvedStats.recentQueries.length ? '建议基于后台记录的最近 SQL、失败率和数据规模继续分析。' : '后台数据库暂无查询记录，执行 SQL 后会生成可分析上下文。'}</div>
              <div className="qwb-ai-suggestions">
                {aiSuggestions.length === 0 && <span className="qwb-empty-row">暂无后台统计建议</span>}
                {aiSuggestions.map((suggestion) => <button type="button" onClick={() => handleAiSuggestion(suggestion.task)} key={suggestion.task}>{suggestion.task}</button>)}
              </div>
            </article>
          </div>
        </section>
      </div>

      {modal === 'ai' && <div className="qwb-overlay open" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}>
        <div className="qwb-modal">
          <div className="qwb-modal-head"><strong>AI Database Copilot</strong><button type="button" onClick={() => setModal(null)}><X /></button></div>
          <div className="qwb-modal-body"><p>{aiResult}</p><input className="qwb-ai-input" value={aiInput} onChange={(event) => setAiInput(event.target.value)} placeholder="继续描述你的数据库任务" /></div>
          <div className="qwb-modal-foot"><button className="qwb-ghost-btn" type="button" onClick={() => setModal(null)}>关闭</button><button className="qwb-primary-btn" type="button" onClick={handleSendAi}>发送</button></div>
        </div>
      </div>}

      <div className={`qwb-toast${toast ? ' show' : ''}`}><CheckCircle weight="fill" /><span>{toast}</span></div>
    </section>
  )
}
