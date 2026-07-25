// ── localStorage Key 常量（统一 quilldb.* 前缀） ──────────

export const LS_KEYS = {
  // Preferences
  LANGUAGE: 'quilldb.preferences.language',
  THEME: 'quilldb.preferences.theme',
  // Sidebar
  SIDEBAR_WIDTH: 'quilldb.sidebar.width',
  SIDEBAR_COLLAPSED: 'quilldb.sidebar.collapsed',
  // Recent connections
  RECENT_CONNECTIONS: 'quilldb.recent-connections.v1',
  // Pinned tabs
  PINNED_TABS: 'quilldb.pinned-tabs.v1',
  // SQL history
  SQL_HISTORY: 'quilldb.sql-history.v1',
  // AI sessions
  AI_SESSIONS: 'quilldb.ai.sessions.v1',
  AI_ACTIVE_SESSION: 'quilldb.ai.active-session.v1',
  // SSH Terminal
  SSH_FONT_SIZE: 'quilldb.ssh-terminal.font-size',
  SSH_FILE_PANEL_WIDTH: 'quilldb.ssh-terminal.file-panel-width'
} as const

// ── 旧 key → 新 key 映射（用于一次性迁移） ────────────────

const LEGACY_KEY_MAP: Record<string, string> = {
  // omnidb → quilldb（最初品牌）
  'omnidb.preferences.language': LS_KEYS.LANGUAGE,
  'omnidb.preferences.theme': LS_KEYS.THEME,
  'omnidb.sidebar.width': LS_KEYS.SIDEBAR_WIDTH,
  'ssh-terminal-font-size': LS_KEYS.SSH_FONT_SIZE,
  'ssh-terminal-file-panel-width': LS_KEYS.SSH_FILE_PANEL_WIDTH,
  // orbisql → quilldb（第二品牌）
  'orbisql.preferences.language': LS_KEYS.LANGUAGE,
  'orbisql.preferences.theme': LS_KEYS.THEME,
  'orbisql.sidebar.width': LS_KEYS.SIDEBAR_WIDTH,
  'orbisql.sidebar.collapsed': LS_KEYS.SIDEBAR_COLLAPSED,
  'orbisql.recent-connections.v1': LS_KEYS.RECENT_CONNECTIONS,
  'orbisql.pinned-tabs.v1': LS_KEYS.PINNED_TABS,
  'orbisql.sql-history.v1': LS_KEYS.SQL_HISTORY,
  'orbisql.ai.sessions.v1': LS_KEYS.AI_SESSIONS,
  'orbisql.ai.active-session.v1': LS_KEYS.AI_ACTIVE_SESSION,
  'orbisql.ssh-terminal.font-size': LS_KEYS.SSH_FONT_SIZE,
  'orbisql.ssh-terminal.file-panel-width': LS_KEYS.SSH_FILE_PANEL_WIDTH
}

const MIGRATION_FLAG = 'quilldb.migration.v1.done'

/**
 * 一次性迁移旧 localStorage key 到新 key。
 * 读取旧 key → 写入新 key（如果新 key 不存在）→ 删除旧 key。
 * 应在应用启动时调用一次。
 */
export function migrateLegacyStorageKeys(): void {
  if (localStorage.getItem(MIGRATION_FLAG)) return

  for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_MAP)) {
    const oldValue = localStorage.getItem(oldKey)
    if (oldValue !== null && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, oldValue)
    }
    localStorage.removeItem(oldKey)
  }

  localStorage.setItem(MIGRATION_FLAG, '1')
}
