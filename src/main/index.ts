// Suppress Node.js experimental SQLite warning (stable in future Node.js versions)
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && warning.message.includes('SQLite')) return
  console.warn(warning)
})

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { readFile, stat as fsStat } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { ConnectionRepository } from './database/connection-repository'
import { ConnectionService } from './services/connection-service'
import { expectInt, expectString, expectBool, expectObject, expectOptionalInt, expectOptionalString, expectOneOf } from './services/ipc-validators'
import { transactionManager } from './services/transaction-manager'
import { shutdownDbQueryWorker } from './services/db-query-runtime'
import { shutdownSqliteWorker } from './services/sqlite-runtime'
import { MemoryMonitorService } from './services/memory-monitor-service'
import { connectionEvictionScheduler } from './services/connection-eviction-scheduler'
import type { AiAgentRequest, AiExecuteProposalRequest, AiSaveModelInput } from '../shared/ai-agent'
import type { AppLanguage, AppPreferences, ConnectionSecurityFileKind, CopyTableInput, CreateConnectionInput, CreateTableInput, DatabaseDefinitionInput, ExecuteImportInput, ExecuteSqlFileInput, ExportTableCustomInput, QueryDeleteRowInput, QueryUpdateRowInput, RenameTableInput, SaveQueryInput, TableDataFilter, TransferTableDataInput, UpdateConnectionInput, UpdateDatabaseInput, UpdateTableInput } from '../shared/connections'
import type { SshFileEntry } from '../shared/ssh-files'
import { IpcChannel } from '../shared/ipc-channels'

const PRODUCT_NAME = 'QuillDB'
type AiAgentServiceType = import('./services/ai-agent-service').AiAgentService
type ImportExportServiceType = import('./services/import-export-service').ImportExportService
type SshServiceType = import('./services/ssh-service').SshService
// 保留旧版数据目录，升级品牌后继续使用用户已有的连接、查询和偏好设置。
app.setPath('userData', join(app.getPath('appData'), 'omnidb'))
const preferencesPath = join(app.getPath('userData'), 'preferences.json')
const loadApplicationLanguage = (): AppLanguage => {
  try {
    const stored = JSON.parse(readFileSync(preferencesPath, 'utf8')) as Partial<AppPreferences>
    return stored.language === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}
let applicationLanguage: AppLanguage = loadApplicationLanguage()
const getApplicationIconPath = (): string => app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../resources/icon.png')

const showAboutDialog = (): void => {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  targetWindow?.webContents.send(IpcChannel.app.openAbout)
}

app.commandLine.appendSwitch('lang', applicationLanguage)
// 内存与内核启动优化：禁用 GPU 硬件加速以节省 GPU / 渲染进程显存及物理内存占用 (~30-60MB)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

// 内核启动提速：禁用冗余插件、浏览器扩展和后台网络轮询，减少 Chromium 内核初始化耗时
app.commandLine.appendSwitch('disable-plugins')
app.commandLine.appendSwitch('disable-extensions')
app.commandLine.appendSwitch('disable-background-networking')

// V8 内存优化：暴露 GC 接口以便 MemoryMonitor 可主动触发垃圾回收，
// 限制堆上限防止主进程 OOM，--optimize-for-size 优先回收内存而非速度
app.commandLine.appendSwitch('js-flags', '--expose-gc --max-old-space-size=512 --optimize-for-size')
app.setName(PRODUCT_NAME)
process.title = PRODUCT_NAME
app.setAppUserModelId('com.quilldb.desktop')
app.setAboutPanelOptions({
  applicationName: PRODUCT_NAME,
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright: 'Copyright © 2026 CodeAce',
  iconPath: getApplicationIconPath()
})

const createApplicationMenu = (): void => {
  const english = applicationLanguage === 'en-US'
  const label = (zh: string, en: string): string => english ? en : zh
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: PRODUCT_NAME,
          submenu: [
            {
              label: label(`关于 ${PRODUCT_NAME}`, `About ${PRODUCT_NAME}`),
              click: showAboutDialog
            },
            { type: 'separator' as const },
            { label: label('服务', 'Services'), role: 'services' as const },
            { type: 'separator' as const },
            { label: label(`隐藏 ${PRODUCT_NAME}`, `Hide ${PRODUCT_NAME}`), role: 'hide' as const },
            { label: label('隐藏其他应用', 'Hide Others'), role: 'hideOthers' as const },
            { label: label('全部显示', 'Show All'), role: 'unhide' as const },
            { type: 'separator' as const },
            { label: label(`退出 ${PRODUCT_NAME}`, `Quit ${PRODUCT_NAME}`), role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: label('文件', 'File'),
      submenu: [
        {
          label: label('新建连接', 'New Connection'),
          accelerator: 'CmdOrCtrl+N',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send(IpcChannel.connections.openCreateDialog)
        },
        { label: label('新建查询', 'New Query'), accelerator: 'CmdOrCtrl+T', enabled: false },
        { label: label('打开 SQL 文件…', 'Open SQL File…'), accelerator: 'CmdOrCtrl+O', enabled: false },
        { type: 'separator' },
        process.platform === 'darwin'
          ? { label: label('关闭窗口', 'Close Window'), role: 'close' }
          : { label: label(`退出 ${PRODUCT_NAME}`, `Quit ${PRODUCT_NAME}`), role: 'quit' }
      ]
    },
    {
      label: label('编辑', 'Edit'),
      submenu: [
        { label: label('撤销', 'Undo'), role: 'undo' },
        { label: label('重做', 'Redo'), role: 'redo' },
        { type: 'separator' },
        { label: label('剪切', 'Cut'), role: 'cut' },
        { label: label('复制', 'Copy'), role: 'copy' },
        { label: label('粘贴', 'Paste'), role: 'paste' },
        ...(process.platform === 'darwin'
          ? [
              { label: label('粘贴并匹配样式', 'Paste and Match Style'), role: 'pasteAndMatchStyle' as const },
              { label: label('删除', 'Delete'), role: 'delete' as const },
              { label: label('全选', 'Select All'), role: 'selectAll' as const },
              { type: 'separator' as const },
              { label: label('语音', 'Speech'), submenu: [
                { label: label('开始朗读', 'Start Speaking'), role: 'startSpeaking' as const },
                { label: label('停止朗读', 'Stop Speaking'), role: 'stopSpeaking' as const }
              ] }
            ]
          : [
              { label: label('删除', 'Delete'), role: 'delete' as const },
              { type: 'separator' as const },
              { label: label('全选', 'Select All'), role: 'selectAll' as const }
            ])
      ]
    },
    {
      label: label('视图', 'View'),
      submenu: [
        { label: label('重新加载', 'Reload'), role: 'reload' },
        { label: label('强制重新加载', 'Force Reload'), role: 'forceReload' },
        { type: 'separator' },
        { label: label('实际大小', 'Actual Size'), role: 'resetZoom' },
        { label: label('放大', 'Zoom In'), role: 'zoomIn' },
        { label: label('缩小', 'Zoom Out'), role: 'zoomOut' },
        { type: 'separator' },
        { label: label('进入全屏', 'Toggle Full Screen'), role: 'togglefullscreen' }
      ]
    },
    {
      label: label('窗口', 'Window'),
      submenu: [
        { label: label('最小化', 'Minimize'), role: 'minimize' },
        { label: label('缩放', 'Zoom'), role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const },
              { label: label('全部置于最前面', 'Bring All to Front'), role: 'front' as const }
            ]
          : [{ label: label('关闭', 'Close'), role: 'close' as const }])
      ]
    },
    {
      label: label('设置', 'Settings'),
      submenu: [
        {
          label: label('打开设置…', 'Open Settings…'),
          accelerator: 'CmdOrCtrl+,',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send(IpcChannel.app.openSettings)
        }
      ]
    },
    {
      label: label('帮助', 'Help'),
      role: 'help',
      submenu: [
        {
          label: label(`关于 ${PRODUCT_NAME}`, `About ${PRODUCT_NAME}`),
          click: showAboutDialog
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const createWindow = (): void => {
  const displays = screen.getAllDisplays()
  // 检查显示设备：连接有第二个扩展屏幕时，优先选择第二个屏幕显示窗口
  const targetDisplay = displays.length >= 2 ? displays[1] : screen.getPrimaryDisplay()
  const { x, y, width: boundsWidth, height: boundsHeight } = targetDisplay.bounds

  const windowWidth = Math.min(1440, boundsWidth)
  const windowHeight = Math.min(900, boundsHeight)
  const windowX = Math.round(x + (boundsWidth - windowWidth) / 2)
  const windowY = Math.round(y + (boundsHeight - windowHeight) / 2)

  const mainWindow = new BrowserWindow({
    x: windowX,
    y: windowY,
    width: windowWidth,
    height: windowHeight,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: PRODUCT_NAME,
    icon: getApplicationIconPath(),
    backgroundColor: '#f8fafc',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      // 后台节流：窗口最小化或隐藏时，Electron 自动降低 requestAnimationFrame 频率、
      // 暂停 setTimeout/setInterval，减少渲染进程 CPU 与内存消耗
      backgroundThrottling: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(getApplicationIconPath()))

  // 1. 优先创建主窗口，开启 UI 渲染流程
  createWindow()

  const connectionRepository = new ConnectionRepository(join(app.getPath('userData'), 'omnidb.sqlite'))
  const connectionService = new ConnectionService(connectionRepository)
  let importExportService: ImportExportServiceType | null = null
  let aiAgentService: AiAgentServiceType | null = null
  let sshService: SshServiceType | null = null
  let memoryMonitor: MemoryMonitorService | null = null

  const getImportExportService = async (): Promise<ImportExportServiceType> => {
    if (!importExportService) {
      const { ImportExportService } = await import('./services/import-export-service')
      importExportService = new ImportExportService(connectionService)
    }
    return importExportService
  }
  const getAiAgentService = async (): Promise<AiAgentServiceType> => {
    if (!aiAgentService) {
      const { AiAgentService } = await import('./services/ai-agent-service')
      aiAgentService = new AiAgentService(connectionService, connectionRepository)
    }
    return aiAgentService
  }
  const getSshService = async (): Promise<SshServiceType> => {
    if (!sshService) {
      const { SshService } = await import('./services/ssh-service')
      sshService = new SshService(connectionRepository)
    }
    return sshService
  }

  createApplicationMenu()

  ipcMain.handle(IpcChannel.app.getInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }))
  ipcMain.handle(IpcChannel.app.updatePreferences, (_event, preferences: unknown) => {
    expectObject(preferences, 'preferences')
    const prefs = preferences as AppPreferences
    applicationLanguage = prefs.language === 'en-US' ? 'en-US' : 'zh-CN'
    try {
      writeFileSync(preferencesPath, JSON.stringify({ language: applicationLanguage, theme: prefs.theme }, null, 2), 'utf8')
    } catch (error) {
      console.warn('保存应用偏好设置失败：', error)
    }
    createApplicationMenu()
  })
  ipcMain.handle(IpcChannel.app.showItemInFolder, (_event, filePath: unknown) => {
    expectString(filePath, 'filePath')
    if (filePath) shell.showItemInFolder(filePath as string)
  })
  ipcMain.handle(IpcChannel.app.openPath, (_event, filePath: unknown) => {
    expectString(filePath, 'filePath')
    if (filePath) void shell.openPath(filePath as string)
  })
  ipcMain.handle(IpcChannel.ai.listModelPresets, async () => (await getAiAgentService()).listModelPresets())
  ipcMain.handle(IpcChannel.ai.listModels, async () => (await getAiAgentService()).listModels())
  ipcMain.handle(IpcChannel.ai.saveModel, async (_event, input: unknown) => { expectObject(input, 'input'); return (await getAiAgentService()).saveModel(input as AiSaveModelInput) })
  ipcMain.handle(IpcChannel.ai.deleteModel, async (_event, id: unknown) => { expectInt(id, 'id'); return (await getAiAgentService()).deleteModel(id as number) })
  ipcMain.handle(IpcChannel.ai.chat, async (_event, request: unknown) => { expectObject(request, 'request'); return (await getAiAgentService()).chat(request as AiAgentRequest) })
  ipcMain.handle(IpcChannel.ai.executeProposal, async (_event, request: unknown) => { expectObject(request, 'request'); return (await getAiAgentService()).executeProposal(request as AiExecuteProposalRequest) })
  ipcMain.handle(IpcChannel.connections.list, () => connectionService.list())
  ipcMain.handle(IpcChannel.connections.getOne, (_event, id: unknown) => { expectInt(id, 'id'); return connectionService.getOne(id as number) })
  ipcMain.handle(IpcChannel.connections.listGroups, () => connectionService.listConnectionGroups())
  ipcMain.handle(IpcChannel.connections.createGroup, (_event, name: unknown, category?: unknown) => { expectString(name, 'name'); return connectionService.createConnectionGroup(name as string, (category as 'database' | 'ssh') || 'database') })
  ipcMain.handle(IpcChannel.connections.deleteGroup, (_event, id: unknown) => { expectInt(id, 'id'); return connectionService.deleteConnectionGroup(id as number) })
  ipcMain.handle(IpcChannel.connections.renameGroup, (_event, id: unknown, name: unknown) => { expectInt(id, 'id'); expectString(name, 'name'); return connectionService.renameConnectionGroup(id as number, name as string) })
  ipcMain.handle(IpcChannel.connections.setGroup, (_event, connectionId: unknown, groupId: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectOptionalInt(groupId, 'groupId')
    return connectionService.setConnectionGroup(connectionId as number, groupId as number | null)
  })
  ipcMain.handle(IpcChannel.connections.selectSqliteFile, async (_event, engine?: unknown) => {
    const isDuckDb = engine === 'DuckDB'
    const dbLabel = isDuckDb ? 'DuckDB' : 'SQLite'
    const filters = isDuckDb
      ? [{ name: 'DuckDB 数据库', extensions: ['duckdb', 'db'] }]
      : [{ name: 'SQLite 数据库', extensions: ['sqlite', 'sqlite3', 'db', 'db3'] }]
    const choice = await dialog.showMessageBox({
      type: 'question',
      title: `选择 ${dbLabel} 数据库`,
      message: `请选择 ${dbLabel} 数据库文件来源`,
      buttons: ['选择已有文件', '创建新数据库文件', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice.response === 2) return null
    if (choice.response === 0) {
      const selected = await dialog.showOpenDialog({
        title: `选择 ${dbLabel} 数据库文件`,
        properties: ['openFile'],
        filters
      })
      return selected.canceled ? null : selected.filePaths[0] ?? null
    }
    const defaultExt = isDuckDb ? 'duckdb' : 'sqlite'
    const selected = await dialog.showSaveDialog({
      title: `创建 ${dbLabel} 数据库文件`,
      defaultPath: join(app.getPath('documents'), `database.${defaultExt}`),
      filters
    })
    return selected.canceled ? null : selected.filePath ?? null
  })
  ipcMain.handle(IpcChannel.connections.selectSecurityFile, async (_event, kind: unknown) => {
    const validatedKind = expectOneOf(kind, ['sshPrivateKey', 'sslCa', 'sslCert', 'sslKey'] as const, 'kind')
    const definitions: Record<ConnectionSecurityFileKind, { title: string; name: string; extensions: string[] }> = {
      sshPrivateKey: { title: '选择 SSH 私钥', name: 'SSH 私钥', extensions: ['pem', 'key', 'ppk'] },
      sslCa: { title: '选择 CA 证书', name: 'CA 证书', extensions: ['pem', 'crt', 'cer'] },
      sslCert: { title: '选择客户端证书', name: '客户端证书', extensions: ['pem', 'crt', 'cer'] },
      sslKey: { title: '选择客户端私钥', name: '客户端私钥', extensions: ['pem', 'key'] }
    }
    const definition = definitions[validatedKind]
    if (!definition) return null
    const selected = await dialog.showOpenDialog({
      title: definition.title,
      properties: ['openFile'],
      filters: [{ name: definition.name, extensions: definition.extensions }, { name: '所有文件', extensions: ['*'] }]
    })
    return selected.canceled ? null : selected.filePaths[0] ?? null
  })
  ipcMain.handle(IpcChannel.connections.create, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.create(input as CreateConnectionInput) })
  ipcMain.handle(IpcChannel.connections.update, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.update(input as UpdateConnectionInput) })
  ipcMain.handle(IpcChannel.connections.updateColor, (_event, id: unknown, color: unknown) => { expectInt(id, 'id'); expectString(color, 'color'); return connectionService.updateColor(id as number, color as string) })
  ipcMain.handle(IpcChannel.connections.updateEnvironment, (_event, id: unknown, environment: unknown) => {
    expectInt(id, 'id')
    const env = environment as import('../shared/connections').ConnectionEnvironment | null
    return connectionService.updateEnvironment(id as number, env)
  })
  ipcMain.handle(IpcChannel.connections.test, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.test(input as CreateConnectionInput) })
  ipcMain.handle(IpcChannel.connections.testUpdate, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.testUpdate(input as UpdateConnectionInput) })
  ipcMain.handle(IpcChannel.connections.open, (_event, id: unknown) => { expectInt(id, 'id'); return connectionService.open(id as number) })
  ipcMain.handle(IpcChannel.connections.close, (_event, id: unknown) => { expectInt(id, 'id'); return connectionService.close(id as number) })
  ipcMain.handle(IpcChannel.connections.duplicate, (_event, id: unknown) => { expectInt(id, 'id'); return connectionService.duplicate(id as number) })
  ipcMain.handle(IpcChannel.connections.delete, (_event, id: unknown) => { expectInt(id, 'id'); return connectionService.delete(id as number) })
  ipcMain.handle(IpcChannel.connections.getProcessList, (_event, id: unknown) => {
    expectInt(id, 'id')
    return connectionService.getProcessList(id as number)
  })
  ipcMain.handle(IpcChannel.connections.killProcess, (_event, id: unknown, processId: unknown) => {
    expectInt(id, 'id')
    return connectionService.killProcess(id as number, processId as string | number)
  })
  ipcMain.handle(IpcChannel.connections.exportConfig, (_event, options?: unknown) => {
    return connectionService.exportConfig(options as Parameters<typeof connectionService.exportConfig>[0])
  })
  ipcMain.handle(IpcChannel.connections.readImportConfigFile, (_event, sourcePath?: unknown) => {
    return connectionService.readImportConfigFile(sourcePath as string | undefined)
  })
  ipcMain.handle(IpcChannel.connections.importConfig, (_event, options?: unknown) => {
    return connectionService.importConfig(options as Parameters<typeof connectionService.importConfig>[0])
  })
  ipcMain.handle(IpcChannel.connections.updateSortOrders, (_event, orders: unknown) => {
    return connectionService.updateSortOrders(orders as Array<{ id: number; sortOrder: number }>)
  })
  ipcMain.handle(IpcChannel.connections.readDatabaseDetail, (_event, connectionId: unknown, databaseName: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    return connectionService.readDatabaseDetail(connectionId as number, databaseName as string)
  })
  ipcMain.handle(IpcChannel.connections.previewSqlFile, async (
    _event,
    id: unknown,
    databaseName?: unknown,
    filePath?: unknown
  ) => {
    expectInt(id, 'id')
    expectOptionalString(databaseName, 'databaseName')
    const connId = id as number
    const dbName = databaseName as string | undefined

    const connection = connectionService.repository.getById(connId)
    if (!connection) return { success: false, message: '连接不存在' }

    let targetFilePath = typeof filePath === 'string' ? filePath : ''
    if (!targetFilePath) {
      const selected = await dialog.showOpenDialog({
        title: '选择要运行的 SQL 文件',
        properties: ['openFile'],
        filters: [{ name: 'SQL 文件', extensions: ['sql'] }]
      })
      if (selected.canceled || !selected.filePaths[0]) {
        return { success: false, canceled: true, message: '已取消选择文件' }
      }
      targetFilePath = selected.filePaths[0]
    }

    try {
      const stats = await fsStat(targetFilePath)
      const fileName = basename(targetFilePath)
      const fileSize = stats.size
      const fullContent = await readFile(targetFilePath, 'utf8')
      const lines = fullContent.split('\n')
      const totalLines = lines.length

      const statements = fullContent
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'))
      const statementCount = statements.length

      const maxPreviewChars = 500000
      const isTruncated = fullContent.length > maxPreviewChars
      const sqlPreview = isTruncated
        ? fullContent.slice(0, maxPreviewChars) + '\n\n-- [超出预览限制，已展示前 500,000 字符，实际运行包含全部文件内容]...'
        : fullContent

      return {
        success: true,
        connectionId: connId,
        connectionName: connection.name,
        databaseName: dbName || '',
        filePath: targetFilePath,
        fileName,
        fileSize,
        totalLines,
        statementCount,
        sqlPreview,
        isTruncated
      }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : '解析 SQL 文件失败' }
    }
  })

  ipcMain.handle(IpcChannel.connections.executeSqlFile, async (_event, input: unknown) => {
    expectObject(input, 'input')
    const { connectionId, databaseName, filePath } = input as ExecuteSqlFileInput
    const sql = await readFile(filePath, 'utf8')
    return connectionService.executeSql(connectionId, sql, databaseName)
  })

  ipcMain.handle(IpcChannel.connections.runSqlFile, async (_event, id: unknown, databaseName?: unknown) => {
    expectInt(id, 'id')
    expectOptionalString(databaseName, 'databaseName')
    const selected = await dialog.showOpenDialog({
      title: '选择要运行的 SQL 文件',
      properties: ['openFile'],
      filters: [{ name: 'SQL 文件', extensions: ['sql'] }]
    })
    if (selected.canceled || !selected.filePaths[0]) return { success: false, message: '已取消执行' }
    const filePath = selected.filePaths[0]
    const sql = await readFile(filePath, 'utf8')
    return connectionService.executeSql(id as number, sql, databaseName as string | undefined)
  })
  ipcMain.handle(IpcChannel.databases.create, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.createDatabase(input as DatabaseDefinitionInput) })
  ipcMain.handle(IpcChannel.databases.listCharsets, (_event, connectionId: unknown) => { expectInt(connectionId, 'connectionId'); return connectionService.listCharsets(connectionId as number) })
  ipcMain.handle(IpcChannel.databases.update, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.updateDatabase(input as UpdateDatabaseInput) })
  ipcMain.handle(IpcChannel.databases.exportSql, async (
    event,
    connectionId: unknown,
    databaseName: unknown,
    tableName: unknown,
    includeData: unknown
  ) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectOptionalString(tableName, 'tableName')
    expectBool(includeData, 'includeData')
    const connId = connectionId as number
    const dbName = databaseName as string
    const tblName = tableName as string | undefined
    const withData = includeData as boolean
    const sourceName = (tblName ?? dbName).replaceAll(/[\\/:*?"<>|]/g, '_')
    const selected = await dialog.showSaveDialog({
      title: tblName ? `导出表 ${dbName}.${tblName}` : `导出数据库 ${dbName}`,
      defaultPath: `${sourceName}${withData ? '-structure-data' : '-structure'}.sql`,
      filters: [{ name: 'SQL 文件', extensions: ['sql'] }]
    })
    if (selected.canceled || !selected.filePath) return { success: false, message: '已取消导出', canceled: true }
    const progressCallback = (progress: { current: number; total: number; tableName?: string; message: string }): void => {
      event.sender.send(IpcChannel.databases.exportSqlProgress, progress)
    }
    return (await getImportExportService()).exportSql(connId, dbName, selected.filePath, withData, tblName, progressCallback)
  })
  ipcMain.handle(IpcChannel.databases.previewExportSql, async (
    _event,
    connectionId: unknown,
    databaseName: unknown,
    tableName: unknown,
    includeData: unknown,
    maxRowsPerTable?: unknown
  ) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectOptionalString(tableName, 'tableName')
    expectBool(includeData, 'includeData')
    const rowsLimit = typeof maxRowsPerTable === 'number' ? maxRowsPerTable : 50
    return (await getImportExportService()).previewExportSql(
      connectionId as number,
      databaseName as string,
      includeData as boolean,
      tableName as string | undefined,
      rowsLimit
    )
  })
  ipcMain.handle(IpcChannel.databases.delete, (_event, connectionId: unknown, databaseName: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    return connectionService.deleteDatabase(connectionId as number, databaseName as string)
  })
  ipcMain.handle(IpcChannel.queries.execute, (_event, connectionId: unknown, databaseName: unknown, sql: unknown, sessionId?: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(sql, 'sql')
    expectOptionalString(sessionId, 'sessionId')
    return connectionService.executeQuery(connectionId as number, databaseName as string, sql as string, sessionId as string | undefined)
  })
  ipcMain.handle(IpcChannel.queries.fetchMore, (_event, connectionId: unknown, databaseName: unknown, cursorId: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(cursorId, 'cursorId')
    return connectionService.fetchMoreRows(connectionId as number, databaseName as string, cursorId as string)
  })
  ipcMain.handle(IpcChannel.queries.transactionBegin, (_event, connectionId: unknown, databaseName: unknown, sessionId: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(sessionId, 'sessionId')
    return connectionService.beginTransaction(connectionId as number, databaseName as string, sessionId as string)
  })
  ipcMain.handle(IpcChannel.queries.transactionCommit, (_event, sessionId: unknown) => { expectString(sessionId, 'sessionId'); return connectionService.commitTransaction(sessionId as string) })
  ipcMain.handle(IpcChannel.queries.transactionRollback, (_event, sessionId: unknown) => { expectString(sessionId, 'sessionId'); return connectionService.rollbackTransaction(sessionId as string) })
  ipcMain.handle(IpcChannel.queries.listSaved, (_event, connectionId: unknown, databaseName: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    return connectionService.listSavedQueries(connectionId as number, databaseName as string)
  })
  ipcMain.handle(IpcChannel.queries.save, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.saveQuery(input as SaveQueryInput) })
  ipcMain.handle(IpcChannel.queries.deleteSaved, (_event, id: unknown, connectionId: unknown, databaseName: unknown) => {
    expectInt(id, 'id')
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    return connectionService.deleteSavedQuery(id as number, connectionId as number, databaseName as string)
  })
  ipcMain.handle(IpcChannel.queries.updateRow, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.updateQueryRow(input as QueryUpdateRowInput) })
  ipcMain.handle(IpcChannel.tables.create, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.createTable(input as CreateTableInput) })
  ipcMain.handle(IpcChannel.tables.updateRow, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.updateQueryRow(input as QueryUpdateRowInput) })
  ipcMain.handle(IpcChannel.tables.getDefinition, (_event, connectionId: unknown, databaseName: unknown, tableName: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(tableName, 'tableName')
    return connectionService.getTableDefinition(connectionId as number, databaseName as string, tableName as string)
  })
  ipcMain.handle(IpcChannel.tables.update, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.updateTable(input as UpdateTableInput) })
  ipcMain.handle(IpcChannel.tables.rename, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.renameTable(input as RenameTableInput) })
  ipcMain.handle(IpcChannel.tables.deleteRow, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.deleteQueryRow(input as QueryDeleteRowInput) })
  ipcMain.handle(IpcChannel.tables.readData, (
    _event,
    connectionId: unknown,
    databaseName: unknown,
    tableName: unknown,
    limit: unknown,
    offset: unknown,
    filter?: unknown
  ) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(tableName, 'tableName')
    expectInt(limit, 'limit')
    expectInt(offset, 'offset')
    return connectionService.readTableData(connectionId as number, databaseName as string, tableName as string, limit as number, offset as number, filter as TableDataFilter | undefined)
  })
  ipcMain.handle(IpcChannel.tables.delete, (_event, connectionId: unknown, databaseName: unknown, tableName: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(tableName, 'tableName')
    return connectionService.deleteTable(connectionId as number, databaseName as string, tableName as string)
  })
  ipcMain.handle(IpcChannel.tables.truncate, (_event, connectionId: unknown, databaseName: unknown, tableName: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(tableName, 'tableName')
    return connectionService.truncateTable(connectionId as number, databaseName as string, tableName as string)
  })
  ipcMain.handle(IpcChannel.tables.copy, (_event, input: unknown) => { expectObject(input, 'input'); return connectionService.copyTable(input as CopyTableInput) })
  ipcMain.handle(IpcChannel.tables.transferData, async (_event, input: unknown) => { expectObject(input, 'input'); return (await getImportExportService()).transferTableData(input as TransferTableDataInput) })
  ipcMain.handle(IpcChannel.tables.previewImport, async (
    _event,
    connectionId: unknown,
    databaseName: unknown,
    tableName: unknown,
    filePath?: unknown
  ) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(tableName, 'tableName')
    const connId = connectionId as number
    const dbName = databaseName as string
    const tblName = tableName as string

    let targetFilePath = typeof filePath === 'string' ? filePath : ''
    if (!targetFilePath) {
      const selected = await dialog.showOpenDialog({
        title: `选择导入文件到 ${dbName}.${tblName}`,
        properties: ['openFile'],
        filters: [
          { name: '数据文件 (*.csv, *.tsv, *.json, *.xlsx, *.xls)', extensions: ['csv', 'tsv', 'json', 'xlsx', 'xls'] },
          { name: 'CSV / TSV 文件', extensions: ['csv', 'tsv'] },
          { name: 'JSON 文件', extensions: ['json'] },
          { name: 'Excel 工作簿', extensions: ['xlsx', 'xls'] }
        ]
      })
      if (selected.canceled || !selected.filePaths[0]) {
        return { success: false, canceled: true, message: '已取消选择文件' }
      }
      targetFilePath = selected.filePaths[0]
    }

    return (await getImportExportService()).previewImportFile(connId, dbName, tblName, targetFilePath)
  })

  ipcMain.handle(IpcChannel.tables.executeImport, async (_event, input: unknown) => {
    expectObject(input, 'input')
    return (await getImportExportService()).executeImportWithMapping(input as ExecuteImportInput)
  })
  ipcMain.handle(IpcChannel.tables.exportCustomData, async (_event, input: unknown) => {
    expectObject(input, 'input')
    return (await getImportExportService()).exportTableCustom(input as ExportTableCustomInput)
  })
  ipcMain.handle(IpcChannel.tables.importCsv, async (_event, connectionId: unknown, databaseName: unknown, tableName: unknown) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(tableName, 'tableName')
    const connId = connectionId as number
    const dbName = databaseName as string
    const tblName = tableName as string
    const selected = await dialog.showOpenDialog({ title: `导入到 ${dbName}.${tblName}`, properties: ['openFile'], filters: [{ name: '数据文件', extensions: ['csv', 'json', 'xlsx', 'xls'] }] })
    if (selected.canceled || !selected.filePaths[0]) return { success: false, message: '已取消导入' }
    return (await getImportExportService()).importTableData(connId, dbName, tblName, selected.filePaths[0])
  })
  ipcMain.handle(IpcChannel.tables.exportCsv, async (
    _event,
    connectionId: unknown,
    databaseName: unknown,
    tableName: unknown
  ) => {
    expectInt(connectionId, 'connectionId')
    expectString(databaseName, 'databaseName')
    expectString(tableName, 'tableName')
    const connId = connectionId as number
    const dbName = databaseName as string
    const tblName = tableName as string
    const selected = await dialog.showSaveDialog({
      title: `导出 ${dbName}.${tblName}`,
      defaultPath: `${tblName}.csv`,
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    if (selected.canceled || !selected.filePath) return { success: false, message: '已取消导出' }
    return (await getImportExportService()).exportTableCsv(connId, dbName, tblName, selected.filePath)
  })

  ipcMain.handle(IpcChannel.ssh.connect, async (event, options: unknown) => {
    expectObject(options, 'options')
    return (await getSshService()).connect(options as Parameters<SshServiceType['connect']>[0], event.sender)
  })
  ipcMain.handle(IpcChannel.ssh.write, async (_event, sessionId: unknown, data: unknown) => {
    expectString(sessionId, 'sessionId')
    expectString(data, 'data')
    return (await getSshService()).write(sessionId as string, data as string)
  })
  ipcMain.handle(IpcChannel.ssh.resize, async (_event, sessionId: unknown, rows: unknown, cols: unknown) => {
    expectString(sessionId, 'sessionId')
    expectInt(rows, 'rows')
    expectInt(cols, 'cols')
    return (await getSshService()).resize(sessionId as string, rows as number, cols as number)
  })
  ipcMain.handle(IpcChannel.ssh.disconnect, async (_event, sessionId: unknown) => {
    expectString(sessionId, 'sessionId')
    return (await getSshService()).disconnect(sessionId as string)
  })
  ipcMain.handle(IpcChannel.ssh.filesList, async (_event, sessionId: unknown, remotePath: unknown) => {
    expectString(sessionId, 'sessionId')
    expectString(remotePath, 'remotePath')
    return (await getSshService()).listFiles(sessionId as string, remotePath as string)
  })
  ipcMain.handle(IpcChannel.ssh.filesUpload, async (event, sessionId: unknown, remoteDirectory: unknown) => {
    expectString(sessionId, 'sessionId')
    expectString(remoteDirectory, 'remoteDirectory')
    const sessId = sessionId as string
    const remoteDir = remoteDirectory as string
    const owner = BrowserWindow.fromWebContents(event.sender)
    const selected = await dialog.showOpenDialog(owner ?? BrowserWindow.getFocusedWindow()!, {
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections']
    })
    if (selected.canceled || !selected.filePaths.length) return { success: false, message: '已取消上传', canceled: true }
    return (await getSshService()).uploadFiles(sessId, remoteDir, selected.filePaths)
  })
  ipcMain.handle(IpcChannel.ssh.filesDownload, async (event, sessionId: unknown, remotePath: unknown, fileName: unknown) => {
    expectString(sessionId, 'sessionId')
    expectString(remotePath, 'remotePath')
    expectString(fileName, 'fileName')
    const sessId = sessionId as string
    const rPath = remotePath as string
    const fName = fileName as string
    const owner = BrowserWindow.fromWebContents(event.sender)
    const selected = await dialog.showSaveDialog(owner ?? BrowserWindow.getFocusedWindow()!, {
      title: '保存远程文件',
      defaultPath: fName || basename(rPath)
    })
    if (selected.canceled || !selected.filePath) return { success: false, message: '已取消下载', canceled: true }
    return (await getSshService()).downloadFile(sessId, rPath, selected.filePath)
  })
  ipcMain.handle(IpcChannel.ssh.filesOpen, async (_event, sessionId: unknown, remotePath: unknown, fileName: unknown) => {
    expectString(sessionId, 'sessionId')
    expectString(remotePath, 'remotePath')
    expectString(fileName, 'fileName')
    const sessId = sessionId as string
    const rPath = remotePath as string
    const fName = fileName as string
    try {
      const downloadDirectory = app.getPath('downloads')
      const safeName = basename(fName || rPath) || 'remote-file'
      const extension = extname(safeName)
      const stem = extension ? safeName.slice(0, -extension.length) : safeName
      let localPath = join(downloadDirectory, safeName)
      let copyIndex = 1
      while (existsSync(localPath)) {
        localPath = join(downloadDirectory, `${stem} (${copyIndex})${extension}`)
        copyIndex += 1
      }
      const downloaded = await (await getSshService()).downloadFile(sessId, rPath, localPath)
      if (!downloaded.success) return downloaded
      const openError = await shell.openPath(localPath)
      if (openError) {
        shell.showItemInFolder(localPath)
        return { success: true, message: `文件已下载到“下载”目录，系统没有可用的打开程序` }
      }
      return { success: true, message: `文件已下载并打开：${basename(localPath)}` }
    } catch (error) {
      return { success: false, message: `下载并打开文件失败：${error instanceof Error ? error.message : String(error)}` }
    }
  })
  ipcMain.handle(IpcChannel.ssh.filesDelete, async (_event, sessionId: unknown, remotePath: unknown, type: unknown) => {
    expectString(sessionId, 'sessionId')
    expectString(remotePath, 'remotePath')
    expectOneOf(type, ['file', 'directory'] as const, 'type')
    return (await getSshService()).deleteFile(sessionId as string, remotePath as string, type as SshFileEntry['type'])
  })

  // ── Memory diagnostics IPC ──────────────────────────────
  ipcMain.handle(IpcChannel.memory.getStats, () => memoryMonitor?.getMemoryStats() ?? null)
  ipcMain.handle(IpcChannel.memory.takeHeapSnapshot, () => memoryMonitor?.takeHeapSnapshot() ?? null)
  ipcMain.handle(IpcChannel.memory.forceGc, () => {
    if (typeof global.gc === 'function') {
      try { global.gc(); return { success: true, message: 'GC 已执行' } }
      catch (e) { return { success: false, message: `GC 执行失败：${e instanceof Error ? e.message : String(e)}` } }
    }
    return { success: false, message: 'GC 不可用，请确认 --expose-gc 启动参数' }
  })
  ipcMain.handle(IpcChannel.workspace.getStats, (_event, range?: unknown) =>
    connectionRepository.getWorkspaceStats(range === '30d' || range === '90d' ? range : '7d')
  )

  // 2. 延迟启动非核心后台逻辑（内存监控、连接池清理调度器），不阻塞窗口创建及首屏渲染
  setTimeout(() => {
    memoryMonitor = new MemoryMonitorService(() => {
      // 超阈值时主动触发 GC 并清理空闲连接池
      if (typeof global.gc === 'function') {
        try { global.gc() } catch { /* ignore */ }
      }
      void import('./services/adapters/postgresql-adapter')
        .then(({ closeAllPostgresPools }) => closeAllPostgresPools())
        .catch(() => {})
      void connectionEvictionScheduler.evictAll(0).catch(() => {})
      console.warn('[MemoryMonitor] Threshold exceeded — GC triggered and idle connections evicted.')
    })
    memoryMonitor.start()

    // 启动连接池空闲驱逐调度器（每 5 分钟检查，关闭空闲超过 15 分钟的连接池）
    connectionEvictionScheduler.start()
  }, 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  event.preventDefault()
  connectionEvictionScheduler.stop()
  Promise.allSettled([
    transactionManager.shutdown(),
    shutdownDbQueryWorker(),
    shutdownSqliteWorker(),
    import('./services/adapters/postgresql-adapter').then(({ closeAllPostgresPools }) => closeAllPostgresPools())
  ]).finally(() => app.exit(0))
})
