import { useState } from 'react'
import {
  BookOpen,
  Check,
  Columns,
  Copy,
  DownloadSimple,
  FileCode,
  PencilSimple
} from '@phosphor-icons/react'
import type { DocTab } from '../../stores/tabs/types'
import { useDocTabsStore } from '../../stores/tabs/useDocTabs'

interface MarkdownWorkspaceProps {
  tab: DocTab
  active: boolean
}

type ViewMode = 'preview' | 'edit' | 'split'

export default function MarkdownWorkspace({ tab, active }: MarkdownWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const updateDocContent = useDocTabsStore((s) => s.updateDocContent)

  if (!active) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tab.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleExportMd = async () => {
    setExporting(true)
    try {
      // Trigger native save dialog if available or browser download fallback
      const fileName = `${tab.databaseName}-data-dictionary.md`
      const blob = new Blob([tab.content], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '导出 Markdown 文件失败')
    } finally {
      setExporting(false)
    }
  }

  // Simple, clean Markdown renderer for database dictionary format
  const renderMarkdownHtml = (mdText: string) => {
    const lines = mdText.split('\n')
    const elements: React.ReactNode[] = []
    let inTable = false
    let tableHeader: string[] = []
    let tableRows: string[][] = []

    const flushTable = (keyIndex: number) => {
      if (inTable && tableHeader.length > 0) {
        elements.push(
          <div className="md-table-wrap" key={`table-${keyIndex}`}>
            <table className="md-rendered-table">
              <thead>
                <tr>
                  {tableHeader.map((h, i) => (
                    <th key={i}>{h.trim()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => {
                      const trimmed = cell.trim()
                      const isCode = trimmed.startsWith('`') && trimmed.endsWith('`')
                      const val = isCode ? trimmed.slice(1, -1) : trimmed
                      return (
                        <td key={cIdx}>
                          {isCode ? <code className="md-inline-code">{val}</code> : val}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      inTable = false
      tableHeader = []
      tableRows = []
    }

    lines.forEach((line, idx) => {
      const trimmed = line.trim()

      if (trimmed.startsWith('|')) {
        const parts = trimmed.split('|').slice(1, -1)
        if (trimmed.includes(':---') || trimmed.includes('---:')) {
          // Alignment line, skip
          return
        }
        if (!inTable) {
          inTable = true
          tableHeader = parts
        } else {
          tableRows.push(parts)
        }
        return
      }

      if (inTable) {
        flushTable(idx)
      }

      if (trimmed.startsWith('# ')) {
        elements.push(<h1 key={idx} className="md-h1">{trimmed.slice(2)}</h1>)
      } else if (trimmed.startsWith('## ')) {
        elements.push(<h2 key={idx} className="md-h2">{trimmed.slice(3)}</h2>)
      } else if (trimmed.startsWith('### ')) {
        elements.push(<h3 key={idx} className="md-h3">{trimmed.slice(4)}</h3>)
      } else if (trimmed.startsWith('> ')) {
        elements.push(<blockquote key={idx} className="md-blockquote">{trimmed.slice(2)}</blockquote>)
      } else if (trimmed === '---') {
        elements.push(<hr key={idx} className="md-hr" />)
      } else if (trimmed.length > 0) {
        elements.push(<p key={idx} className="md-paragraph">{line}</p>)
      }
    })

    if (inTable) {
      flushTable(lines.length)
    }

    return elements
  }

  return (
    <div className={`doc-workspace-container${active ? ' active' : ''}`}>
      {/* ── Toolbar Header ── */}
      <header className="doc-workspace-toolbar">
        <div className="doc-toolbar-meta">
          <FileCode className="doc-meta-icon" />
          <div>
            <h2>{tab.title}</h2>
            <p>
              数据库：<strong>{tab.connectionName} &bull; {tab.databaseName}</strong>
            </p>
          </div>
        </div>

        <div className="doc-toolbar-actions">
          <div className="format-picker">
            <button
              type="button"
              className={`format-btn ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              <BookOpen /> 渲染预览
            </button>
            <button
              type="button"
              className={`format-btn ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => setViewMode('edit')}
            >
              <PencilSimple /> 编辑源码
            </button>
            <button
              type="button"
              className={`format-btn ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
            >
              <Columns /> 双栏对照
            </button>
          </div>

          <span className="toolbar-divider" />

          <button type="button" className="doc-action-btn" onClick={() => void handleCopy()}>
            {copied ? <Check style={{ color: '#10b981' }} /> : <Copy />}
            <span>{copied ? '已复制' : '复制 MD'}</span>
          </button>

          <button
            type="button"
            className="doc-action-btn primary"
            disabled={exporting}
            onClick={() => void handleExportMd()}
          >
            <DownloadSimple />
            <span>导出 .md 文件</span>
          </button>
        </div>
      </header>

      {/* ── Workspace Body ── */}
      <main className={`doc-workspace-body mode-${viewMode}`}>
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div className="doc-editor-pane">
            <div className="pane-header">Markdown 源码编辑</div>
            <textarea
              className="doc-editor-textarea"
              value={tab.content}
              onChange={(e) => updateDocContent(tab.id, e.target.value)}
              placeholder="在此输入 Markdown 内容..."
            />
          </div>
        )}

        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className="doc-preview-pane">
            <div className="pane-header">Markdown 渲染预览</div>
            <div className="doc-preview-rendered-body">
              {renderMarkdownHtml(tab.content)}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
