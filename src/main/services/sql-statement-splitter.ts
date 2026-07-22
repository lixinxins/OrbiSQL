export const splitSqlStatements = (sql: string): string[] => {
  const statements: string[] = []
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
      const statement = sql.slice(start, index).trim()
      if (statement) statements.push(statement)
      start = index + 1
    }
    index += 1
  }
  const tail = sql.slice(start).trim()
  if (tail) statements.push(tail)
  return statements
}
