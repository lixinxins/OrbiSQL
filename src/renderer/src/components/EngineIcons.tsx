import type { CSSProperties } from 'react'
import { TerminalWindow } from '@phosphor-icons/react'
import type { ConnectionProtocol } from '@/shared/connections'

export const ENGINE_BRAND_COLORS: Record<ConnectionProtocol, string> = {
  MySQL: '#00758f',
  MariaDB: '#003545',
  PostgreSQL: '#336791',
  SQLite: '#003b57',
  'SQL Server': '#cc292b',
  Oracle: '#f80000',
  TiDB: '#e30c34',
  ClickHouse: '#ffcc00',
  MongoDB: '#13aa52',
  Redis: '#dc382d',
  DuckDB: '#facc15',
  Elasticsearch: '#005571',
  达梦: '#c8102e',
  人大金仓: '#1e3a8a',
  SSH: '#6366f1'
}

export function getEngineBrandColor(engine: ConnectionProtocol, customColor?: string): string {
  if (customColor && customColor.trim()) return customColor
  return ENGINE_BRAND_COLORS[engine] || '#6366f1'
}

interface EngineIconProps {
  engine: ConnectionProtocol
  className?: string
  style?: CSSProperties
}

export function EngineIcon({ engine, className = '', style }: EngineIconProps) {
  const iconClass = `engine-brand-icon engine-${engine.toLowerCase().replace(/[^a-z0-9]+/g, '-')} ${className}`

  switch (engine) {
    case 'MySQL':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12c0-5.523-4.477-10-10-10z" opacity="0" />
          {/* MySQL Clean Logo SVG */}
          <path d="M4 8.5C4 6.5 6 5 8.5 5C11 5 12 6.5 12.5 8C13 6.5 14 5 16.5 5C19 5 21 6.5 21 8.5C21 12 18.5 14.5 16.5 16.5L12.5 20.5L8.5 16.5C6.5 14.5 4 12 4 8.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M9 10V10.01M16 10V10.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      )

    case 'PostgreSQL':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-4H9V11h2V9a3 3 0 0 1 6 0v2h-2V9a1 1 0 0 0-2 0v2h2v2h-2z" />
          <path d="M17 11c1.5 0 2.5 1.2 2.5 2.8 0 1.9-1.4 3.2-3.2 4.2L14.5 16l1.8-.9c1-.5 1.7-1.1 1.7-1.9 0-.6-.4-1.2-1-1.2h-1v-1h1z" opacity="0.8" />
        </svg>
      )

    case 'SQLite':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
          <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
          <path d="M12 12l3-3m0 0h-2.5M15 9v2.5" strokeWidth="1.5" />
        </svg>
      )

    case 'Redis':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L3 6.5v11L12 22l9-4.5v-11L12 2zm0 2.3l6.7 3.3-6.7 3.4-6.7-3.4L12 4.3zM5 8.7l6 3v6.7l-6-3V8.7zm8 9.7v-6.7l6-3v6.7l-6 3z" />
        </svg>
      )

    case 'MongoDB':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2c-4 4.5-6.5 8-6.5 11.5a6.5 6.5 0 0 0 13 0C18.5 10 16 6.5 12 2zm.8 15.4V19h-1.6v-1.6c-2.2-.4-3.7-2-3.7-4.1 0-2.3 2-4.6 4.5-7 2.5 2.4 4.5 4.7 4.5 7 0 2.1-1.5 3.7-3.7 4.1z" />
        </svg>
      )

    case 'SQL Server':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 4h18v4H3V4zm0 6h18v4H3v-4zm0 6h18v4H3v-4z" opacity="0.3" />
          <rect x="3" y="3" width="8" height="8" rx="1" />
          <rect x="13" y="3" width="8" height="8" rx="1" />
          <rect x="3" y="13" width="8" height="8" rx="1" />
          <rect x="13" y="13" width="8" height="8" rx="1" />
        </svg>
      )

    case 'Oracle':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4C6.5 4 2 7.6 2 12s4.5 8 10 8 10-3.6 10-8-4.5-8-10-8zm0 13c-3.9 0-7-2.2-7-5s3.1-5 7-5 7 2.2 7 5-3.1 5-7 5z" />
        </svg>
      )

    case 'ClickHouse':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="4" width="3.2" height="16" rx="1" />
          <rect x="7.7" y="4" width="3.2" height="16" rx="1" />
          <rect x="12.4" y="4" width="3.2" height="16" rx="1" />
          <rect x="17.1" y="8" width="3.9" height="12" rx="1" />
        </svg>
      )

    case 'TiDB':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="7" r="4" />
          <circle cx="6" cy="16" r="3.5" />
          <circle cx="18" cy="16" r="3.5" />
          <path d="M10 9.5L7.5 13.5M14 9.5l2.5 4M9.5 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )

    case 'Elasticsearch':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
      )

    case 'DuckDB':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm1 14.5c-2.5 0-4.5-1.5-4.5-3.5 0-1.5 1.2-2.8 3-3.3V8c0-.6.4-1 1-1s1 .4 1 1v1.7c1.8.5 3 1.8 3 3.3 0 2-2 3.5-4.5 3.5z" />
        </svg>
      )

    case '达梦':
    case 'MariaDB':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
          <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
        </svg>
      )

    case '人大金仓':
      return (
        <svg className={iconClass} style={style} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.3l5.7 3.6L12 11.4 6.3 7.9 12 4.3zM5.5 9.4l5.5 3.4v6.3l-5.5-3.4V9.4zm13 6.3l-5.5 3.4v-6.3l5.5-3.4v6.3z" />
        </svg>
      )

    case 'SSH':
    default:
      return <TerminalWindow className={iconClass} style={style} weight="fill" />
  }
}
