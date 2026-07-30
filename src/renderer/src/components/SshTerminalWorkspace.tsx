import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { LS_KEYS } from '../utils/localStorage-keys'
// ---- Inline SVG icons (avoid @phosphor-icons/react forwardRef deprecation with React 19) ----
function SvgIcon({
  d,
  size = 16,
  color = 'currentColor',
  weight = 'regular'
}: {
  d: string
  size?: number
  color?: string
  weight?: 'regular' | 'fill'
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill={weight === 'fill' ? 'currentColor' : 'none'}
      stroke={weight === 'fill' ? 'none' : 'currentColor'}
      strokeWidth={weight === 'fill' ? 0 : 16}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color, flexShrink: 0 }}
    >
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  terminalWindow:
    'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm-91,94.25-40,32a8,8,0,1,1-10-12.5L107.19,128,75,102.25a8,8,0,1,1,10-12.5l40,32a8,8,0,0,1,0,12.5ZM176,168H136a8,8,0,0,1,0-16h40a8,8,0,0,1,0,16Z',
  wifiHigh:
    'M128,184a12,12,0,1,0,12,12A12,12,0,0,0,128,184Zm37.48-52.82a84.08,84.08,0,0,0-75,0,8,8,0,1,0,7.48,14.14,68.07,68.07,0,0,1,60,0,8,8,0,0,0,7.48-14.14Zm-69,24.74a52,52,0,0,0-65,0,8,8,0,1,0,6.5,14.62,36,36,0,0,1,52,0,8,8,0,0,0,6.5-14.62Zm99,0a84.08,84.08,0,0,0-50,0,8,8,0,0,0,4.77,15.27A68.14,68.14,0,0,1,194,156.05a8,8,0,1,0,1.52-15.94Zm-37,24.74a52,52,0,0,0-50,0,8,8,0,1,0,5,15.18,36.07,36.07,0,0,1,40,0,8,8,0,0,0,5-15.18Zm74.37-53.47A168.64,168.64,0,0,0,128,52a171.4,171.4,0,0,0-20.61,1.19,8,8,0,0,0,1,15.88A162.6,162.6,0,0,1,128,68,152.65,152.65,0,0,1,224.79,98.35a8,8,0,1,0,8.43-13.6Z',
  wifiSlash:
    'M53.92,34.62A8,8,0,1,0,42.08,45.38l5.47,6.19A171.3,171.3,0,0,0,24.79,98.35a8,8,0,1,0,8.42,13.6A155.82,155.82,0,0,1,62,92.48l8.42,9.52a152.06,152.06,0,0,0-32.57,26.07,8,8,0,1,0,5.19,15.19A136.36,136.36,0,0,1,75,122.24l10.77,12.18A119,119,0,0,0,65.52,154.14a8,8,0,0,0,5,15.19A103.24,103.24,0,0,1,89,159.8l14.6,16.51a84.2,84.2,0,0,0-36.16,30.38,8,8,0,0,0,14.14,7.48,68.07,68.07,0,0,1,60,0,8,8,0,0,0,7.48-14.14,52.08,52.08,0,0,0-18.76-9.62l2.42,2.74a36,36,0,0,1,52,0,8,8,0,0,0,6.5-14.62,52.08,52.08,0,0,0-18.76-9.62l76.72,86.77A8,8,0,0,0,210.92,205l-56.66-64.09,32.08-44a8,8,0,0,0,5.08,15.19A136.36,136.36,0,0,1,171,106.09l33.82,38.25a8,8,0,1,0,8.43-13.6A168.64,168.64,0,0,0,128,52a171.31,171.31,0,0,0-43.53,5.39Z',
  x: 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
  arrowsOut:
    'M216,48V96a8,8,0,0,1-16,0V67.31l-42.34,42.35a8,8,0,0,1-11.32-11.32L188.69,56H160a8,8,0,0,1,0-16h48A8,8,0,0,1,216,48ZM98.34,146.34,56,188.69V160a8,8,0,0,0-16,0v48a8,8,0,0,0,8,8H96a8,8,0,0,0,0-16H67.31l42.35-42.34a8,8,0,0,0-11.32-11.32ZM208,152a8,8,0,0,0-8,8v28.69l-42.34-42.35a8,8,0,0,0-11.32,11.32L188.69,200H160a8,8,0,0,0,0,16h48a8,8,0,0,0,8-8V160A8,8,0,0,0,208,152ZM67.31,56H96a8,8,0,0,0,0-16H48a8,8,0,0,0-8,8V96a8,8,0,0,0,16,0V67.31l42.34,42.35a8,8,0,0,0,11.32-11.32Z'
} as const
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { ArrowUp, ArrowsClockwise, Copy, DownloadSimple, File, Folder, FolderOpen, Lightning, MagnifyingGlass, Plus, Trash, UploadSimple } from '@phosphor-icons/react'
import '@xterm/xterm/css/xterm.css'
import type { DatabaseConnection } from '@/shared/connections'
import type { SshFileEntry } from '@/shared/ssh-files'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useTerminalTabsStore } from '../stores/tabs/useTerminalTabs'

const PRESET_SNIPPETS = [
  { label: 'top', cmd: 'top\n' },
  { label: 'htop', cmd: 'htop\n' },
  { label: 'docker ps', cmd: 'docker ps\n' },
  { label: 'systemctl status', cmd: 'systemctl status ' },
  { label: 'df -h', cmd: 'df -h\n' },
  { label: 'free -h', cmd: 'free -h\n' },
  { label: 'netstat -tulpn', cmd: 'netstat -tulpn\n' },
  { label: 'ps aux', cmd: 'ps aux\n' },
  { label: 'tail -f log', cmd: 'tail -f /var/log/syslog\n' },
  { label: 'ls -la', cmd: 'ls -la\n' }
]

// ---------------------------------------------------------------------------
// xterm.js dark theme
// ---------------------------------------------------------------------------
const xtermTheme = {
  background: '#1a1a2e',
  foreground: '#c0c0d0',
  cursor: '#c0c0d0',
  cursorAccent: '#1a1a2e',
  selectionBackground: '#3b3b6e',
  selectionForeground: '#ffffff',
  black: '#1a1a2e',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
}

const FONT_SIZE_KEY = LS_KEYS.SSH_FONT_SIZE
const FILE_PANEL_WIDTH_KEY = LS_KEYS.SSH_FILE_PANEL_WIDTH

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const formatFileTime = (timestamp: number): string => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
}).format(timestamp)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  connection: DatabaseConnection
  sessionId: string
  active: boolean
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function SshTerminalWorkspace({ connection, sessionId, active, onClose }: Props) {
  const createSshTerminal = useTerminalTabsStore((state) => state.createSshTerminal)

  // ---- state ---------------------------------------------------------------
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectLatency, setConnectLatency] = useState<number | null>(null)
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem(FONT_SIZE_KEY)
    return stored ? Number(stored) : 13
  })
  const [cols, setCols] = useState(80)
  const [rows, setRows] = useState(24)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [filePanelOpen, setFilePanelOpen] = useState(false)
  const [remotePath, setRemotePath] = useState('.')
  const [remoteFiles, setRemoteFiles] = useState<SshFileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<SshFileEntry | null>(null)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileMessage, setFileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SshFileEntry | null>(null)
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; entry: SshFileEntry } | null>(null)
  const [filePanelWidth, setFilePanelWidth] = useState(() => {
    const stored = Number(localStorage.getItem(FILE_PANEL_WIDTH_KEY))
    return Number.isFinite(stored) && stored >= 260 ? stored : 340
  })
  const [showSnippets, setShowSnippets] = useState(false)
  const [fileFilter, setFileFilter] = useState('')
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const copyRemotePath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(() => {})
    setFileContextMenu(null)
    setFileMessage({ type: 'success', text: '已复制远程文件路径' })
  }, [])

  const copyFileName = useCallback((name: string) => {
    navigator.clipboard.writeText(name).catch(() => {})
    setFileContextMenu(null)
    setFileMessage({ type: 'success', text: '已复制文件名' })
  }, [])

  const selectAllTerminal = useCallback(() => {
    terminalRef.current?.selectAll()
    setContextMenu(null)
  }, [])


  const pathSegments = useMemo(() => {
    if (!remotePath || remotePath === '.') return [{ label: '/', path: '/' }]
    const parts = remotePath.split('/').filter(Boolean)
    const segments = [{ label: '/', path: '/' }]
    let current = ''
    for (const p of parts) {
      current += `/${p}`
      segments.push({ label: p, path: current })
    }
    return segments
  }, [remotePath])

  const filteredRemoteFiles = useMemo(() => {
    if (!fileFilter.trim()) return remoteFiles
    const kw = fileFilter.toLowerCase()
    return remoteFiles.filter((f) => f.name.toLowerCase().includes(kw))
  }, [remoteFiles, fileFilter])

  // ---- refs ----------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isDisconnectingRef = useRef(false)
  const outputSubscriptionRef = useRef<(() => void) | null>(null)
  const closedSubscriptionRef = useRef<(() => void) | null>(null)
  const connectGenerationRef = useRef(0)
  const fontSizeRef = useRef(fontSize)
  const filePanelWidthRef = useRef(filePanelWidth)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  fontSizeRef.current = fontSize
  filePanelWidthRef.current = filePanelWidth

  // ---- helpers -------------------------------------------------------------
  const ssh = () => window.omnidb.ssh

  const loadRemoteDirectory = useCallback(async (path: string) => {
    if (!connected) return
    setFileBusy(true)
    setFileMessage(null)
    const result = await ssh().listFiles(sessionId, path)
    setFileBusy(false)
    if (!result.success) {
      setFileMessage({ type: 'error', text: result.message })
      return
    }
    setRemotePath(result.path)
    setRemoteFiles(result.entries)
    setSelectedFile(null)
  }, [connected, sessionId])

  const showFileResult = useCallback((success: boolean, message: string, canceled?: boolean) => {
    if (canceled) return
    setFileMessage({ type: success ? 'success' : 'error', text: message })
  }, [])

  const uploadRemoteFiles = useCallback(async () => {
    if (!connected || fileBusy) return
    setFileBusy(true)
    const result = await ssh().uploadFiles(sessionId, remotePath)
    setFileBusy(false)
    if (result.success) await loadRemoteDirectory(remotePath)
    showFileResult(result.success, result.message, result.canceled)
  }, [connected, fileBusy, loadRemoteDirectory, remotePath, sessionId, showFileResult])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (
      e.clientX < rect.left || e.clientX >= rect.right ||
      e.clientY < rect.top  || e.clientY >= rect.bottom
    ) {
      setIsDraggingOver(false)
    }
  }, [])

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    if (!connected || fileBusy) return
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (!droppedFiles.length) return
    setFileBusy(true)
    let successCount = 0
    for (const file of droppedFiles) {
      const localPath = (file as File & { path?: string }).path
      if (!localPath) continue
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sshApi = ssh() as any
        if (typeof sshApi.uploadFilePath === 'function') {
          const result = await sshApi.uploadFilePath(sessionId, remotePath, localPath)
          if (result?.success) successCount++
        }
      } catch { /* ignore */ }
    }
    setFileBusy(false)
    if (successCount > 0) {
      await loadRemoteDirectory(remotePath)
      setFileMessage({ type: 'success', text: `已上传 ${successCount} 个文件` })
    } else {
      void uploadRemoteFiles()
    }
  }, [connected, fileBusy, loadRemoteDirectory, remotePath, sessionId, uploadRemoteFiles])

  const downloadRemoteFile = useCallback(async (entry?: SshFileEntry) => {
    const target = entry ?? selectedFile
    if (!target || target.type === 'directory' || fileBusy) return
    setFileBusy(true)
    const result = await ssh().downloadFile(sessionId, target)
    setFileBusy(false)
    showFileResult(result.success, result.message, result.canceled)
  }, [fileBusy, selectedFile, sessionId, showFileResult])

  const openRemoteEntry = useCallback(async (entry: SshFileEntry) => {
    setFileContextMenu(null)
    setSelectedFile(entry)
    if (entry.type === 'directory') {
      await loadRemoteDirectory(entry.path)
      return
    }
    if (fileBusy) return
    setFileBusy(true)
    const result = await ssh().openFile(sessionId, entry)
    setFileBusy(false)
    showFileResult(result.success, result.message, result.canceled)
  }, [fileBusy, loadRemoteDirectory, sessionId, showFileResult])

  const beginFilePanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = filePanelWidthRef.current
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (moveEvent: PointerEvent): void => {
      const maximum = Math.max(320, Math.min(640, window.innerWidth * 0.6))
      setFilePanelWidth(Math.max(260, Math.min(maximum, startWidth + startX - moveEvent.clientX)))
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      localStorage.setItem(FILE_PANEL_WIDTH_KEY, String(Math.round(filePanelWidthRef.current)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }, [])

  const deleteRemoteFile = useCallback(async () => {
    if (!deleteTarget || fileBusy) return
    setFileBusy(true)
    const result = await ssh().deleteFile(sessionId, deleteTarget)
    setFileBusy(false)
    setDeleteTarget(null)
    if (result.success) await loadRemoteDirectory(remotePath)
    showFileResult(result.success, result.message, result.canceled)
  }, [deleteTarget, fileBusy, loadRemoteDirectory, remotePath, sessionId, showFileResult])

  const clearSubscriptions = useCallback(() => {
    outputSubscriptionRef.current?.()
    closedSubscriptionRef.current?.()
    outputSubscriptionRef.current = null
    closedSubscriptionRef.current = null
  }, [])

  const sendInput = useCallback(
    (text: string) => {
      if (!connected) return
      ssh().write(sessionId, text)
    },
    [connected, sessionId]
  )
  const sendInputRef = useRef(sendInput)
  sendInputRef.current = sendInput

  /** Sync terminal dimensions back to the SSH server */
  const resizePty = useCallback(() => {
    const t = terminalRef.current
    if (!t) return
    setCols(t.cols)
    setRows(t.rows)
    ssh().resize(sessionId, t.rows, t.cols)
  }, [sessionId])

  // ---- connect / disconnect ------------------------------------------------
  const disconnect = useCallback(() => {
    if (isDisconnectingRef.current) return
    isDisconnectingRef.current = true
    connectGenerationRef.current += 1
    clearSubscriptions()
    ssh().disconnect(sessionId)
    setConnected(false)
    setConnectLatency(null)
    useConnectionStore.getState().actions.setConnectionLatency(connection.id, null)
    setTimeout(() => {
      isDisconnectingRef.current = false
    }, 200)
  }, [clearSubscriptions, connection.id, sessionId])

  const connect = useCallback(async () => {
    const t = terminalRef.current
    if (!t) return
    const generation = connectGenerationRef.current + 1
    connectGenerationRef.current = generation
    clearSubscriptions()
    isDisconnectingRef.current = false
    t.clear()
    setConnecting(true)
    setConnectError(null)

    const sshCfg = connection.ssh
    // Fallback to top-level host/port/username for SSH-engine connections
    // (SSH data is mirrored at both levels; publicSecurity() may return empty host)
    const host = sshCfg?.host || connection.host
    const port = sshCfg?.port || connection.port || 22
    const username = sshCfg?.username || connection.username
    if (!host) {
      t.write('\r\n\x1b[31mSSH 配置不完整\x1b[0m\r\n')
      setConnecting(false)
      setConnectError('SSH 配置不完整')
      return
    }

    // Subscribe before opening the shell. Besides retaining the first MOTD
    // bytes, preload uses this call to evict any orphan listener for sessionId.
    outputSubscriptionRef.current = ssh().onOutput(sessionId, (data: string) => {
      if (generation === connectGenerationRef.current) terminalRef.current?.write(data)
    })

    const startTime = performance.now()
    // Pass connectionId so SshService can retrieve the encrypted password from the DB
    const result = await ssh().connect({
      sessionId,
      connectionId: connection.id,
      host,
      port,
      username,
      authType: sshCfg?.authType || 'password',
      password: sshCfg?.password || '',
      privateKeyPath: sshCfg?.privateKeyPath || '',
      passphrase: sshCfg?.passphrase || ''
    })

    if (generation !== connectGenerationRef.current) return
    setConnecting(false)

    if (!result.success) {
      clearSubscriptions()
      t.write(`\r\n\x1b[31m连接失败: ${result.message}\x1b[0m\r\n`)
      setConnectError(result.message)
      setConnectLatency(null)
      useConnectionStore.getState().actions.setConnectionLatency(connection.id, null)
      return
    }

    setConnectError(null)
    const elapsed = Math.round(performance.now() - startTime)
    setConnectLatency(elapsed)
    useConnectionStore.getState().actions.setConnectionLatency(connection.id, elapsed)

    // subscribe to close
    closedSubscriptionRef.current = ssh().onClosed(sessionId, () => {
      if (!isDisconnectingRef.current) {
        terminalRef.current?.write('\r\n\x1b[33m连接已断开\x1b[0m\r\n')
        setConnected(false)
        setConnectLatency(null)
        setConnectError(null)
        useConnectionStore.getState().actions.setConnectionLatency(connection.id, null)
      }
    })

    setConnected(true)
    resizePty()
  }, [clearSubscriptions, connection, sessionId, resizePty])

  // ---- font size persistence -----------------------------------------------
  useEffect(() => {
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize))
    const t = terminalRef.current
    if (t) {
      t.options.fontSize = fontSize
      fitAddonRef.current?.fit()
      resizePty()
    }
  }, [fontSize, resizePty])

  useEffect(() => {
    if (filePanelOpen && connected) void loadRemoteDirectory(remotePath)
    if (!connected) {
      setRemoteFiles([])
      setSelectedFile(null)
    }
    // Only reload when the panel or connection state changes. Navigation calls
    // loadRemoteDirectory directly and updates remotePath after a successful read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePanelOpen, connected])

  // ---- initialise xterm.js --------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      theme: xtermTheme,
      fontSize,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: true,
      cols: 80,
      rows: 24
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    try {
      const webgl = new WebglAddon()
      term.loadAddon(webgl)
    } catch {
      console.warn('WebGL renderer unavailable, using canvas fallback')
    }
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    term.open(container)
    fitAddon.fit()

    // keyboard → SSH
    term.onData((data) => {
      sendInputRef.current(data)
    })

    // custom key shortcuts (intercept before xterm)
    term.attachCustomKeyEventHandler((event) => {
      const { ctrlKey, metaKey, key, shiftKey, altKey } = event

      // Ctrl/Cmd+F → search
      if ((ctrlKey || metaKey) && !shiftKey && !altKey && key === 'f') {
        setShowSearch((prev) => !prev)
        return false
      }

      // Ctrl/Cmd+V → paste
      if ((ctrlKey || metaKey) && !shiftKey && !altKey && key === 'v') {
        navigator.clipboard
          .readText()
          .then((t) => {
            if (t) sendInputRef.current(t)
          })
          .catch(() => {})
        return false
      }

      // Ctrl+L → clear locally
      if (ctrlKey && !metaKey && !altKey && !shiftKey && key === 'l') {
        term.clear()
        return false
      }

      // Font size
      if (ctrlKey && !metaKey && !altKey) {
        if (key === '+' || key === '=') {
          setFontSize((prev) => Math.min(24, prev + 1))
          return false
        }
        if (key === '-') {
          setFontSize((prev) => Math.max(9, prev - 1))
          return false
        }
        if (key === '0') {
          setFontSize(13)
          return false
        }
      }

      return true
    })

    // resize observer
    const ro = new ResizeObserver(() => {
      fitAddon.fit()
      resizePty()
    })
    ro.observe(container)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // auto connect
    connect()

    return () => {
      ro.disconnect()
      disconnect()
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- context menu handlers ------------------------------------------------
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!fileContextMenu) return
    const close = (): void => setFileContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [fileContextMenu])

  const copySelection = useCallback(() => {
    const selection = terminalRef.current?.getSelection()
    if (selection) {
      navigator.clipboard.writeText(selection).catch(() => {})
    }
    closeContextMenu()
  }, [closeContextMenu])

  const pasteToTerminal = useCallback(() => {
    navigator.clipboard
      .readText()
      .then((t) => {
        if (t) sendInputRef.current(t)
      })
      .catch(() => {})
    closeContextMenu()
  }, [closeContextMenu])

  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear()
    closeContextMenu()
  }, [closeContextMenu])

  // ---- host label -----------------------------------------------------------
  const hostLabel = useMemo(() => {
    const sshCfg = connection.ssh
    return sshCfg ? `${sshCfg.username}@${sshCfg.host}` : ''
  }, [connection])

  const sizeLabel = useMemo(() => `${cols}×${rows}`, [cols, rows])

  // ---- render ---------------------------------------------------------------
  const headerBg = '#16213e'
  const borderCol = '#0f3460'
  const textCol = '#c0c0d0'
  const mutedCol = '#8892b0'
  const accentCol = '#4fc3f7'

  return (
    <section className={`ssh-terminal-workspace${active ? ' active' : ''}`}>
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 30,
          padding: '0 8px',
          background: headerBg,
          borderBottom: `1px solid ${borderCol}`,
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SvgIcon d={ICONS.terminalWindow} size={18} weight="fill" color={accentCol} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: textCol,
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {connection.name}
          </span>
          {connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <SvgIcon d={ICONS.wifiHigh} size={14} color="#4caf50" />
              {connectLatency !== null && (
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    color: connectLatency <= 200 ? '#4caf50' : connectLatency <= 800 ? '#ffb74d' : '#e57373',
                    background: 'rgba(255, 255, 255, 0.08)',
                    padding: '1px 5px',
                    borderRadius: 3
                  }}
                  title={`SSH 握手与连接建立耗时 ${connectLatency} ms`}
                >
                  {connectLatency}ms
                </span>
              )}
            </div>
          ) : (
            <SvgIcon d={ICONS.wifiSlash} size={14} color="#f44336" />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <button
            type="button"
            title="为当前 SSH 连接新建独立会话"
            aria-label="新建 SSH 会话"
            onClick={() => createSshTerminal(connection)}
            className="ssh-file-toggle"
            style={{ ...btnBaseStyle, width: 'auto', padding: '0 7px', gap: 4 }}
          >
            <Plus size={14} weight="bold" />
            <span style={{ fontSize: 11 }}>新建会话</span>
          </button>
          <button
            type="button"
            title={showSnippets ? '隐藏快捷指令' : '常用快捷指令面板'}
            onClick={() => setShowSnippets((current) => !current)}
            className={`ssh-file-toggle${showSnippets ? ' active' : ''}`}
            style={{ ...btnBaseStyle, width: 'auto', padding: '0 6px', gap: 4 }}
          >
            <Lightning size={14} weight="fill" />
            <span style={{ fontSize: 11 }}>快捷指令</span>
          </button>
          <button
            title={filePanelOpen ? '关闭文件管理' : '打开文件管理'}
            onClick={() => setFilePanelOpen((current) => !current)}
            className={`ssh-file-toggle${filePanelOpen ? ' active' : ''}`}
            style={{ ...btnBaseStyle }}
          >
            <FolderOpen size={15} weight={filePanelOpen ? 'fill' : 'regular'} />
          </button>
          <button
            title="缩小字体 (Ctrl+-)"
            onClick={() => setFontSize((p) => Math.max(9, p - 1))}
            style={{
              ...btnBaseStyle,
              fontSize: 12,
              width: 22,
              height: 22,
              borderRadius: 4,
              color: mutedCol
            }}
          >
            A-
          </button>
          <button
            title="放大字体 (Ctrl++)"
            onClick={() => setFontSize((p) => Math.min(24, p + 1))}
            style={{
              ...btnBaseStyle,
              fontSize: 12,
              width: 22,
              height: 22,
              borderRadius: 4,
              color: mutedCol
            }}
          >
            A+
          </button>
          <span style={{ fontSize: 10, color: mutedCol, minWidth: 26, textAlign: 'center' }}>
            {fontSize}px
          </span>
          <button
            title="重新连接"
            onClick={connect}
            style={{
              ...btnBaseStyle,
              fontSize: 13,
              width: 22,
              height: 22,
              borderRadius: 4,
              color: mutedCol
            }}
          >
            ↻
          </button>
          <button
            title="关闭终端"
            onClick={onClose}
            style={{
              ...btnBaseStyle,
              fontSize: 13,
              width: 22,
              height: 22,
              borderRadius: 4,
              color: mutedCol
            }}
          >
            <SvgIcon d={ICONS.x} size={14} />
          </button>
        </div>
      </div>

      {/* ── Snippets bar ── */}
      {showSnippets && (
        <div className="ssh-snippets-drawer">
          <span className="ssh-snippets-title">快捷指令:</span>
          {PRESET_SNIPPETS.map((snip) => (
            <button
              key={snip.label}
              type="button"
              className="ssh-snippet-badge"
              disabled={!connected}
              onClick={() => sendInput(snip.cmd)}
            >
              <Lightning size={11} weight="fill" />
              <span>{snip.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Terminal and file manager ── */}
      <div className="ssh-terminal-body">
        <div className="ssh-terminal-pane">
          {showSearch && (
            <div className="ssh-search-bar">
              <MagnifyingGlass size={13} color="#8892b0" />
              <input
                autoFocus
                className="ssh-search-input"
                value={searchQuery}
                placeholder="搜索终端内容…  Enter 下一个 · Shift+Enter 上一个"
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (e.target.value && searchAddonRef.current) {
                    searchAddonRef.current.findNext(e.target.value, { incremental: true, caseSensitive: false })
                  } else if (!e.target.value) {
                    terminalRef.current?.clearSelection()
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (e.shiftKey) {
                      searchAddonRef.current?.findPrevious(searchQuery, { caseSensitive: false })
                    } else {
                      searchAddonRef.current?.findNext(searchQuery, { caseSensitive: false })
                    }
                  } else if (e.key === 'Escape') {
                    setShowSearch(false)
                    setSearchQuery('')
                    terminalRef.current?.clearSelection()
                    terminalRef.current?.focus()
                  }
                }}
              />
              <button
                className="ssh-search-nav"
                title="上一个 (Shift+Enter)"
                onClick={() => searchAddonRef.current?.findPrevious(searchQuery, { caseSensitive: false })}
              >↑</button>
              <button
                className="ssh-search-nav"
                title="下一个 (Enter)"
                onClick={() => searchAddonRef.current?.findNext(searchQuery, { caseSensitive: false })}
              >↓</button>
              <button
                className="ssh-search-close"
                onClick={() => {
                  setShowSearch(false)
                  setSearchQuery('')
                  terminalRef.current?.clearSelection()
                  terminalRef.current?.focus()
                }}
              >✕</button>
            </div>
          )}
          <div
            ref={containerRef}
            onContextMenu={handleContextMenu}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {filePanelOpen && (
          <>
          <div className="ssh-file-resizer" title="拖动调整文件面板宽度" onPointerDown={beginFilePanelResize} />
          <aside className="ssh-file-panel" style={{ width: filePanelWidth, flexBasis: filePanelWidth }}>
            <header>
              <strong><FolderOpen size={15} weight="fill" />文件管理</strong>
              <button title="刷新" disabled={!connected || fileBusy} onClick={() => void loadRemoteDirectory(remotePath)}><ArrowsClockwise /></button>
            </header>
            <div className="ssh-file-path" title={remotePath}>
              <button
                title="返回上级目录"
                disabled={!connected || remotePath === '/'}
                onClick={() => void loadRemoteDirectory(remotePath === '/' ? '/' : `${remotePath}/..`)}
              ><ArrowUp /></button>
              <div className="ssh-breadcrumbs">
                {pathSegments.map((seg, idx) => (
                  <span key={seg.path} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {idx > 0 && <span className="ssh-breadcrumb-sep">/</span>}
                    <button
                      type="button"
                      className="ssh-breadcrumb-item"
                      disabled={!connected || fileBusy}
                      onClick={() => void loadRemoteDirectory(seg.path)}
                    >
                      {seg.label}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="ssh-file-toolbar">
              <button disabled={!connected || fileBusy} onClick={() => void uploadRemoteFiles()}><UploadSimple />上传</button>
              <button disabled={!selectedFile || selectedFile.type === 'directory' || fileBusy} onClick={() => void downloadRemoteFile()}><DownloadSimple />下载</button>
              <button className="danger" disabled={!selectedFile || fileBusy} onClick={() => setDeleteTarget(selectedFile)}><Trash />删除</button>
            </div>
            <div className="ssh-file-search-box">
              <MagnifyingGlass size={13} />
              <input
                className="ssh-file-search-input"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                placeholder="搜索当前目录文件..."
              />
            </div>
            {fileMessage && <div className={`ssh-file-message ${fileMessage.type}`}>{fileMessage.text}</div>}
            <div
              className={`ssh-file-list${isDraggingOver ? ' drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => void handleFileDrop(e)}
            >
              {isDraggingOver && (
                <div className="ssh-drag-overlay">
                  <UploadSimple size={30} />
                  <span>释放以上传文件</span>
                </div>
              )}
              {fileBusy && !filteredRemoteFiles.length ? <div className="ssh-file-empty">正在读取目录…</div> : filteredRemoteFiles.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className={selectedFile?.path === entry.path ? 'selected' : ''}
                  title={entry.path}
                  onClick={() => {
                    setSelectedFile(entry)
                    if (entry.type === 'directory') void openRemoteEntry(entry)
                  }}
                  onDoubleClick={() => {
                    if (entry.type !== 'directory') void openRemoteEntry(entry)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setSelectedFile(entry)
                    setFileContextMenu({
                      x: Math.min(event.clientX, window.innerWidth - 170),
                      y: Math.min(event.clientY, window.innerHeight - 190),
                      entry
                    })
                  }}
                >
                  {entry.type === 'directory' ? <Folder weight="fill" /> : <File />}
                  <span><strong>{entry.name}</strong><small>{entry.type === 'directory' ? '文件夹' : formatFileSize(entry.size)} · {formatFileTime(entry.modifiedAt)}</small></span>
                </button>
              ))}
              {!fileBusy && !filteredRemoteFiles.length && <div className="ssh-file-empty">此目录为空</div>}
            </div>
            {deleteTarget && (
              <div className="ssh-file-delete-confirm">
                <strong>确认删除“{deleteTarget.name}”？</strong>
                <small>{deleteTarget.type === 'directory' ? '仅支持删除空目录。' : '删除后无法恢复。'}</small>
                <div><button onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" onClick={() => void deleteRemoteFile()}>删除</button></div>
              </div>
            )}
          </aside>
          </>
        )}
      </div>

      {/* ── Disconnected / Connecting overlay ── */}
      {!connected && (
        <div
          onClick={connecting ? undefined : connect}
          style={{
            position: 'absolute',
            inset: '30px 0 24px 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            cursor: connecting ? 'default' : 'pointer',
            gap: 10
          }}
        >
          {connecting ? (
            <>
              <div style={{
                width: 28,
                height: 28,
                border: `3px solid ${accentCol}33`,
                borderTopColor: accentCol,
                borderRadius: '50%',
                animation: 'ssh-spin 0.8s linear infinite'
              }} />
              <span style={{ color: '#aaa', fontSize: 13 }}>连接中…</span>
            </>
          ) : connectError ? (
            <>
              <SvgIcon d={ICONS.arrowsOut} size={28} color="#ef4444" />
              <span style={{ color: '#ef4444', fontSize: 13, maxWidth: 300, textAlign: 'center', wordBreak: 'break-word' }}>{connectError}</span>
              <span style={{ color: '#888', fontSize: 11 }}>点击重新连接</span>
            </>
          ) : (
            <>
              <SvgIcon d={ICONS.arrowsOut} size={28} color={accentCol} />
              <span style={{ color: '#aaa', fontSize: 13 }}>点击重新连接</span>
            </>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 24,
          padding: '0 10px',
          background: headerBg,
          borderTop: `1px solid ${borderCol}`,
          flexShrink: 0,
          fontSize: 10,
          color: mutedCol
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>
            {sizeLabel} [{connected ? '已连接' : '未连接'}]
          </span>
          {hostLabel && <span>{hostLabel}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <kbd style={kbdStyle(mutedCol)}>Ctrl+C</kbd> 复制
          <kbd style={kbdStyle(mutedCol)}>Ctrl+V</kbd> 粘贴
          <kbd style={kbdStyle(mutedCol)}>Ctrl+L</kbd> 清屏
          <kbd style={kbdStyle(mutedCol)}>Ctrl±</kbd> 字体
        </div>
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && createPortal(
        <div
          style={{
            position: 'fixed',
            zIndex: 9999,
            left: contextMenu.x,
            top: contextMenu.y,
            background: headerBg,
            border: `1px solid ${borderCol}`,
            borderRadius: 8,
            padding: '4px 0',
            minWidth: 168,
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={ctxItemStyle(textCol)} onClick={copySelection}>复制</div>
          <div style={ctxItemStyle(textCol)} onClick={pasteToTerminal}>粘贴</div>
          <div style={ctxItemStyle(textCol)} onClick={selectAllTerminal}>全选</div>
          <div style={ctxDividerStyle(borderCol)} />
          <div style={ctxItemStyle(textCol)} onClick={() => { setShowSearch(true); setContextMenu(null) }}>
            查找
            <span style={{ float: 'right', opacity: 0.45, fontSize: 10 }}>Ctrl+F</span>
          </div>
          <div style={ctxDividerStyle(borderCol)} />
          <div style={ctxItemStyle(textCol)} onClick={clearTerminal}>清空终端</div>
        </div>,
        document.body
      )}
      {fileContextMenu && createPortal(
        <div
          className="ssh-file-context-menu"
          style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button onClick={() => void openRemoteEntry(fileContextMenu.entry)}><FolderOpen />打开</button>
          <button
            disabled={fileContextMenu.entry.type === 'directory' || fileBusy}
            onClick={() => {
              setSelectedFile(fileContextMenu.entry)
              setFileContextMenu(null)
              void downloadRemoteFile(fileContextMenu.entry)
            }}
          ><DownloadSimple />下载</button>
          <span />
          <button onClick={() => copyRemotePath(fileContextMenu.entry.path)}><Copy />复制路径</button>
          <button onClick={() => copyFileName(fileContextMenu.entry.name)}><Copy />复制文件名</button>
          <span />
          <button className="danger" disabled={fileBusy} onClick={() => { setDeleteTarget(fileContextMenu.entry); setFileContextMenu(null) }}><Trash />删除</button>
        </div>,
        document.body
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// inline styles
// ---------------------------------------------------------------------------
const btnBaseStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0
}

const kbdStyle = (color: string): React.CSSProperties => ({
  background: 'rgba(128,128,128,0.15)',
  borderRadius: 3,
  padding: '0px 4px',
  fontSize: 9,
  fontFamily: 'inherit',
  color
})

const ctxItemStyle = (color: string): React.CSSProperties => ({
  padding: '6px 16px',
  cursor: 'pointer',
  fontSize: 13,
  color,
  userSelect: 'none'
})

const ctxDividerStyle = (borderColor: string): React.CSSProperties => ({
  height: 1,
  margin: '4px 8px',
  background: borderColor
})
