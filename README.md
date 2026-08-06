<p align="center">
  <img src="resources/icon.png" width="96" height="96" alt="QuillDB Logo" />
</p>

<h1 align="center">QuillDB</h1>

<p align="center">A modern, open-source, cross-platform database workbench for developers and database administrators.</p>

<p align="center">
  <a href="https://github.com/lixinxins/QuillDB/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-38-47848F?logo=electron" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
</p>

<p align="center">
  <img src="宣传素材/quilldb-social-cover.png" width="100%" alt="QuillDB - Open source cross-platform database management tool" />
</p>

## Introduction

QuillDB is built with Electron, React, and TypeScript for macOS, Windows, and Linux. It brings multi-database connection management, object browsing, SQL editing and execution, data maintenance, import/export, SSH/SFTP, and an AI database assistant together in one desktop workbench — suited for daily development, data troubleshooting, and database operations.

It currently supports 12 database engines out of the box: MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, TiDB, ClickHouse, MongoDB, Redis, DuckDB, DM (达梦), and KingbaseES (人大金仓). Oracle and Elasticsearch connection options remain in the UI as planned capabilities; their adapters are not implemented yet. The repository also keeps the HarmonyOS ArkWeb build configuration, while the client project itself is not distributed with the repository.

> The current stable release is `1.1.1`. Issues, feature suggestions, and pull requests are welcome.

## UI Preview

### Workbench

Manage different database and SSH connections in one place, with groups, search, and a hierarchical object tree that lets you quickly jump into database, schema, table, query, and terminal workspaces. The Smart Workbench shows connection status, query activity, data size, and recent operations at a glance.

<p align="center">
  <img src="系统截图/首页截图.png" width="100%" alt="QuillDB Workbench" />
</p>

### SQL Query & Data Browsing

The query workspace supports SQL highlighting and validation, running the selected statement or the statement under the cursor, execution plans, formatting, minification, and query history. The result area supports batched loading of large result sets, copying, inline editing, and row deletion. The table page provides filtering, pagination, column design, and data import/export.

<table>
  <tr>
    <td width="50%"><img src="系统截图/查询页.png" alt="QuillDB SQL query page" /></td>
    <td width="50%"><img src="系统截图/数表打开页.png" alt="QuillDB table data page" /></td>
  </tr>
  <tr>
    <td align="center">SQL query and result set</td>
    <td align="center">Table data browsing and filtering</td>
  </tr>
</table>

### AI Database Assistant

Generate queries and analyze SQL or database structures from natural language within the context of the current connection and database. Read operations can be executed directly; write and high-risk operations still require user confirmation.

## Features

- Manage 12 database engines plus standalone SSH connections
- Group, search, sort, import/export database and SSH connections with environment labels
- SSH tunneling, interactive terminal, and SFTP file management with password and private key auth
- SSL/TLS secure connections with CA and client certificate support
- Connections stored locally; passwords encrypted via Electron `safeStorage`
- Engine-aware object browsing: databases, schemas, tables, views, columns, indexes, foreign keys, functions, procedures, triggers, and more
- Full object-tree context menus: expand/collapse, refresh, copy name, create, edit, query, maintain, and delete
- Multi-tab SQL editor with syntax highlighting, column validation, clear selection, copy, and run-selected-only
- Execution plans, SQL formatting and minification, query history, and saved queries
- Cursor-based batched loading for large result sets, result copying, editable result sets, and error location
- Table creation, structure design, rename, copy, truncate, and delete
- Table data viewing, filtering, pagination, cell editing, record insert, and delete
- SQL, CSV, JSON, and Excel import/export with preview, column mapping, and progress feedback
- AI database assistant that generates, explains, and analyzes SQL in the current connection context
- English and Chinese interface languages
- Light and classic themes, resizable and collapsible database sidebar
- Build configurations for macOS, Windows, and Linux installers
- HarmonyOS ArkWeb build configuration (client project not distributed with the repo)

## Supported Databases

| Category | Built-in engines |
| --- | --- |
| MySQL ecosystem | MySQL, MariaDB, TiDB |
| PostgreSQL ecosystem | PostgreSQL, KingbaseES |
| Commercial relational | SQL Server, DM |
| Embedded analytical | SQLite, DuckDB |
| Distributed & NoSQL | ClickHouse, MongoDB, Redis |

Object types, DDL, result editing, and maintenance capabilities vary by engine; the UI dynamically shows available actions based on engine capabilities. Please back up important data before making structural changes or writing operations.

> Oracle and Elasticsearch currently only keep their connection UI options; adapters are not implemented yet and are planned capabilities.

## Installation

Installers are published on the project's [Releases](https://github.com/lixinxins/QuillDB/releases) page:

- macOS: Apple Silicon DMG, ZIP
- Windows: x64 installer, x64 portable
- Linux: x86_64 AppImage, amd64 DEB

The HarmonyOS client build configuration is kept in `vite.harmony.config.ts` (outputs to `harmony-client/entry/...`); the client project is not distributed with this repository yet. Usage notes will be added once it is included.

On macOS, an unsigned development build may require right-clicking the app in Finder and choosing "Open" the first time. For public distribution, signing and notarization with an Apple Developer ID is recommended.

The current Windows build has no commercial code-signing certificate; SmartScreen may prompt on first run. Linux AppImage builds need execute permission granted after download.

## Local Development

### Requirements

- Node.js 20 or later
- Yarn 1.22.x

### Start the project

```bash
git clone https://github.com/lixinxins/QuillDB.git
cd QuillDB
yarn install
yarn dev
```

### Check and build

```bash
yarn typecheck
yarn build
```

### Generate installers

```bash
yarn dist:mac
yarn dist:win
yarn dist:linux
```

Installers are written to `release/` by default. Build on the corresponding OS or CI runner to avoid native dependency, code-signing, and architecture differences.

## Project Structure

```text
src/
├── main/       # Electron main process, database adapters, local storage, and IPC
├── preload/    # Secure renderer capability bridge
├── renderer/   # React user interface
└── shared/     # Types shared between main and renderer processes
resources/      # App icon and packaging resources
```

## Data & Privacy

- Connections, preferences, and saved queries are stored only on your machine.
- If you choose to save a password, it is encrypted with the OS secure storage via Electron `safeStorage`.
- SSH private keys and SSL certificates are stored only as local file paths; file contents are read by the Electron main process only when establishing a connection and are never passed to the page.
- QuillDB does not provide cloud sync and never uploads database content.
- Please do not expose real passwords, access tokens, or sensitive business data in issues, logs, or screenshots.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. When reporting a bug, include the OS, database type, reproduction steps, and any necessary sanitized logs.

## Roadmap

- Continue improving table structure design and object management across databases
- Extend more database adapters and engine-specific capabilities
- Improve execution plan visualization and performance analysis
- Add automated tests and three-platform CI builds
- Improve app signing, auto-update, and the formal release pipeline

## License

QuillDB is open-sourced under the [MIT License](LICENSE).

## Author & Contact

- Author: CodeAce
- QQ: `941697962`
- WeChat: scan the QR code below to add

<p>
  <img src="resources/codeace-wechat.jpg" width="300" alt="CodeAce WeChat QR code" />
</p>

---

# QuillDB（中文版）

<p align="center">面向开发者与数据库管理员的现代化、跨平台开源数据库工作台。</p>

## 项目介绍

QuillDB 基于 Electron、React 与 TypeScript 构建，面向 macOS、Windows 和 Linux。它将多数据库连接管理、对象浏览、SQL 编辑与执行、数据维护、导入导出、SSH/SFTP 和 AI 数据库助手整合在一个桌面工作台中，适合日常开发、数据排查与数据库运维。

目前内置 12 种数据库引擎连接能力，覆盖 MySQL、MariaDB、PostgreSQL、SQLite、SQL Server、TiDB、ClickHouse、MongoDB、Redis、DuckDB、达梦和人大金仓；Oracle 与 Elasticsearch 的连接选项已保留在界面中，适配器尚未实现，属规划中能力。仓库保留 HarmonyOS ArkWeb 构建配置，客户端工程暂未随仓库分发。

> 当前稳定版本为 `1.1.1`。欢迎提交 Issue、功能建议和 Pull Request。

## 界面预览

### 工作台

统一管理不同类型的数据库与 SSH 连接，通过分组、搜索和分层对象树快速进入数据库、Schema、数据表、查询及终端工作区。智能工作台集中展示连接状态、查询活动、数据规模和最近操作。

<p align="center">
  <img src="系统截图/首页截图.png" width="100%" alt="QuillDB 工作台" />
</p>

### SQL 查询与数据浏览

查询工作区支持 SQL 高亮与检查、运行选中或光标所在语句、执行计划、格式化、压缩和查询历史；结果区支持大结果集分批加载、复制、行内编辑与删除。数据表页面提供筛选、分页、字段设计和数据导入导出。

<table>
  <tr>
    <td width="50%"><img src="系统截图/查询页.png" alt="QuillDB SQL 查询页面" /></td>
    <td width="50%"><img src="系统截图/数表打开页.png" alt="QuillDB 数据表浏览页面" /></td>
  </tr>
  <tr>
    <td align="center">SQL 查询与结果集</td>
    <td align="center">数据表浏览与筛选</td>
  </tr>
</table>

### AI 数据库助手

在当前连接和数据库上下文中通过自然语言生成查询、分析 SQL 与数据库结构。读取操作可直接执行，写入及高风险操作仍需用户确认。

## 功能特性

- 统一管理 12 种数据库引擎以及独立 SSH 连接
- 数据库与 SSH 连接分组、搜索、排序、导入导出及环境标记
- SSH 隧道、交互式终端与 SFTP 文件管理，支持密码和私钥认证
- SSL/TLS 安全连接，支持 CA 及客户端证书配置
- 本地保存连接信息，密码通过 Electron `safeStorage` 加密
- 按引擎能力展示数据库、Schema、表、视图、字段、索引、外键、函数、存储过程和触发器等对象
- 完整的对象树右键菜单，支持展开收起、刷新、复制名称、创建、编辑、查询、维护和删除
- 多标签 SQL 编辑器，支持语法高亮、字段检查、清晰选区、复制以及仅执行选中的 SQL
- 执行计划、SQL 格式化与压缩、查询历史和已保存查询
- 大结果集游标分批加载、结果复制、可编辑结果集和错误定位
- 数据表创建、结构设计、重命名、复制、清空和删除
- 表数据查看、筛选、分页、字段编辑、记录新增与删除
- SQL、CSV、JSON 和 Excel 数据导入导出，支持预览、字段选择和进度反馈
- AI 数据库助手，可结合当前连接上下文生成、解释和分析 SQL
- 中文与英文界面
- 浅色与经典主题、可调整宽度和折叠的数据库侧栏
- macOS、Windows、Linux 安装包构建配置
- HarmonyOS ArkWeb 构建配置（客户端工程暂未随仓库分发）

## 支持的数据库

| 数据库类型 | 已内置引擎 |
| --- | --- |
| MySQL 生态 | MySQL、MariaDB、TiDB |
| PostgreSQL 生态 | PostgreSQL、人大金仓 |
| 商业关系型数据库 | SQL Server、达梦 |
| 嵌入式分析数据库 | SQLite、DuckDB |
| 分布式与 NoSQL | ClickHouse、MongoDB、Redis |

不同数据库的对象类型、DDL、结果编辑和维护能力存在差异，界面会根据引擎能力动态展示可用操作。执行结构变更或写入操作前，请先备份重要数据。

> Oracle 与 Elasticsearch 目前仅保留连接界面选项，适配器尚未实现，属规划中能力。

## 安装

安装包统一发布在项目的 [Releases](https://github.com/lixinxins/QuillDB/releases) 页面：

- macOS：Apple Silicon DMG、ZIP
- Windows：x64 安装版、x64 便携版
- Linux：x86_64 AppImage、amd64 DEB

HarmonyOS 客户端构建配置保留在 `vite.harmony.config.ts`（输出到 `harmony-client/entry/...`），客户端工程暂未随本仓库分发，待纳入后补充使用说明。

macOS 未签名的开发构建首次打开时，可能需要在 Finder 中右键应用并选择“打开”。面向公众分发时建议使用 Apple Developer ID 完成签名与公证。

Windows 当前构建未配置商业代码签名证书，首次运行时可能出现 SmartScreen 提示。Linux AppImage 下载后需要先授予执行权限。

## 本地开发

### 环境要求

- Node.js 20 或更高版本
- Yarn 1.22.x

### 启动项目

```bash
git clone https://github.com/lixinxins/QuillDB.git
cd QuillDB
yarn install
yarn dev
```

### 检查与构建

```bash
yarn typecheck
yarn build
```

### 生成安装包

```bash
yarn dist:mac
yarn dist:win
yarn dist:linux
```

安装包默认输出到 `release/`。建议在对应操作系统或 CI Runner 中分别构建，以避免原生依赖、代码签名和架构差异。

## 项目结构

```text
src/
├── main/       # Electron 主进程、数据库适配器、本地存储与 IPC
├── preload/    # 安全的渲染进程能力桥接
├── renderer/   # React 用户界面
└── shared/     # 主进程与渲染进程共享类型
resources/      # 应用图标与打包资源
```

## 数据与隐私

- 连接、偏好设置和保存的查询只保存在本机。
- 选择保存密码时，密码使用 Electron `safeStorage` 调用操作系统安全存储能力加密。
- SSH 私钥和 SSL 证书只保存本地文件路径，文件内容仅由 Electron 主进程在建立连接时读取，不传递给页面。
- QuillDB 不提供云端同步，也不会主动上传数据库内容。
- 请勿在 Issue、日志或截图中公开真实密码、访问令牌及敏感业务数据。

## 参与贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交 Bug 时请附上操作系统、数据库类型、复现步骤和必要的脱敏日志。

## 路线图

- 持续完善不同数据库的表结构设计与对象管理能力
- 扩展更多数据库适配器与引擎专属能力
- 完善执行计划可视化与性能分析
- 增加自动化测试和三平台 CI 构建
- 完善应用签名、自动更新及正式发布流程

## 许可证

QuillDB 使用 [MIT License](LICENSE) 开源。

## 作者与联系方式

- 作者：CodeAce
- QQ：`941697962`
- 微信：扫描下方二维码添加好友

<p>
  <img src="resources/codeace-wechat.jpg" width="300" alt="CodeAce 微信二维码" />
</p>
