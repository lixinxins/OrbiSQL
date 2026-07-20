import type { AppLanguage } from '../../../shared/connections'

interface RenderedText {
  source: string
  rendered: string
}

const textSources = new WeakMap<Text, RenderedText>()
const attributeSources = new WeakMap<Element, Map<string, RenderedText>>()
let currentLanguage: AppLanguage = 'zh-CN'
let observer: MutationObserver | null = null

const english: Record<string, string> = {
  '新建连接': 'New connection', '新建查询': 'New query', '工作台': 'Workbench', '开始使用 OrbiSQL': 'Get started with OrbiSQL',
  '关闭当前': 'Close current', '关闭其他': 'Close others', '关闭左侧': 'Close tabs to the left', '关闭右侧': 'Close tabs to the right',
  '正在加载连接列表': 'Loading connections',
  '从左侧选择一个数据库，或创建新连接来管理你的数据。': 'Select a database on the left, or create a connection to manage your data.',
  '新建 SQL 查询': 'New SQL query', '打开查询编辑器并执行 SQL': 'Open the query editor and run SQL',
  '连接 PostgreSQL、MySQL 或 SQLite': 'Connect to PostgreSQL, MySQL, or SQLite', '就绪': 'Ready',
  '搜索连接或数据库': 'Search connections or databases', '字段': 'Columns', '索引': 'Indexes', '外键': 'Foreign keys',
  '检查': 'Checks', '触发器': 'Triggers', '数据表': 'Tables', '视图': 'Views', '存储过程': 'Procedures', '函数': 'Functions',
  '事件': 'Events', '物化视图': 'Materialized views', '序列': 'Sequences', '集合': 'Collections', '键': 'Keys', '别名': 'Aliases',
  '数据流': 'Data streams', '映射': 'Mappings', '映射字段': 'Mapping fields', '字典': 'Dictionaries', '包': 'Packages', '同义词': 'Synonyms',
  '打开连接': 'Open connection', '关闭连接': 'Close connection', '编辑连接': 'Edit connection', '复制连接': 'Duplicate connection',
  '删除连接': 'Delete connection', '刷新': 'Refresh', '运行 SQL 文件': 'Run SQL file', '打开数据库': 'Open database', '关闭数据库': 'Close database',
  '新建数据库': 'New database', '编辑数据库': 'Edit database', '删除数据库': 'Delete database', '导出 SQL': 'Export SQL',
  '仅导出结构': 'Structure only', '导出结构和数据': 'Structure and data', '打开表': 'Open table', '设计表': 'Design table',
  '编辑表名称': 'Rename table', '复制表名称': 'Copy table name', '新表名称': 'New table name', '请输入新的表名称': 'Enter a new table name',
  '请输入英文表名称': 'Enter an English table name',
  '名称须以英文字母开头，只能包含英文字母、数字和下划线。': 'Start with a letter; use only letters, numbers, and underscores.',
  '删除表': 'Delete table', '清空表': 'Truncate table', '导出 CSV': 'Export CSV', '复制表': 'Copy table', '复制表结构': 'Copy table structure',
  '复制结构和数据': 'Copy structure and data', '新建数据表': 'New table', '导入 CSV': 'Import CSV',
  '表名称': 'Table name', '表注释': 'Table comment', '暂无注释': 'No comment', '该数据库暂无数据表': 'No tables in this database',
  '创建表后会在这里显示': 'Tables will appear here after creation', '没有匹配的数据表': 'No matching tables', '请尝试其他关键词': 'Try another keyword',
  '筛选表名称或注释': 'Filter by table name or comment', '双击打开表数据': 'Double-click to open table data',
  '运行': 'Run', '运行中…': 'Running…', '格式化 SQL': 'Format SQL', '压缩 SQL': 'Minify SQL', '保存查询': 'Save query', '已保存': 'Saved',
  '当前数据库': 'Current database', '请选择数据库': 'Select a database', '输入 SQL 后自动检查表和字段': 'Tables and columns are validated as you type',
  '字段检查通过': 'Validation passed', '等待执行查询': 'Waiting to run query', '在此输入 SQL 语句…': 'Enter SQL here…',
  '已保存的查询': 'Saved queries', '当前数据库还没有保存的查询': 'No saved queries for this database',
  '保存查询语句': 'Save query', '查询名称': 'Query name', '同名查询再次保存时会更新原有内容。': 'Saving with the same name updates the existing query.',
  '保存': 'Save', '保存中…': 'Saving…', '取消': 'Cancel', '完成': 'Done', '设置': 'Settings', 'OrbiSQL 应用偏好设置': 'OrbiSQL preferences',
  '界面语言': 'Interface language', '系统菜单与应用界面使用的语言': 'Language used by the app and native menus', '简体中文': 'Simplified Chinese',
  '外观主题': 'Appearance theme', '选择一套浅色主题，切换后立即生效': 'Choose a light theme; changes apply immediately',
  '经典蓝': 'Classic blue', '柔和灰': 'Soft slate', '紫罗兰': 'Violet', '关闭设置': 'Close settings',
  '刷新数据': 'Refresh data', '加载中…': 'Loading…', '设计字段': 'Design columns', '筛选': 'Filter', '暂无字段': 'No columns',
  '包含': 'Contains', '开头是': 'Starts with', '等于': 'Equals', '不等于': 'Not equal', '大于': 'Greater than', '大于等于': 'Greater than or equal',
  '小于': 'Less than', '小于等于': 'Less than or equal', '为空字符串': 'Empty string', '为 NULL': 'Is NULL', '为空或 NULL': 'Empty or NULL',
  '非空且非 NULL': 'Not empty and not NULL', '不为 NULL': 'Is not NULL', '输入筛选值': 'Enter filter value', '不需要输入值': 'No value required',
  '应用': 'Apply', '重置': 'Reset', '支持编辑': 'Editable', '只读 · 表缺少主键': 'Read-only · no primary key', '操作': 'Actions',
  '当前数据表中没有数据': 'No data in this table', '删除记录': 'Delete record', '复制字段名称': 'Copy column name', '复制为': 'Copy as',
  '复制为新增语句': 'Copy as INSERT', '复制为修改语句': 'Copy as UPDATE', '保存字段': 'Save cell', '取消编辑': 'Cancel editing',
  '上一页': 'Previous page', '下一页': 'Next page', '编辑数据库连接': 'Edit database connection', '新建数据库连接': 'New database connection',
  '数据库类型': 'Database type', '连接名称': 'Connection name', '数据库文件路径': 'Database file path', '主机': 'Host', '选择文件': 'Choose file',
  '选择中…': 'Choosing…', '端口': 'Port', '默认数据库': 'Default database', '用户名': 'Username', '密码': 'Password',
  '安全保存密码': 'Securely save password', '测试连接': 'Test connection', '正在测试…': 'Testing…', '保存修改': 'Save changes', '保存连接': 'Save connection',
  '删除数据记录': 'Delete data record', '删除已保存的查询': 'Delete saved query', '永久删除数据库': 'Permanently delete database',
  '永久删除数据表': 'Permanently delete table', '确认清空': 'Confirm truncate', '永久删除': 'Delete permanently', '确认删除': 'Confirm delete'
}

const translate = (source: string): string => {
  if (currentLanguage === 'zh-CN') return source
  if (english[source]) return english[source]
  const patterns: Array<[RegExp, (...values: string[]) => string]> = [
    [/^共 (\d+) 张表$/, (count) => `${count} tables`],
    [/^(\d+) 个数据库$/, (count) => `${count} databases`],
    [/^第 (\d+) 页 · 每页 (\d+) 行$/, (page, size) => `Page ${page} · ${size} rows per page`],
    [/^已保存 (\d+)$/, (count) => `Saved ${count}`],
    [/^数据表 · (.+)$/, (name) => `Tables · ${name}`],
    [/^查询 · (.+)$/, (name) => `Query · ${name}`],
    [/^数据 · (.+)$/, (name) => `Data · ${name}`],
    [/^设计表 · (.+)$/, (name) => `Design table · ${name}`],
    [/^新建表 · (.+)$/, (name) => `New table · ${name}`],
    [/^已载入：(.*)$/, (name) => `Loaded: ${name}`],
    [/^已保存：(.*)$/, (name) => `Saved: ${name}`],
    [/^已删除：(.*)$/, (name) => `Deleted: ${name}`],
    [/^已应用：(.*)$/, (name) => `Applied: ${name}`],
    [/^保存到数据库“(.+)”$/, (name) => `Save to database “${name}”`]
  ]
  for (const [pattern, formatter] of patterns) {
    const match = source.match(pattern)
    if (match) return formatter(...match.slice(1))
  }
  return source
}

const renderText = (node: Text): void => {
  if (node.parentElement?.closest('code, pre, textarea, script, style')) return
  let record = textSources.get(node)
  if (!record || node.data !== record.rendered) record = { source: node.data, rendered: node.data }
  const whitespace = record.source.match(/^(\s*)(.*?)(\s*)$/s)
  const rendered = whitespace ? `${whitespace[1]}${translate(whitespace[2])}${whitespace[3]}` : translate(record.source)
  record.rendered = rendered
  textSources.set(node, record)
  if (node.data !== rendered) node.data = rendered
}

const translatedAttributes = ['placeholder', 'title', 'aria-label']
const renderAttributes = (element: Element): void => {
  const records = attributeSources.get(element) ?? new Map<string, RenderedText>()
  translatedAttributes.forEach((attribute) => {
    const value = element.getAttribute(attribute)
    if (value === null) return
    let record = records.get(attribute)
    if (!record || value !== record.rendered) record = { source: value, rendered: value }
    record.rendered = translate(record.source)
    records.set(attribute, record)
    if (value !== record.rendered) element.setAttribute(attribute, record.rendered)
  })
  attributeSources.set(element, records)
}

const renderTree = (root: Node): void => {
  if (root.nodeType === Node.TEXT_NODE) {
    renderText(root as Text)
    return
  }
  if (!(root instanceof Element)) return
  renderAttributes(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let node: Node | null = walker.nextNode()
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) renderText(node as Text)
    else renderAttributes(node as Element)
    node = walker.nextNode()
  }
}

export const applyInterfaceLanguage = (language: AppLanguage): void => {
  currentLanguage = language
  document.documentElement.lang = language
  observer?.disconnect()
  renderTree(document.body)
  observer = new MutationObserver((mutations) => mutations.forEach((mutation) => {
    if (mutation.type === 'characterData') renderText(mutation.target as Text)
    else if (mutation.type === 'attributes') renderAttributes(mutation.target as Element)
    else mutation.addedNodes.forEach(renderTree)
  }))
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: translatedAttributes })
}

export const stopInterfaceLanguage = (): void => {
  observer?.disconnect()
  observer = null
}
