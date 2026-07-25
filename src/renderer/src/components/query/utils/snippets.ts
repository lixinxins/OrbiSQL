/**
 * 预设 SQL 代码片段
 * 提供常用 SQL 模板（查询、聚合、关联、建表、索引），供用户快速插入。
 */

/** SQL 代码片段接口 */
export interface SnippetItem {
  name: string
  sql: string
}

/** 预设 SQL 代码片段列表 */
export const PRESET_SNIPPETS: SnippetItem[] = [
  { name: 'SELECT 基础查询模板', sql: 'SELECT * FROM table_name LIMIT 100;' },
  { name: 'COUNT 统计聚合模板', sql: 'SELECT status, COUNT(*) AS total FROM table_name GROUP BY status HAVING COUNT(*) > 0;' },
  { name: 'INNER JOIN 关联查询模板', sql: 'SELECT a.*, b.* FROM table1 a\nINNER JOIN table2 b ON a.id = b.table1_id\nWHERE a.status = 1;' },
  { name: 'CREATE TABLE 建表 DDL 模板', sql: 'CREATE TABLE example (\n  id BIGINT PRIMARY KEY AUTO_INCREMENT,\n  name VARCHAR(255) NOT NULL,\n  status TINYINT NOT NULL DEFAULT 0,\n  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;' },
  { name: 'CREATE INDEX 创建索引模板', sql: 'CREATE INDEX idx_status_created ON table_name (status, created_at);' }
]
