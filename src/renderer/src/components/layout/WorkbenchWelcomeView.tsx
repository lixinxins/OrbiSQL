import {
  CaretRight,
  Code,
  Database,
  FileSql,
  FlowArrow,
  GitDiff,
  Plus,
  Sparkle,
  WifiHigh
} from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem } from '@/shared/connections'

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
  onOpenAiDatabase: () => void
  onOpenAdvancedTool: (mode: 'schema' | 'er') => void
  onOpenQueryForRecent: (conn: DatabaseConnection, db: DatabaseItem) => void
}

export default function WorkbenchWelcomeView({
  connections,
  recentConnections,
  onOpenNewConnectionDialog,
  onOpenDefaultQuery,
  onOpenAiDatabase,
  onOpenAdvancedTool,
  onOpenQueryForRecent
}: WorkbenchWelcomeViewProps) {
  return (
    <>
      <section className="welcome">
        <div className="welcome-mark">
          <Database weight="duotone" />
        </div>
        <h1>开始使用 QuillDB</h1>
        <p>从左侧选择一个数据库，或创建新连接来管理你的数据。</p>
        <div className="quick-actions">
          <button className="quick-card" onClick={onOpenNewConnectionDialog}>
            <span className="quick-icon blue">
              <Plus />
            </span>
            <span>
              <strong>新建连接</strong>
              <small>连接 PostgreSQL、MySQL 或 SQLite</small>
            </span>
            <CaretRight />
          </button>
          <button className="quick-card" onClick={onOpenDefaultQuery}>
            <span className="quick-icon violet">
              <FileSql />
            </span>
            <span>
              <strong>新建 SQL 查询</strong>
              <small>打开查询编辑器并执行 SQL</small>
            </span>
            <CaretRight />
          </button>
          <button
            type="button"
            className="quick-card"
            title="AI数据库"
            onClick={onOpenAiDatabase}
          >
            <span className="quick-icon cyan">
              <Sparkle weight="fill" />
            </span>
            <span>
              <strong>AI数据库</strong>
              <small>使用 AI 辅助分析和管理数据库</small>
            </span>
            <CaretRight />
          </button>
          <button
            type="button"
            className="quick-card"
            onClick={() => onOpenAdvancedTool('schema')}
          >
            <span className="quick-icon violet">
              <GitDiff />
            </span>
            <span>
              <strong>结构与数据对比</strong>
              <small>对比数据库结构和表数据差异</small>
            </span>
            <CaretRight />
          </button>
          <button
            type="button"
            className="quick-card"
            onClick={() => onOpenAdvancedTool('er')}
          >
            <span className="quick-icon cyan">
              <FlowArrow />
            </span>
            <span>
              <strong>ER 关系图</strong>
              <small>根据外键生成数据库关系视图</small>
            </span>
            <CaretRight />
          </button>
        </div>
        {recentConnections.length > 0 && (
          <div className="welcome-recent">
            <h3>
              <WifiHigh />
              最近使用
            </h3>
            <div className="welcome-recent-list">
              {recentConnections.map(
                (r) => {
                  const conn = connections.find((c) => c.id === r.connectionId)
                  const db = conn?.databases.find(
                    (d) => d.name === r.databaseName
                  )
                  return (
                    <button
                      key={`${r.connectionId}-${r.databaseName}-${r.ts}`}
                      className="welcome-recent-item"
                      title={`${r.connectionName} / ${r.databaseName}`}
                      onClick={() => conn && db && onOpenQueryForRecent(conn, db)}
                    >
                      <span
                        className={`recent-engine-badge engine-${r.engine.toLowerCase()}`}
                      >
                        {r.engine.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="recent-db-info">
                        <strong>{r.databaseName}</strong>
                        <small>{r.connectionName}</small>
                      </span>
                      <Code />
                    </button>
                  )
                }
              )}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
