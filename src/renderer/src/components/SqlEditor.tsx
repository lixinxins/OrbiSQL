import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { sql, MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { setDiagnostics } from '@codemirror/lint'

// ── Types ──────────────────────────────────────────────────

export interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onCursorChange?: (pos: { line: number; column: number }) => void
  onRunQuery?: () => void
  onSaveQuery?: () => void
  onFormatSql?: () => void
  onCompressSql?: () => void
  completionItems?: string[]
  /** Character offsets where errors should be underlined */
  errorPositions?: number[]
  dialect?: string
  placeholder?: string
}

// ── Theme (CSS variables integration) ──────────────────────

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    backgroundColor: 'var(--bg-base)',
    color: 'var(--text)'
  },
  '.cm-content': {
    padding: '12px 0',
    caretColor: 'var(--text)',
    lineHeight: '1.7'
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--text)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--primary-surface) !important'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-base)',
    color: 'var(--text-subtle)',
    border: 'none',
    borderRight: '1px solid var(--border)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--text)'
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)'
  },
  '.cm-placeholder': {
    color: 'var(--text-subtle)',
    fontStyle: 'italic'
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, .18)',
    color: 'var(--text)',
    fontSize: '12px'
  },
  '.cm-tooltip-autocomplete ul li': {
    padding: '4px 8px'
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--primary-surface)',
    color: 'var(--primary)'
  }
})

// ── Component ──────────────────────────────────────────────

export default function SqlEditor({
  value,
  onChange,
  onCursorChange,
  onRunQuery,
  onSaveQuery,
  onFormatSql,
  onCompressSql,
  completionItems = [],
  errorPositions = [],
  dialect = 'MySQL',
  placeholder
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)
  const onRunQueryRef = useRef(onRunQuery)
  const onSaveQueryRef = useRef(onSaveQuery)
  const onFormatSqlRef = useRef(onFormatSql)
  const onCompressSqlRef = useRef(onCompressSql)
  const completionItemsRef = useRef(completionItems)

  // Keep refs updated to avoid re-creating extensions
  onChangeRef.current = onChange
  onCursorChangeRef.current = onCursorChange
  onRunQueryRef.current = onRunQuery
  onSaveQueryRef.current = onSaveQuery
  onFormatSqlRef.current = onFormatSql
  onCompressSqlRef.current = onCompressSql
  completionItemsRef.current = completionItems

  // Map dialect to CM6 SQL dialect
  const cmDialect = dialect === 'PostgreSQL' ? PostgreSQL : dialect === 'SQLite' ? SQLite : MySQL

  // Create editor (once)
  useEffect(() => {
    if (!containerRef.current) return

    const completionExt = autocompletion({
      override: [
        (context: CompletionContext) => {
          const word = context.matchBefore(/[\w$]+/)
          if (!word || word.from === word.to) return null
          const options = completionItemsRef.current.map((item) => ({
            label: item,
            type: item === item.toUpperCase() ? 'keyword' : 'variable'
          }))
          return { from: word.from, options }
        }
      ]
    })

    const customKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => { onRunQueryRef.current?.(); return true }
      },
      {
        key: 'Mod-s',
        run: () => { onSaveQueryRef.current?.(); return true }
      },
      {
        key: 'Alt-Shift-f',
        run: () => { onFormatSqlRef.current?.(); return true }
      },
      {
        key: 'Alt-Shift-m',
        run: () => { onCompressSqlRef.current?.(); return true }
      }
    ])

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString())
      }
      if (update.selectionSet) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        onCursorChangeRef.current?.({ line: line.number, column: pos - line.from + 1 })
      }
    })

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      bracketMatching(),
      highlightActiveLine(),
      sql({ dialect: cmDialect }),
      completionExt,
      customKeymap,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      editorTheme,
      syntaxHighlighting(defaultHighlightStyle),
      updateListener
    ]

    if (placeholder) {
      extensions.push(cmPlaceholder(placeholder))
    }

    const state = EditorState.create({
      doc: value,
      extensions
    })

    const view = new EditorView({
      state,
      parent: containerRef.current
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmDialect])

  // Sync value from outside
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentValue = view.state.doc.toString()
    if (currentValue !== value) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value }
      })
    }
  }, [value])

  // Update error positions via lint diagnostics
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const docLength = view.state.doc.length
    const diagnostics = errorPositions
      .filter((pos) => pos >= 0 && pos < docLength)
      .map((pos) => ({
        from: pos,
        to: Math.min(pos + 1, docLength),
        severity: 'error' as const,
        message: '未识别的标识符'
      }))

    view.dispatch(setDiagnostics(view.state, diagnostics))
  }, [errorPositions])

  // Focus method
  const focus = useCallback(() => {
    viewRef.current?.focus()
  }, [])

  // Expose focus via container ref
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as HTMLDivElement & { focus: () => void }).focus = focus
    }
  }, [focus])

  return <div ref={containerRef} className="sql-editor-cm6" />
}
