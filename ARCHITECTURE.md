# QuillDB 项目架构文档

## 一、项目概述

QuillDB 是一款跨平台桌面数据库工作台，基于 **Electron + React + TypeScript** 构建，内置 12 种数据库引擎连接能力（Oracle、Elasticsearch 为规划中能力，尚未实现适配器），并提供分层对象浏览、SQL 编辑与执行、执行计划、可编辑结果集、表结构设计、SSH/SFTP、AI 数据库助手以及数据导入导出等能力。仓库保留 HarmonyOS ArkWeb 构建配置（`vite.harmony.config.ts`），客户端工程暂未随仓库分发。

---

## 二、技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **桌面框架** | Electron 38 | 主进程/渲染进程架构 |
| **构建工具** | electron-vite 4 | 主/预加载/渲染三端独立打包 |
| **打包工具** | electron-builder 26 | 跨平台分发 |
| **前端框架** | React 19 | 函数组件 + Hooks 模式 |
| **状态管理** | Zustand 5 | 轻量级、支持持久化中间件 |
| **代码编辑器** | CodeMirror 6 | SQL 编辑器核心 |
| **终端模拟器** | xterm.js 6 | SSH 终端 |
| **虚拟滚动** | @tanstack/react-virtual 3 | 大数据量表格渲染 |
| **类型系统** | TypeScript 5.9 | 全栈类型安全 |
| **数据库驱动** | mysql2, pg, pg-cursor | 服务端数据库连接 |
| **SSH** | ssh2 | SSH 隧道和终端 |
| **持久化** | Node.js DatabaseSync (SQLite) | 用户数据存储 |
| **密码安全** | Electron safeStorage | 加密存储 |

---

## 三、进程架构

QuillDB 遵循 Electron 经典的三进程架构：

```
┌─────────────────────────────────────────────────────────────┐
│                      BrowserWindow                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               Renderer Process (React)                │   │
│  │   contextIsolation: true   nodeIntegration: false     │   │
│  │   sandbox: true                                       │   │
│  │                                                       │   │
│  │   window.omnidb.*  ←── contextBridge ──┐              │   │
│  └─────────────────────────────────────────┼──────────────┘   │
│                                              │                  │
│  ┌─────────────────────────────────────────┼──────────────┐   │
│  │              Preload Process            │              │   │
│  │   ipcRenderer.invoke()  ────────────────┘              │   │
│  └─────────────────────────────────────────┬──────────────┘   │
└────────────────────────────────────────────┼──────────────────┘
                                               │
  ┌─────────────────────────────────────────┼──────────────┐
  │              Main Process                │              │
  │   ipcMain.handle()  ←───────────────────┘              │
  │                                                         │
  │   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │
  │   │  Services   │  │   Adapters    │  │   Workers    │ │
  │   └─────────────┘  └──────────────┘  └──────────────┘ │
  └─────────────────────────────────────────────────────────┘
```

- **渲染进程**：沙箱环境运行 React UI，无法直接访问 Node.js API
- **预加载进程**：通过 `contextBridge` 安全暴露有限 API
- **主进程**：运行所有后端服务、数据库连接、Worker 线程管理

---

## 四、目录结构

```
src/
├── main/                          # 主进程
│   ├── index.ts                   # 入口：窗口创建、菜单、IPC 注册、生命周期
│   ├── database/
│   │   └── connection-repository.ts   # 数据持久层 (SQLite)
│   └── services/
│       ├── adapters/                  # 数据库适配器
│       │   ├── mysql-adapter.ts
│       │   ├── postgresql-adapter.ts
│       │   └── sqlite-adapter.ts
│       ├── connection-service.ts      # 连接管理核心（最大服务文件）
│       ├── ai-agent-service.ts        # AI Agent 服务
│       ├── ssh-service.ts             # SSH 终端服务
│       ├── import-export-service.ts   # 数据导入导出
│       ├── transaction-manager.ts     # 事务生命周期管理
│       ├── ssh-tunnel-manager.ts      # SSH 端口转发管理
│       ├── query-cursor-manager.ts    # 大结果集分页
│       ├── sql-statement-splitter.ts  # SQL 批量语句分割
│       ├── db-query-runtime.ts        # DB Worker 代理
│       ├── sqlite-runtime.ts          # SQLite Worker 代理
│       ├── db-query-worker.ts         # MySQL/PG Worker 线程
│       ├── sqlite-worker.ts           # SQLite Worker 线程
│       ├── worker-proxy.ts            # Worker 线程通用代理
│       ├── ipc-validators.ts          # IPC 参数校验
│       └── ssl-helper.ts              # SSL 配置辅助
│
├── preload/
│   └── index.ts                   # contextBridge 桥接
│
├── renderer/
│   ├── index.html                 # HTML 入口
│   └── src/
│       ├── main.tsx               # React 挂载入口
│       ├── App.tsx                # 根组件
│       ├── styles/                # CSS 变量与组件样式
│       ├── components/            # UI 组件
│       │   ├── query/             # 查询工作区（CodeMirror + 结果面板）
│       │   ├── ConnectionSidebar.tsx
│       │   ├── ConnectionDialog.tsx
│       │   ├── AiDatabaseWorkspace.tsx
│       │   ├── SshTerminalWorkspace.tsx
│       │   └── ...
│       ├── stores/                # Zustand 状态管理
│       │   ├── tabs/              # 标签页状态（按工作区类型拆分）
│       │   ├── useConnectionStore.ts
│       │   ├── useTabStore.ts
│       │   └── ...
│       ├── contexts/              # React Context（Toast 等）
│       ├── hooks/                 # 通用 hooks
│       ├── platform/              # 平台适配（Electron / 鸿蒙）
│       ├── i18n/                  # 国际化
│       └── utils/                 # 工具函数
│
└── shared/                        # 主进程与渲染进程共享
    ├── ipc-channels.ts            # IPC 通道常量
    ├── connections.ts             # 连接/数据库类型定义
    ├── ai-agent.ts                # AI Agent 类型
    └── ssh-files.ts               # SSH 文件操作类型
```

---

## 五、主进程架构

### 5.1 入口流程

```
src/main/index.ts
  │
  ├─ 初始化 SQLite 持久化存储 (omnidb.sqlite)
  ├─ 创建应用菜单 (中英文双语)
  ├─ 创建 BrowserWindow (1440×900)
  ├─ 注册 80+ IPC handlers（静态 channel + SSH 动态 channel）
  └─ 监听 app 生命周期，退出时清理资源
```

### 5.2 服务层

主进程的业务逻辑按服务拆分，每个文件负责一个独立领域：

| 服务 | 职责 |
|------|------|
| `ConnectionService` | 最核心的服务：连接生命周期管理（增删改查、打开/关闭）、SQL 执行路由、表/数据库元数据查询 |
| `ConnectionRepository` | 基于 Node.js `DatabaseSync` 的持久化层，存储连接信息、AI 配置、保存的查询等。密码通过 `safeStorage` 加密 |
| `AiAgentService` | 对接 OpenAI 兼容 API / Ollama，提供 SQL 建议和自动执行 |
| `SshService` | 基于 `ssh2` 的 SSH 终端连接管理 |
| `SshTunnelManager` | SSH 端口转发，为远程数据库创建本地隧道 |
| `TransactionManager` | 手动事务生命周期管理，30 分钟超时自动回滚 |
| `ImportExportService` | CSV/JSON/Excel 导入导出、SQL Dump |
| `QueryCursorManager` | 大结果集分页，每页 5000 行，游标 30 分钟 TTL |

### 5.3 数据库适配器模式

```
ConnectionService (路由层)
    │
    ├── engine === 'mysql' | 'mariadb' | 'tidb'
    │       └── MySQLAdapter → mysql2 Pool（Worker 线程）
    │
    ├── engine === 'postgresql' | '人大金仓' | '达梦'
    │       └── PostgreSQL 系 Adapter → pg Pool + pg-cursor
    │
    ├── engine === 'sqlite' | 'duckdb'
    │       └── SQLite/DuckDB Adapter → DatabaseSync / duckdb
    │
    └── engine === 'sql server' | 'mongodb' | 'clickhouse' | 'redis'
            └── 各独立 Adapter → mssql / mongodb / @clickhouse/client / ioredis
```

当前 `adapters/` 下共 10 个适配器文件；Oracle、Elasticsearch 仅保留连接界面选项，无适配器实现（规划中）。

每个适配器统一实现以下接口约定：
- **连接池管理**：按 `connectionId:database` 缓存连接池
- **元数据查询**：`listDatabases()`, `listTables()`, `listColumns()`
- **查询执行**：`execute(sql, params)`
- **行级操作**：`insertRow()`, `updateRow()`, `deleteRow()`
- **DDL 生成**：从表结构定义生成 `CREATE TABLE` 语句
- **导出 SQL**：生成 `INSERT INTO` 导出语句

### 5.4 Worker 线程架构

数据库 I/O 操作通过 Worker 线程异步执行，避免阻塞主进程事件循环：

```
Main Process
    │
    ├─ db-query-runtime.ts (WorkerProxy)
    │       └─ db-query-worker.ts (Worker Thread)
    │           ├─ MySQL 连接池 (mysql2)
    │           ├─ PostgreSQL 连接池 (pg)
    │           └─ 事务级连接
    │
    └─ sqlite-runtime.ts (WorkerProxy)
            └─ sqlite-worker.ts (Worker Thread)
                └─ Node.js DatabaseSync 文件操作
```

`WorkerProxy` 类提供通用能力：
- 请求/响应 ID 匹配
- Worker 懒初始化
- 崩溃自动恢复
- 进度消息回调（如 SQLite 导出进度）

---

## 六、预加载层 (Preload)

```typescript
// 通过 contextBridge 安全暴露 API
contextBridge.exposeInMainWorld('omnidb', {
  getAppInfo(),
  onSettingsRequested(),
  // AI
  ai: { listModels, saveModel, deleteModel, chat, executeProposal },
  // 连接管理
  connections: { list, create, update, open, close, delete, ... },
  // 数据库操作
  databases: { listCharsets, create, exportSql, delete, ... },
  // 查询执行
  queries: { execute, fetchMore, beginTransaction, commit, rollback, ... },
  // 表操作
  tables: { readData, create, updateRow, deleteRow, importData, exportData, ... },
  // SSH
  ssh: { connect, write, resize, disconnect, listFiles, uploadFiles, ... }
})
```

安全配置：
- `contextIsolation: true` — 渲染进程无法直接访问 Node.js
- `nodeIntegration: false` — 禁止渲染进程使用 Node.js
- `sandbox: true` — 沙箱环境

---

## 七、渲染进程架构

### 7.1 状态管理 (Zustand)

采用按职责拆分的多 Store 模式：

```
stores/
├── useConnectionStore        # 连接列表、加载/刷新
├── useTabStore               # 全局标签页协调器（激活/关闭/Pin/分割）
├── useSidebarStore           # 侧边栏状态、树节点、右键菜单
├── useEditorStore            # 编辑器状态
├── useDialogStore            # 对话框开关状态
├── useUIStore                # UI 设置（语言、主题、布局）
└── tabs/                     # 按工作区类型拆分
    ├── useQueryTabsStore         # SQL 查询标签页
    ├── useTableDataTabsStore     # 表数据浏览标签页
    ├── useTableDesignerTabsStore # 表设计器标签页
    ├── useDatabaseTabsStore      # 数据库概览标签页
    └── useTerminalTabsStore      # SSH 终端标签页
```

`useTabStore` 作为**协调器**，管理跨工作区类型的标签页操作（切换、关闭、Pin、分割视图）。
各工作区 Store 只关心自己类型标签页的状态。

### 7.2 组件层次

```
App
├── ConnectionSidebar              # 左侧连接树
│   ├── 连接分组 / 数据库列表
│   ├── 表/视图列表
│   ├── 右键菜单
│   └── 图标系统
│
├── TabBar                         # 标签页栏
│   ├── Query Tabs
│   ├── Table Data Tabs
│   ├── Database Overview Tabs
│   └── Terminal Tabs
│
├── 工作区内容
│   ├── QueryWorkspace
│   │   ├── SqlEditor (CodeMirror 6)
│   │   └── ResultPanel (虚拟滚动表格)
│   ├── TableDataWorkspace
│   ├── DatabaseTablesWorkspace
│   ├── AiDatabaseWorkspace
│   └── SshTerminalWorkspace (xterm.js)
│
├── StatusBar                       # 底部状态栏
│
└── 对话框层
    ├── ConnectionDialog
    ├── DatabaseDialog
    ├── TableDialog
    ├── SettingsDialog
    ├── AiModelSettingsDialog
    └── AboutDialog
```

### 7.3 查询工作区设计 (QueryWorkspace)

查询工作区是使用频率最高的模块，采用 Hooks 组合模式：

```
QueryWorkspace.tsx
├── useQueryExecution()      # 查询执行（快捷键 F5 / Ctrl+Enter）
├── usePanelResize()         # 编辑区/结果区拖拽分割
├── useSqlValidation()       # SQL 实时校验
├── useSqlFormatter()        # SQL 格式化
├── useCompletionCandidates() # CodeMirror 补全候选
├── useQueryHistory()        # 查询历史
├── useSavedQueries()        # 已保存查询
├── useCellEditing()         # 结果集单元格编辑
└── useColumnResize()        # 结果集列宽调整
```

### 7.4 平台适配

```
renderer/src/platform/platform-bridge.ts
│
├── __QUILLDB_HARMONY__ === true
│   └── createHarmonyApi() / window.orbisqlHarmony  (鸿蒙原生桥接)
│
└── 默认 (Electron)
    └── window.omnidb (contextBridge 桥接)
```

通过 `__QUILLDB_HARMONY__` 编译时常量和条件编译实现不同平台的适配逻辑，鸿蒙构建使用 `vite.harmony.config.ts` 配置文件。

---

## 八、IPC 通信规范

### 8.1 通信流程

```
Renderer                    Preload                      Main
───────                     ───────                      ────
window.omnidb.xxx()  ──→  ipcRenderer.invoke()  ──→  ipcMain.handle()
  ↓                                                      ↓
Promise 返回        ←──  ipcRenderer.invoke  ←──  return / throw
```

### 8.2 Channel 命名

所有 channel 在 `shared/ipc-channels.ts` 统一定义，确保主进程和预加载层引用同一常量：

```
app:settings-requested
connections:list          connections:create          connections:open
databases:list-charsets   databases:create            databases:export-sql
queries:execute           queries:fetch-more           queries:begin-transaction
tables:read-data          tables:create                tables:update-row
ai:list-models            ai:chat                     ai:execute-proposal
ssh:connect               ssh:write                   ssh:disconnect
```

动态 channel 使用函数生成：`ssh:output:${sessionId}`, `ssh:error:${sessionId}`

### 8.3 安全校验

每个 IPC handler 在执行业务逻辑前进行运行时参数校验：

```typescript
// ipc-validators.ts 提供的校验函数
expectInt(value, name, options?)     // 整数校验
expectString(value, name, options?)  // 字符串校验
expectObject(value, name)            // 对象校验
expectOneOf(value, name, allowed)    // 枚举校验
expectArray(value, name, options?)   // 数组校验
```

---

## 九、连接管理生命周期

```
┌──────────────┐
│  创建连接     │  保存到 SQLite（密码 safeStorage 加密）
└──────┬───────┘
       ↓
┌──────────────┐
│  打开连接     │  ConnectionService.open()
│              │  ├── 读取存储的连接配置
│              │  ├── 若有 SSH → SshTunnelManager 建立隧道
│              │  ├── 通过适配器连接目标数据库
│              │  ├── 读取元数据（数据库/表/视图列表）
│              │  └── 标记连接状态为 open
└──────┬───────┘
       ↓
┌──────────────┐
│  查询/操作    │  通过适配器执行 → Worker 线程
│              │  结果集 > 5000 行 → QueryCursorManager 分页
└──────┬───────┘
       ↓
┌──────────────┐
│  关闭连接     │  ConnectionService.close()
│              │  ├── 关闭数据库连接池
│              │  ├── 关闭 SSH 隧道
│              │  └── 清理关联游标
└──────────────┘
```

### 连接池缓存策略

| 引擎 | 缓存 Key | 实现 |
|------|---------|------|
| MySQL | `connectionId:database` | mysql2.createPool() |
| PostgreSQL | `connectionId:database` | pg.Pool |
| SQLite | 文件路径 | Worker 线程中的 DatabaseSync 句柄 |

### 结果分页策略

- 单次查询上限：**5000 行**
- 超出上限：返回 `truncated: true` + `cursorId`
- 渲染进程调用 `fetchMore(cursorId)` 分批拉取
- 游标 **30 分钟** 空闲自动过期清理
- 事务期间自动回滚：**30 分钟** 无活动

---

## 十、关键设计模式

| 模式 | 应用场景 |
|------|---------|
| **适配器模式** | `adapters/` 下各引擎适配器，统一接口屏蔽底层差异 |
| **代理模式** | `WorkerProxy` 封装 Worker 线程通信，提供统一 API |
| **工厂模式** | `ConnectionService` 根据引擎类型创建对应适配器 |
| **策略模式** | 不同数据库引擎使用不同的 SQL 生成策略 |
| **观察者模式** | Zustand 状态订阅驱动 UI 更新 |
| **组合模式** | Hooks 组合 (QueryWorkspace) 替代类继承 |
| **单例模式** | 各 Service 实例全局唯一 |

---

## 十一、构建配置

### electron-vite 三端入口

```typescript
// electron.vite.config.ts
{
  main: { entry: 'src/main/index.ts' },
  preload: { 
    entry: 'src/preload/index.ts',
    config: { plugins: [...] }
  },
  renderer: {
    entry: 'src/renderer/src/main.tsx',
    config: { plugins: [react()] }
  },
  plugins: [externalizeDepsPlugin()]
}
```

### 鸿蒙构建

```typescript
// vite.harmony.config.ts
// 将 JS/CSS 内联到单个 HTML 文件
// 通过 __QUILLDB_HARMONY__ 编译常量区分平台
```

---

## 十二、支持的数据引擎

| 类别 | 数据库引擎 |
|------|-----------|
| **关系型** | MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, TiDB, DuckDB |
| **国产数据库** | 达梦 (DM), 人大金仓 (Kingbase) |
| **列存储** | ClickHouse |
| **文档型** | MongoDB |
| **键值型** | Redis |

> Oracle、Elasticsearch 的连接选项已保留在界面与能力矩阵中，但适配器尚未实现，属规划中能力。
