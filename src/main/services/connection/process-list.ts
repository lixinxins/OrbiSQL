import type { KillProcessResult, ProcessItem, ProcessListResult } from '../../../shared/connections'
import type { ConnectionCore } from './connection-core'
import type { QueryExecution } from './query-execution'

/** 活动进程/会话管理：进程列表与终止。 */
export class ProcessList {
  constructor(
    private readonly core: ConnectionCore,
    private readonly query: QueryExecution
  ) {}

  async getProcessList(connectionId: number): Promise<ProcessListResult> {
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    const engine = connection.engine
    const defaultDb = connection.defaultDatabase || ''

    let processSql = 'SHOW FULL PROCESSLIST;'
    if (engine === 'PostgreSQL' || engine === '人大金仓') {
      processSql = `SELECT pid AS "id", usename AS "user", client_addr || ':' || client_port AS "host", datname AS "db", state AS "command", round(EXTRACT(EPOCH FROM (now() - query_start)))::integer AS "time", state AS "state", query AS "info" FROM pg_stat_activity WHERE pid <> pg_backend_pid();`
    } else if (engine === 'SQLite') {
      processSql = 'PRAGMA database_list;'
    } else if (engine === 'Oracle' || engine === '达梦') {
      processSql = engine === '达梦'
        ? `SELECT sess_id AS "id", user_name AS "user", clnt_ip AS "host", db_name AS "db", state AS "command", datediff(ss, create_time, sysdate) AS "time", state AS "state", sql_text AS "info" FROM v$sessions;`
        : `SELECT sid || ',' || serial# AS "id", username AS "user", machine AS "host", schemaname AS "db", status AS "command", last_call_et AS "time", status AS "state", sql_id AS "info" FROM v$session WHERE type = 'USER';`
    } else if (engine === 'SQL Server') {
      processSql = `SELECT session_id AS "id", login_name AS "user", host_name AS "host", DB_NAME(database_id) AS "db", status AS "command", total_elapsed_time / 1000 AS "time", status AS "state", '' AS "info" FROM sys.dm_exec_sessions WHERE is_user_process = 1;`
    } else if (engine === 'ClickHouse') {
      processSql = `SELECT query_id AS "id", user AS "user", client_name AS "host", current_database AS "db", 'Query' AS "command", elapsed AS "time", 'running' AS "state", query AS "info" FROM system.processes;`
    } else if (engine === 'DuckDB') {
      processSql = `SELECT connection_id AS "id", 'user' AS "user", 'localhost' AS "host", database_name AS "db", 'Active' AS "command", 0 AS "time", 'active' AS "state", '' AS "info" FROM duckdb_connections();`
    }

    try {
      const res = await this.query.executeQuery(connectionId, defaultDb, processSql)
      if (!res.success || !res.rows) {
        return { success: false, message: res.message || '查询活动进程失败', rawSql: processSql }
      }

      const processes: ProcessItem[] = res.rows.map((row, index) => {
        const rowObj = row as Record<string, unknown>
        return {
          id: String(rowObj.id ?? rowObj.Id ?? rowObj.ID ?? rowObj.pid ?? rowObj.seq ?? index + 1),
          user: String(rowObj.user ?? rowObj.User ?? rowObj.usename ?? rowObj.user_name ?? 'local'),
          host: String(rowObj.host ?? rowObj.Host ?? rowObj.client_addr ?? rowObj.clnt_ip ?? 'localhost'),
          db: String(rowObj.db ?? rowObj.Db ?? rowObj.datname ?? rowObj.db_name ?? defaultDb),
          command: String(rowObj.command ?? rowObj.Command ?? rowObj.state ?? rowObj.Status ?? 'active'),
          time: Number(rowObj.time ?? rowObj.Time ?? rowObj.elapsed ?? 0),
          state: String(rowObj.state ?? rowObj.State ?? rowObj.status ?? 'running'),
          info: String(rowObj.info ?? rowObj.Info ?? rowObj.query ?? rowObj.sql_text ?? rowObj.file ?? ''),
          raw: rowObj
        }
      })

      return { success: true, processes, rawSql: processSql }
    } catch (err) {
      return { success: false, message: this.core.errorMessage(err), rawSql: processSql }
    }
  }

  async killProcess(connectionId: number, processId: string | number): Promise<KillProcessResult> {
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    const engine = connection.engine
    const defaultDb = connection.defaultDatabase || ''

    if (engine === 'SQLite') {
      return { success: false, message: 'SQLite 为单机文件数据库，不支持终止远程进程' }
    }
    if (engine === 'DuckDB') {
      return { success: false, message: 'DuckDB 为嵌入式分析数据库，不支持终止进程' }
    }

    let killSql = `KILL ${processId};`
    if (engine === 'PostgreSQL' || engine === '人大金仓') {
      killSql = `SELECT pg_terminate_backend(${Number(processId)});`
    } else if (engine === 'Oracle') {
      const pidStr = String(processId)
      killSql = pidStr.includes(',')
        ? `ALTER SYSTEM KILL SESSION '${pidStr}';`
        : `ALTER SYSTEM KILL SESSION '${pidStr},1';`
    } else if (engine === '达梦') {
      killSql = `CALL SP_KILL_SESSION(${processId});`
    } else if (engine === 'SQL Server') {
      killSql = `KILL ${processId};`
    } else if (engine === 'ClickHouse') {
      killSql = `KILL QUERY WHERE query_id = '${String(processId).replaceAll("'", "''")}';`
    }

    try {
      const res = await this.query.executeQuery(connectionId, defaultDb, killSql)
      if (res.success) {
        return { success: true, message: `已成功终止进程 ${processId}` }
      }
      return { success: false, message: res.message || `终止进程 ${processId} 失败` }
    } catch (err) {
      return { success: false, message: this.core.errorMessage(err) }
    }
  }
}
