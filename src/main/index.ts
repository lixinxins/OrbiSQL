import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { readFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ConnectionRepository } from './database/connection-repository'
import { ConnectionService } from './services/connection-service'
import type { AppLanguage, AppPreferences, CopyTableInput, CreateConnectionInput, CreateTableInput, DatabaseDefinitionInput, QueryDeleteRowInput, QueryUpdateRowInput, RenameTableInput, SaveQueryInput, TableDataFilter, UpdateConnectionInput, UpdateDatabaseInput, UpdateTableInput } from '../shared/connections'

const PRODUCT_NAME = 'OrbiSQL'
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
  const english = applicationLanguage === 'en-US'
  void dialog.showMessageBox({
    type: 'info',
    title: english ? `About ${PRODUCT_NAME}` : `关于 ${PRODUCT_NAME}`,
    message: PRODUCT_NAME,
    detail: english ? `Version ${app.getVersion()}\nCross-platform desktop database manager` : `版本 ${app.getVersion()}\n跨平台桌面数据库管理工具`,
    icon: nativeImage.createFromPath(getApplicationIconPath()),
    buttons: [english ? 'OK' : '确定']
  })
}

app.commandLine.appendSwitch('lang', applicationLanguage)
app.setName(PRODUCT_NAME)
process.title = PRODUCT_NAME
app.setAppUserModelId('com.orbisql.desktop')
app.setAboutPanelOptions({
  applicationName: PRODUCT_NAME,
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright: 'Copyright © OrbiSQL Team',
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
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('connections:open-create-dialog')
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
        { label: label('开发者工具', 'Developer Tools'), role: 'toggleDevTools' },
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
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('app:open-settings')
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
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: PRODUCT_NAME,
    icon: getApplicationIconPath(),
    backgroundColor: '#f7f8fa',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
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
  const connectionRepository = new ConnectionRepository(join(app.getPath('userData'), 'omnidb.sqlite'))
  const connectionService = new ConnectionService(connectionRepository)

  createApplicationMenu()

  ipcMain.handle('app:get-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }))
  ipcMain.handle('app:update-preferences', (_event, preferences: AppPreferences) => {
    applicationLanguage = preferences.language === 'en-US' ? 'en-US' : 'zh-CN'
    try {
      writeFileSync(preferencesPath, JSON.stringify({ language: applicationLanguage, theme: preferences.theme }, null, 2), 'utf8')
    } catch (error) {
      console.warn('保存应用偏好设置失败：', error)
    }
    createApplicationMenu()
  })
  ipcMain.handle('connections:list', () => connectionService.list())
  ipcMain.handle('connections:select-sqlite-file', async () => {
    const choice = await dialog.showMessageBox({
      type: 'question',
      title: '选择 SQLite 数据库',
      message: '请选择 SQLite 数据库文件来源',
      buttons: ['选择已有文件', '创建新数据库文件', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice.response === 2) return null
    const filters = [{ name: 'SQLite 数据库', extensions: ['sqlite', 'sqlite3', 'db', 'db3'] }]
    if (choice.response === 0) {
      const selected = await dialog.showOpenDialog({
        title: '选择 SQLite 数据库文件',
        properties: ['openFile'],
        filters
      })
      return selected.canceled ? null : selected.filePaths[0] ?? null
    }
    const selected = await dialog.showSaveDialog({
      title: '创建 SQLite 数据库文件',
      defaultPath: join(app.getPath('documents'), 'database.sqlite'),
      filters
    })
    return selected.canceled ? null : selected.filePath ?? null
  })
  ipcMain.handle('connections:create', (_event, input: CreateConnectionInput) => connectionService.create(input))
  ipcMain.handle('connections:update', (_event, input: UpdateConnectionInput) => connectionService.update(input))
  ipcMain.handle('connections:test', (_event, input: CreateConnectionInput) => connectionService.test(input))
  ipcMain.handle('connections:test-update', (_event, input: UpdateConnectionInput) => connectionService.testUpdate(input))
  ipcMain.handle('connections:open', (_event, id: number) => connectionService.open(id))
  ipcMain.handle('connections:close', (_event, id: number) => connectionService.close(id))
  ipcMain.handle('connections:duplicate', (_event, id: number) => connectionService.duplicate(id))
  ipcMain.handle('connections:delete', (_event, id: number) => connectionService.delete(id))
  ipcMain.handle('connections:run-sql-file', async (_event, id: number, databaseName?: string) => {
    const selected = await dialog.showOpenDialog({
      title: '选择要运行的 SQL 文件',
      properties: ['openFile'],
      filters: [{ name: 'SQL 文件', extensions: ['sql'] }]
    })
    if (selected.canceled || !selected.filePaths[0]) return { success: false, message: '已取消执行' }

    const filePath = selected.filePaths[0]
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '运行 SQL 文件',
      message: `确定要运行“${basename(filePath)}”吗？`,
      detail: 'SQL 文件可能修改或删除数据库中的数据，请确认文件来源可靠。',
      buttons: ['运行', '取消'],
      defaultId: 1,
      cancelId: 1
    })
    if (confirmation.response !== 0) return { success: false, message: '已取消执行' }

    const sql = await readFile(filePath, 'utf8')
    return connectionService.executeSql(id, sql, databaseName)
  })
  ipcMain.handle('databases:create', (_event, input: DatabaseDefinitionInput) => connectionService.createDatabase(input))
  ipcMain.handle('databases:list-charsets', (_event, connectionId: number) => connectionService.listCharsets(connectionId))
  ipcMain.handle('databases:update', (_event, input: UpdateDatabaseInput) => connectionService.updateDatabase(input))
  ipcMain.handle('databases:export-sql', async (
    _event,
    connectionId: number,
    databaseName: string,
    tableName: string | undefined,
    includeData: boolean
  ) => {
    const sourceName = (tableName ?? databaseName).replaceAll(/[\\/:*?"<>|]/g, '_')
    const selected = await dialog.showSaveDialog({
      title: tableName ? `导出表 ${databaseName}.${tableName}` : `导出数据库 ${databaseName}`,
      defaultPath: `${sourceName}${includeData ? '-structure-data' : '-structure'}.sql`,
      filters: [{ name: 'SQL 文件', extensions: ['sql'] }]
    })
    if (selected.canceled || !selected.filePath) return { success: false, message: '已取消导出' }
    return connectionService.exportSql(connectionId, databaseName, selected.filePath, includeData, tableName)
  })
  ipcMain.handle('databases:delete', (_event, connectionId: number, databaseName: string) =>
    connectionService.deleteDatabase(connectionId, databaseName))
  ipcMain.handle('queries:execute', (_event, connectionId: number, databaseName: string, sql: string) =>
    connectionService.executeQuery(connectionId, databaseName, sql))
  ipcMain.handle('queries:list-saved', (_event, connectionId: number, databaseName: string) =>
    connectionService.listSavedQueries(connectionId, databaseName))
  ipcMain.handle('queries:save', (_event, input: SaveQueryInput) => connectionService.saveQuery(input))
  ipcMain.handle('queries:delete-saved', (_event, id: number, connectionId: number, databaseName: string) =>
    connectionService.deleteSavedQuery(id, connectionId, databaseName))
  ipcMain.handle('queries:update-row', (_event, input: QueryUpdateRowInput) => connectionService.updateQueryRow(input))
  ipcMain.handle('tables:create', (_event, input: CreateTableInput) => connectionService.createTable(input))
  ipcMain.handle('tables:get-definition', (_event, connectionId: number, databaseName: string, tableName: string) =>
    connectionService.getTableDefinition(connectionId, databaseName, tableName))
  ipcMain.handle('tables:update', (_event, input: UpdateTableInput) => connectionService.updateTable(input))
  ipcMain.handle('tables:rename', (_event, input: RenameTableInput) => connectionService.renameTable(input))
  ipcMain.handle('tables:delete-row', (_event, input: QueryDeleteRowInput) => connectionService.deleteQueryRow(input))
  ipcMain.handle('tables:read-data', (
    _event,
    connectionId: number,
    databaseName: string,
    tableName: string,
    limit: number,
    offset: number,
    filter?: TableDataFilter
  ) => connectionService.readTableData(connectionId, databaseName, tableName, limit, offset, filter))
  ipcMain.handle('tables:delete', (_event, connectionId: number, databaseName: string, tableName: string) =>
    connectionService.deleteTable(connectionId, databaseName, tableName))
  ipcMain.handle('tables:truncate', (_event, connectionId: number, databaseName: string, tableName: string) =>
    connectionService.truncateTable(connectionId, databaseName, tableName))
  ipcMain.handle('tables:copy', (_event, input: CopyTableInput) => connectionService.copyTable(input))
  ipcMain.handle('tables:import-csv', async (
    _event,
    connectionId: number,
    databaseName: string,
    tableName: string
  ) => {
    const selected = await dialog.showOpenDialog({
      title: `导入到 ${databaseName}.${tableName}`,
      properties: ['openFile'],
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    if (selected.canceled || !selected.filePaths[0]) return { success: false, message: '已取消导入' }
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '导入 CSV',
      message: `确定要将“${basename(selected.filePaths[0])}”导入表“${tableName}”吗？`,
      detail: 'CSV 第一行必须是字段名称，导入会向当前表新增数据。',
      buttons: ['导入', '取消'],
      defaultId: 1,
      cancelId: 1
    })
    if (confirmation.response !== 0) return { success: false, message: '已取消导入' }
    return connectionService.importTableCsv(connectionId, databaseName, tableName, selected.filePaths[0])
  })
  ipcMain.handle('tables:export-csv', async (
    _event,
    connectionId: number,
    databaseName: string,
    tableName: string
  ) => {
    const selected = await dialog.showSaveDialog({
      title: `导出 ${databaseName}.${tableName}`,
      defaultPath: `${tableName}.csv`,
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    if (selected.canceled || !selected.filePath) return { success: false, message: '已取消导出' }
    return connectionService.exportTableCsv(connectionId, databaseName, tableName, selected.filePath)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
