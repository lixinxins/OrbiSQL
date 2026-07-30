/**
 * SQL 词法分析、语法验证、文本压缩等纯工具函数和常量
 * 提供 SQL 词法标记化（tokenize）、关键字/函数集合、压缩格式化、以及基于 schema 的语法校验能力。
 */
import type { DatabaseItem } from '@/shared/connections'

/** 返回光标所在的单条 SQL；分号出现在字符串、注释或 PostgreSQL dollar quote 中时不会误分割。 */
export const getSqlStatementAtPosition = (sql: string, cursorPosition: number): string => {
  const ranges: Array<{ from: number; to: number }> = []
  let start = 0
  let index = 0
  let quote = ''
  let dollarTag = ''
  let lineComment = false
  let blockComment = false

  while (index < sql.length) {
    const current = sql[index]
    const next = sql[index + 1]
    if (lineComment) {
      if (current === '\n') lineComment = false
      index += 1
      continue
    }
    if (blockComment) {
      if (current === '*' && next === '/') { blockComment = false; index += 2 } else index += 1
      continue
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) { index += dollarTag.length; dollarTag = '' } else index += 1
      continue
    }
    if (quote) {
      if (current === '\\') { index += 2; continue }
      if (current === quote) {
        if (sql[index + 1] === quote && quote !== '`') index += 2
        else { quote = ''; index += 1 }
      } else index += 1
      continue
    }
    if (current === '-' && next === '-') { lineComment = true; index += 2; continue }
    if (current === '#') { lineComment = true; index += 1; continue }
    if (current === '/' && next === '*') { blockComment = true; index += 2; continue }
    if (current === "'" || current === '"' || current === '`') { quote = current; index += 1; continue }
    if (current === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)
      if (match) { dollarTag = match[0]; index += dollarTag.length; continue }
    }
    if (current === ';') {
      if (sql.slice(start, index).trim()) ranges.push({ from: start, to: index + 1 })
      start = index + 1
    }
    index += 1
  }
  if (sql.slice(start).trim()) ranges.push({ from: start, to: sql.length })
  if (!ranges.length) return ''

  const boundedCursor = Math.max(0, Math.min(cursorPosition, sql.length))
  const currentRange = ranges.find((range) => boundedCursor >= range.from && boundedCursor <= range.to)
    ?? ranges.find((range) => range.from >= boundedCursor)
    ?? ranges[ranges.length - 1]
  return sql.slice(currentRange.from, currentRange.to).trim()
}

/** 常用 SQL 关键字列表（含多词关键字如 LEFT JOIN、GROUP BY 等） */
export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'DATABASE', 'VIEW', 'INDEX', 'JOIN', 'LEFT JOIN',
  'RIGHT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'LIKE', 'IN',
  'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'
]

/** 将所有关键字按空格拆分后的单词集合，用于快速判断某个词是否为 SQL 关键字 */
export const SQL_KEYWORD_SET = new Set(SQL_KEYWORDS.flatMap((keyword) => keyword.split(' ')))

/** 内置 SQL 函数名集合，用于语法校验时排除函数调用 */
export const SQL_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW', 'COALESCE', 'IFNULL', 'CONCAT', 'DATE_FORMAT', 'ROUND'])

/** SQL 词法标记接口，表示一段连续的同类字符序列 */
export interface SqlToken {
  /** 标记的原始文本 */
  value: string
  /** 标记在原始 SQL 中的起始位置（字符索引） */
  start: number
  /** 标记类型：空白、注释、字符串、数字、标识符/关键字、符号 */
  kind: 'space' | 'comment' | 'string' | 'number' | 'word' | 'symbol'
}

/** SQL 语法校验结果接口 */
export interface SqlValidation {
  /** 词法标记列表 */
  tokens: SqlToken[]
  /** 错误标记的起始位置集合 */
  errorStarts: Set<number>
  /** 错误描述信息列表 */
  messages: string[]
}

/**
 * SQL 词法分析器：将 SQL 字符串拆分为标记序列
 * 支持识别空白、单行注释（-- / #）、多行注释（/* *\/）、
 * 字符串（单引号/双引号）、反引号标识符、数字、标识符（含中文）和单字符符号。
 * @param sql - 待分析的 SQL 字符串
 * @returns 词法标记数组
 */
export const tokenizeSql = (sql: string): SqlToken[] => {
  const tokens: SqlToken[] = []
  let index = 0
  while (index < sql.length) {
    const start = index
    const character = sql[index]
    // 空白字符：连续空白合并为一个标记
    if (/\s/.test(character)) {
      while (index < sql.length && /\s/.test(sql[index])) index += 1
      tokens.push({ value: sql.slice(start, index), start, kind: 'space' })
    }
    // 单行注释：-- 或 # 开头，到行尾结束
    else if (sql.startsWith('--', index) || character === '#') {
      index = sql.indexOf('\n', index)
      if (index < 0) index = sql.length
      tokens.push({ value: sql.slice(start, index), start, kind: 'comment' })
    }
    // 多行注释：/* ... */
    else if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2)
      index = end < 0 ? sql.length : end + 2
      tokens.push({ value: sql.slice(start, index), start, kind: 'comment' })
    }
    // 引号字符串或反引号标识符
    else if (character === "'" || character === '"' || character === '`') {
      const quote = character
      index += 1
      // 处理转义字符（反斜杠）和闭合引号
      while (index < sql.length) {
        if (sql[index] === '\\') index += 2
        else if (sql[index] === quote) { index += 1; break }
        else index += 1
      }
      // 反引号视为标识符（word），其余视为字符串
      tokens.push({ value: sql.slice(start, index), start, kind: quote === '`' ? 'word' : 'string' })
    }
    // 数字字面量
    else if (/\d/.test(character)) {
      while (index < sql.length && /[\d.]/.test(sql[index])) index += 1
      tokens.push({ value: sql.slice(start, index), start, kind: 'number' })
    }
    // 标识符（英文字母、下划线、$、中文字符）
    else if (/[A-Za-z_$\u4e00-\u9fff]/.test(character)) {
      while (index < sql.length && /[A-Za-z0-9_$\u4e00-\u9fff]/.test(sql[index])) index += 1
      tokens.push({ value: sql.slice(start, index), start, kind: 'word' })
    }
    // 其他单字符符号
    else {
      index += 1
      tokens.push({ value: character, start, kind: 'symbol' })
    }
  }
  return tokens
}

/** 去除标识符两端的反引号，还原原始标识符名 */
const identifierValue = (token: SqlToken): string => token.value.replace(/^`|`$/g, '')

/**
 * SQL 文本压缩：移除多余空白，保留必要空格，将注释统一为块注释格式
 * 用于在有限空间内展示 SQL 摘要。
 * @param sql - 待压缩的 SQL 字符串
 * @returns 压缩后的 SQL 字符串
 */
export const compressSqlText = (sql: string): string => {
  // 过滤掉空白标记，保留有内容的标记
  const tokens = tokenizeSql(sql).filter((token) => token.kind !== 'space')
  // 判断标记是否为"词类"（需要前后空格的标记类型）
  const isWordLike = (token: SqlToken): boolean => ['word', 'number', 'string'].includes(token.kind)
  // 渲染单个标记：注释统一转为 /* ... */ 格式，其他标记原样输出
  const renderToken = (token: SqlToken): string => {
    if (token.kind !== 'comment') return token.value
    const singleLineComment = token.value.startsWith('--') || token.value.startsWith('#')
    const content = singleLineComment
      ? token.value.replace(/^(--|#)\s*/, '')
      : token.value.replace(/^\/\*|\*\/$/g, '')
    return `/* ${content.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim()} */`
  }

  let output = ''
  let previous: SqlToken | undefined
  tokens.forEach((token) => {
    // 判断原始 SQL 中两个标记之间是否曾有空白
    const hadWhitespace = previous
      ? previous.start + previous.value.length < token.start
      : false
    // 判断两个标记之间是否需要插入空格（避免关键字粘连等）
    const needsSpace = previous && (
      (isWordLike(previous) && isWordLike(token))
      || previous.kind === 'comment'
      || token.kind === 'comment'
      || (previous.value === ')' && token.kind === 'word')
      || (previous.kind === 'symbol' && token.kind === 'symbol' && hadWhitespace)
    )
    if (needsSpace && output && !output.endsWith(' ')) output += ' '
    output += renderToken(token)
    previous = token
  })
  return output.trim()
}

/**
 * SQL 语法校验：基于数据库 schema 检查表名和字段名是否存在
 * 校验逻辑：
 *  1. 解析 FROM/JOIN/UPDATE/INTO 后的表名，检查表是否存在，并收集别名映射
 *  2. 检查 "表别名.字段名" 形式的字段是否在对应表中
 *  3. 单表查询时，检查 SELECT 和 FROM 之间的无限定字段名
 * @param sql - 待校验的 SQL 字符串
 * @param database - 当前数据库的 schema 信息（表名和字段列表）
 * @returns 校验结果，包含标记列表、错误位置集合和错误消息数组
 */
export const validateSql = (sql: string, database?: DatabaseItem): SqlValidation => {
  const tokens = tokenizeSql(sql)
  const errorStarts = new Set<number>()
  const messages = new Set<string>()
  // 无 schema 信息或空 SQL 时跳过校验
  if (!database || !sql.trim()) return { tokens, errorStarts, messages: [] }

  // 过滤掉空白和注释标记，只保留有语义的标记
  const significant = tokens.filter((token) => token.kind !== 'space' && token.kind !== 'comment')
  // 别名 -> 表信息的映射，用于后续字段校验
  const aliases = new Map<string, DatabaseItem['tables'][number]>()
  const sourceTables: DatabaseItem['tables'] = []
  // 记录表名/别名所在的索引，避免被误判为字段名
  const tableTokenIndexes = new Set<number>()

  // 第一步：解析 FROM/JOIN/UPDATE/INTO 后的表名和别名
  for (let index = 0; index < significant.length; index += 1) {
    const keyword = significant[index].value.toUpperCase()
    if (!['FROM', 'JOIN', 'UPDATE', 'INTO'].includes(keyword)) continue
    // 跳过可选的 schema 前缀（如 schema.table）
    let tableIndex = index + 1
    if (significant[tableIndex + 1]?.value === '.') tableIndex += 2
    const tableToken = significant[tableIndex]
    if (!tableToken || tableToken.kind !== 'word') continue
    tableTokenIndexes.add(tableIndex)
    const tableName = identifierValue(tableToken)
    const table = database.tables.find((item) => item.name.toLowerCase() === tableName.toLowerCase())
    if (!table) {
      errorStarts.add(tableToken.start)
      messages.add(`数据表"${tableName}"不存在`)
      continue
    }
    sourceTables.push(table)
    aliases.set(table.name.toLowerCase(), table)
    // 解析可选的表别名（[AS] alias）
    let aliasIndex = tableIndex + 1
    if (significant[aliasIndex]?.value.toUpperCase() === 'AS') aliasIndex += 1
    const aliasToken = significant[aliasIndex]
    if (aliasToken?.kind === 'word' && !SQL_KEYWORD_SET.has(aliasToken.value.toUpperCase())) {
      aliases.set(identifierValue(aliasToken).toLowerCase(), table)
      tableTokenIndexes.add(aliasIndex)
    }
  }

  // 第二步：检查 "owner.column" 形式的字段引用是否存在
  for (let index = 0; index < significant.length - 2; index += 1) {
    const ownerToken = significant[index]
    const dot = significant[index + 1]
    const columnToken = significant[index + 2]
    if (ownerToken.kind !== 'word' || dot.value !== '.' || columnToken.kind !== 'word') continue
    const table = aliases.get(identifierValue(ownerToken).toLowerCase())
    if (!table) continue
    const columnName = identifierValue(columnToken)
    if (columnName !== '*' && !table.columns.some((col) => col.name.toLowerCase() === columnName.toLowerCase())) {
      errorStarts.add(columnToken.start)
      messages.add(`字段"${columnName}"不在表"${table.name}"中`)
    }
  }

  // 第三步：单表查询时，检查 SELECT 和 FROM 之间的无限定字段名
  const uniqueTables = Array.from(new Set(sourceTables))
  if (uniqueTables.length === 1) {
    const table = uniqueTables[0]
    const selectIndex = significant.findIndex((token) => token.value.toUpperCase() === 'SELECT')
    const fromIndex = significant.findIndex((token, index) => index > selectIndex && token.value.toUpperCase() === 'FROM')
    if (selectIndex >= 0 && fromIndex > selectIndex) {
      for (let index = selectIndex + 1; index < fromIndex; index += 1) {
        const token = significant[index]
        // 跳过非词类标记和表名/别名位置
        if (token.kind !== 'word' || tableTokenIndexes.has(index)) continue
        const value = identifierValue(token)
        const upper = value.toUpperCase()
        const previous = significant[index - 1]?.value.toUpperCase()
        const next = significant[index + 1]?.value
        // 跳过关键字、函数名、别名定义（AS）、函数调用（后接括号）、schema 限定（前后有.）
        if (SQL_KEYWORD_SET.has(upper) || SQL_FUNCTIONS.has(upper) || previous === 'AS' || next === '(' || significant[index - 1]?.value === '.' || next === '.') continue
        if (!table.columns.some((col) => col.name.toLowerCase() === value.toLowerCase())) {
          errorStarts.add(token.start)
          messages.add(`字段"${value}"不在表"${table.name}"中`)
        }
      }
    }
  }
  return { tokens, errorStarts, messages: Array.from(messages) }
}
