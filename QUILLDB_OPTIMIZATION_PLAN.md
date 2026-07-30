# QuillDB 系统不足分析与优化方案

## 一、项目现状概述

QuillDB 是基于 Electron + React 19 + TypeScript 的跨平台数据库管理工具（v1.0.1），技术栈完整度良好，但存在明显的架构债务。

| 维度 | 当前状态 | 评级 |
|------|---------|------|
| 状态管理 | `useReducer` + Context API (单体) | C |
| 组件设计 | 多文件超 1000 行，职责混合 | D |
| 性能优化 | 仅基础 virtual scroll（表格） | C |
| 数据请求 | 裸 async/await + useState | D |
| 样式管理 | 全局 BEM CSS（无 scope） | C |
| 测试覆盖 | 0 测试文件 | F |
| 代码分割 | 仅 1 处 `React.lazy` | D |

---

## 二、核心不足与根因分析

### 2.1 状态管理严重过载 [P0]

**表现：** `WorkspaceContextValue` 导出约 70+ 个属性，所有消费者共享唯一 context 对象。其值在 `App.tsx` 由 10+ hooks 拼装：

```
useWorkspaceTabs() + useConnectionState() + useTableActions() + ... = ws 对象
→ ws 对象任意内部 state 变化 → 全部消费者 re-render
```

**影响：**
- 打开/关闭对话框时，连接侧边栏、编辑器、工具栏全部 re-render
- SQL 编辑器（CodeMirror 6 持有复杂 DOM）每字符输入触发全局 re-render
- tab 切换时页面可感知卡顿

---

### 2.2 Reducer 职责混合 [P0]

**表现：** `useWorkspaceTabsReducer.ts` (323 行) 管理 5 种 workspace + AI + 置顶 + 重命名，共 20 个 action type。

- `CLOSE_TAB_SET` 单 action 75 行（L217-L293），内含大量重复 fallback 逻辑
- 各 CLOSE_* action 的 fallback 策略不一致（有的用 `fallbackWorkspace`，有的硬编码优先级）
- 置顶状态通过外部 localStorage 管理，形成隐式副作用

---

### 2.3 组件体积失控 [P0]

| 文件 | 行数 | 主要问题 |
|------|------|------|
| `QueryWorkspace.tsx` | 1157+ | SQL 编辑 + 执行 + 数据编辑 + 历史 + 片段 + 图表 + CSV 导出 + 事务... |
| `App.tsx` | 大量 | 所有 hook 初始化 + Provider + 事件分发混在同一文件 |
| `useWorkspaceTabsReducer.ts` | 323 | 单 reducer 处理 5 种 workspace 类型的全部生命周期 |

---

### 2.4 数据请求层缺失 [P1]

当前模式（`useConnectionState.ts`）：

```ts
const [connections, setConnections] = useState<DatabaseConnection[]>([])
const [loading, setLoading] = useState(false)
// 每次操作后手动刷新整个列表
```

| 缺失能力 | 影响 |
|----------|------|
| 请求缓存（staleTime） | 每次切换数据库都重新请求 connection 列表 |
| 请求去重 | 并发相同请求会重复发送 IPC |
| 乐观更新 | 删除连接后需等全量刷新才更新 UI |
| 自动重试 | 网络/数据库错误无自动恢复 |
| 统一 Loading/Error | 每个 hook 自行管理，风格不统一 |

---

### 2.5 性能劣化点 [P1-P2]

| 问题 | 位置 | 影响 |
|------|------|------|
| Context 全局 re-render | AppContext | 高频操作全部触发全局 re-render |
| 无 React.memo 保护 | 通用 | 父组件更新导致子组件不必要渲染 |
| 虚拟滚动仅用于表格 | 连接列表/表列表/查询历史 | 大量连接时侧边栏卡顿 |
| `visibleWorkspaceTabs` 每次计算 | useWorkspaceTabs.ts | 切片操作依赖全部 tabs 数组 |
| 无 ErrorBoundary | 全局 | 组件渲染失败直接白屏 |
| 无 Suspense | 全局 | 懒加载无 fallback UI |

---

### 2.6 其他工程问题

| 问题 | 严重度 |
|------|--------|
| 零测试（无 Vitest/Jest 配置） | P1 |
| React 依赖在 devDependencies（应为 dependencies） | P2 |
| `null!` 断言用于 Context 默认值 | P2 |
| 部分 useEffect 禁用 exhaustive-deps 规则 | P3 |
| 全局 CSS 无 scope / 无 CSS Modules | P2 |

---

## 三、优化方案

### 阶段一：紧急修复（Week 1-2）

#### 3.1 引入 Zustand 替代单体 Context

**从单一 WorkspaceContext 迁移到独立 domain stores：**

```
zustand stores/
├── useConnectionStore   → 连接 CRUD + 状态
├── useWorkspaceStore    → 标签页生命周期 + 工作区切换
├── useDialogStore       → 对话框可见性
├── useEditorStore       → SQL 编辑器状态（每个 tab keyed）
└── useUIStore           → 侧边栏/主题/布局
```

**示例 — 组件精准订阅：**

```tsx
// 只订阅所需的 slice，避免全局 re-render
function ConnectionSidebar() {
  const connections = useConnectionStore(s => s.connections)
  const isLoading = useConnectionStore(s => s.isLoading)
  const toggleConnection = useConnectionStore(s => s.toggleConnection)
  // 不受 dialog/editor store 变化影响
  return ...
}
```

**收益：** 减少 70-80% 非必要 re-render

#### 3.2 添加 ErrorBoundary + Suspense

```tsx
// 全局错误兜底
<AppErrorBoundary fallback={<ErrorFallback />}>
  <Suspense fallback={<AppSkeleton />}>
    <App />
  </Suspense>
</AppErrorBoundary>
```

---

### 阶段二：架构重构（Week 3-4）

#### 3.3 Reducer 拆分 — 每个 workspace 类型独立 slice

```
Before:                                After:
useWorkspaceTabsReducer.ts (323 lines)   stores/tabs/
  handles ALL tab types                  ├── querySlice.ts       (QUERY actions)
                                         ├── databaseSlice.ts    (DATABASE actions)
                                         ├── tableDataSlice.ts   (DATA actions)
                                         ├── tableDesignerSlice.ts (TABLES actions)
                                         └── terminalSlice.ts    (TERMINAL actions)
                                         
                                         useWorkspaceStore.ts    (协调层：activeWorkspace + tab order)
```

**统一 close fallback 策略 — 消除重复逻辑：**

```ts
// 所有 CLOSE_* action 共享此 helper
function closeAndFallback<T extends { id: string }>(
  items: T[], activeId: string | null, closingId: string,
  fallbacks: FallbackFn[]
): CloseResult<T> {
  const remaining = items.filter(t => t.id !== closingId)
  if (activeId !== closingId) return { items: remaining, activeId }

  const adjacent = remaining[findAdjacentIndex(items, closingId)]
  if (adjacent) return { items: remaining, activeId: adjacent.id }

  // 尝试 fallback
  for (const fn of fallbacks) {
    const result = fn()
    if (result) return { items: remaining, activeId: null, fallback: result }
  }
  return { items: remaining, activeId: null }
}
```

#### 3.4 QueryWorkspace 组件拆分（1157 → <300 lines/ea）

```
components/query/
├── QueryWorkspace.tsx            主壳 (~80 lines)
├── SqlEditorPanel.tsx            CodeMirror 6 封装 (~100 lines)
├── ResultPanel.tsx               结果集展示 (~150 lines)
├── QueryToolbar.tsx              执行/格式化/导出 (~80 lines)
├── QueryHistoryDrawer.tsx        历史记录 (~100 lines)
├── SavedQueriesPanel.tsx         保存的查询 (~100 lines)
├── CellEditor.tsx                单元格编辑弹窗 (~80 lines)
├── ExportDialog.tsx              导出对话框 (~80 lines)
└── hooks/
    ├── useQueryExecution.ts      执行 + abort signal
    ├── useQueryHistory.ts        历史 CRUD
    ├── useSavedQueries.ts        保存查询 CRUD
    ├── useCellEditing.ts         单元格编辑状态
    └── useDataExport.ts          CSV/Excel 导出
```

---

### 阶段三：数据层升级（Week 5-6）

#### 3.5 引入 TanStack Query 管理服务端状态

```ts
// hooks/use-connections.ts
export function useConnections() {
  return useQuery({
    queryKey: ['connections'],
    queryFn: () => window.omnidb.connections.list(),
    staleTime: 30_000,
  })
}

// 乐观更新 — 连接开关
export function useToggleConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (conn) => conn.open
      ? window.omnidb.connections.close(conn.id)
      : window.omnidb.connections.open(conn.id),
    onMutate: (conn) => {
      // 立即更新 UI，不等 serer 返回
      queryClient.setQueryData(['connections'], (old) =>
        old.map(c => c.id === conn.id ? { ...c, open: !conn.open } : c)
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['connections'] })
  })
}
```

---

### 阶段四：React 19 新特性 + 性能精调（Week 7-8）

#### 3.6 React 19 特性利用

| 特性 | 场景 | 收益 |
|------|------|------|
| `useOptimistic` | 标签页切换 / 连接开关 | 即时 UI 反馈，无需等待异步 |
| `useActionState` | 连接创建/编辑表单 | 内置 loading + error 状态 |
| `ref` 作为 prop | DOM ref 传递 | 减少 forwardRef 样板 |

```tsx
// useOptimistic — 标签页切换
const [optimisticTab, setTab] = useOptimistic(activeId, (_, newId) => newId)

const handleSwitch = (id: string) => {
  startTransition(() => {
    setTab(id)  // 立即更新 UI
    switchTab(id)  // 异步执行
  })
}
```

#### 3.7 渲染优化

```tsx
// 1. memo 保护纯展示组件
const ConnectionItem = React.memo(function ConnectionItem({ conn }: Props) { ... })

// 2. useDeferredValue 延迟过滤计算
const deferredFilter = useDeferredValue(filterText)
const filtered = useMemo(() => list.filter(...), [list, deferredFilter])

// 3. 虚拟滚动扩展至连接列表 / 查询历史
```

---

### 阶段五：工程质量提升（Week 9+）

| 项目 | 方案 |
|------|------|
| 测试 | Vitest + React Testing Library（store 测试 + 组件测试） |
| E2E | Playwright（核心流程：连接 → 查询 → 导出） |
| CSS | CSS Modules 渐进迁移，主题系统用 CSS 变量驱动 |
| 类型安全 | 移除 `null!` 断言，改为 undefined 检查 + 类型守卫 |
| 性能监控 | `React.Profiler` + 自定义 perf 日志 |

---

## 四、实施路线图

```
Week 1-2   ████████░░░░░░░░░░░░░░  Zustand 迁移 + ErrorBoundary + Suspense
Week 3-4   ████████████░░░░░░░░░░  Reducer 拆分 + QueryWorkspace 分解
Week 5-6   ████████████████░░░░░░  TanStack Query 集成 + 虚拟滚动扩展
Week 7-8   ████████████████████░░  React 19 特性 + 性能精调
Week 9+    ██████████████████████  Vitest 测试 + CSS Modules + E2E
```

## 五、预期收益

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 标签页切换延迟 | ~200ms | ~50ms | 4x |
| SQL 输入响应 | 感知延迟 | 实时 | 显著 |
| 最大单文件行数 | 1157 | <300 | 74% ↓ |
| 非必要 re-render | 全局 | 精准订阅 | 80% ↓ |
| 代码可测试性 | 不可测 | 单元 + 组件 | ∞ |
| 组件职责清晰度 | 模糊 | 单一职责 | 质的飞跃 |

---

## 六、风险提示

1. **Zustand 迁移**：建议新 store 旁路运行做 A/B 对比后切换
2. **TanStack Query**：注意 staleTime/cacheTime 配置与 IPC 协议匹配
3. **大文件拆分**：按 workspace 类型分 PR 逐步合并，避免破坏性改动
4. **IPC 通信**：修改前后端数据通道需保持协议一致
5. **React 19 兼容**：确保第三方依赖（CodeMirror 6、xterm.js）与新特性兼容
