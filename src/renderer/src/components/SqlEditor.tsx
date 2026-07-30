import { useEffect, useRef, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { Decoration, EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, placeholder as cmPlaceholder, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { sql, MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { setDiagnostics } from '@codemirror/lint'
import { getSqlStatementAtPosition } from './query/utils/sql-utils'

// ── Types ──────────────────────────────────────────────────

export interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onCursorChange?: (pos: { line: number; column: number }) => void
  onSelectionChange?: (selectedText: string) => void
  onCurrentStatementChange?: (statement: string) => void
  onRunQuery?: (selectedSql?: string) => void
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
    backgroundColor: 'rgba(99, 102, 241, .48) !important'
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

/** 直接标记选中的文字，避免选区背景层被编辑器布局或主题背景遮挡。 */
const explicitSelectionHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view)
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged) {
      this.decorations = this.buildDecorations(update.view)
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const ranges = view.state.selection.ranges
      .filter((range) => !range.empty)
      .map((range) => Decoration.mark({ class: 'cm-explicit-selection' }).range(range.from, range.to))
    return Decoration.set(ranges, true)
  }
}, {
  decorations: (plugin) => plugin.decorations
})

// ── Component ──────────────────────────────────────────────

export default function SqlEditor({
  value,
  onChange,
  onCursorChange,
  onSelectionChange,
  onCurrentStatementChange,
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onCurrentStatementChangeRef = useRef(onCurrentStatementChange)
  const onRunQueryRef = useRef(onRunQuery)
  const onSaveQueryRef = useRef(onSaveQuery)
  const onFormatSqlRef = useRef(onFormatSql)
  const onCompressSqlRef = useRef(onCompressSql)
  const completionItemsRef = useRef(completionItems)

  // Keep refs updated to avoid re-creating extensions
  onChangeRef.current = onChange
  onCursorChangeRef.current = onCursorChange
  onSelectionChangeRef.current = onSelectionChange
  onCurrentStatementChangeRef.current = onCurrentStatementChange
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
        run: (view) => {
          const { from, to } = view.state.selection.main
          const sqlToRun = from === to
            ? getSqlStatementAtPosition(view.state.doc.toString(), view.state.selection.main.head)
            : view.state.sliceDoc(from, to)
          onRunQueryRef.current?.(sqlToRun)
          return true
        }
      },
      {
        key: 'Mod-Shift-Enter',
        run: (view) => {
          onRunQueryRef.current?.(view.state.doc.toString())
          return true
        }
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
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        onCursorChangeRef.current?.({ line: line.number, column: pos - line.from + 1 })
        const { from, to } = update.state.selection.main
        onSelectionChangeRef.current?.(from === to ? '' : update.state.sliceDoc(from, to))
        onCurrentStatementChangeRef.current?.(getSqlStatementAtPosition(update.state.doc.toString(), pos))
      }
    })

    const desktopContextMenu = EditorView.domEventHandlers({
      contextmenu: (event, view) => {
        event.preventDefault()
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        const selection = view.state.selection.main
        if (position !== null && (position < selection.from || position > selection.to)) {
          view.dispatch({ selection: EditorSelection.cursor(position) })
        }
        view.focus()
        setContextMenu({
          x: Math.min(event.clientX, window.innerWidth - 184),
          y: Math.min(event.clientY, window.innerHeight - 252)
        })
        return true
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
      updateListener,
      desktopContextMenu,
      explicitSelectionHighlight
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
    onCurrentStatementChangeRef.current?.(getSqlStatementAtPosition(value, 0))

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

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu])

  const selectedText = (): string => {
    const view = viewRef.current
    if (!view) return ''
    const { from, to } = view.state.selection.main
    return from === to ? '' : view.state.sliceDoc(from, to)
  }

  const copySelection = async (): Promise<void> => {
    const text = selectedText()
    if (text) await navigator.clipboard.writeText(text)
    setContextMenu(null)
  }

  const cutSelection = async (): Promise<void> => {
    const view = viewRef.current
    const text = selectedText()
    if (!view || !text) return
    await navigator.clipboard.writeText(text)
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: '' }, selection: EditorSelection.cursor(from) })
    view.focus()
    setContextMenu(null)
  }

  const pasteClipboard = async (): Promise<void> => {
    const view = viewRef.current
    if (!view) return
    const text = await navigator.clipboard.readText()
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + text.length) })
    view.focus()
    setContextMenu(null)
  }

  const selectAll = (): void => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) })
    view.focus()
    setContextMenu(null)
  }

  const runFromContextMenu = (runAll: boolean): void => {
    const view = viewRef.current
    if (!view) return
    const selection = selectedText()
    const sqlToRun = runAll
      ? view.state.doc.toString()
      : selection || getSqlStatementAtPosition(view.state.doc.toString(), view.state.selection.main.head)
    onRunQueryRef.current?.(sqlToRun)
    setContextMenu(null)
  }

  const hasSelection = Boolean(selectedText())
  return (
    <>
      <div ref={containerRef} className="sql-editor-cm6" />
      {contextMenu && createPortal(
        <div
          className="sql-editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" disabled={!hasSelection} onClick={() => void cutSelection()}>剪切 <kbd>⌘X</kbd></button>
          <button type="button" disabled={!hasSelection} onClick={() => void copySelection()}>复制 <kbd>⌘C</kbd></button>
          <button type="button" onClick={() => void pasteClipboard()}>粘贴 <kbd>⌘V</kbd></button>
          <button type="button" onClick={selectAll}>全选 <kbd>⌘A</kbd></button>
          <span />
          <button type="button" onClick={() => runFromContextMenu(false)}>{hasSelection ? '运行选中 SQL' : '运行当前 SQL'} <kbd>⌘↵</kbd></button>
          <button type="button" onClick={() => runFromContextMenu(true)}>运行全部 SQL <kbd>⇧⌘↵</kbd></button>
        </div>,
        document.body
      )}
    </>
  )
}
