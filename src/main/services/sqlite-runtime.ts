import { createRequire } from 'node:module'

export interface SqliteStatement {
  all: (...values: unknown[]) => unknown[]
  columns: () => Array<{ name: string; column?: string; database?: string; table?: string; type?: string | null }>
  get: (...values: unknown[]) => unknown
  run: (...values: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint }
}

export interface SqliteDatabase {
  close: () => void
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
}

const originalEmitWarning = process.emitWarning
process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message
  if (message?.includes('SQLite is an experimental feature')) return
  return (originalEmitWarning as Function).call(process, warning, ...args)
}

// Compute the module id so bundling cannot move node:sqlite above the filter.
const sqliteModuleId = ['node', 'sqlite'].join(':')
export const { DatabaseSync } = createRequire(import.meta.url)(sqliteModuleId) as {
  DatabaseSync: new (path: string) => SqliteDatabase
}
