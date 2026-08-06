# QuillDB 优化方案（历史存档）

> **状态：已存档。** 本文撰写于 1.0.1 之前的旧架构（useReducer + 单体 Context）时期，其中提出的改造项已在 1.0.1 中完成，或已被新方案取代。当前优化方向请见 [docs/整体优化方案-2026-08-06.md](docs/整体优化方案-2026-08-06.md)。
>
> 本文历史内容保存在 Git 历史中（`0bd0702` 之前的提交），以下仅保留完成情况对照，避免误导后续读者。

## 已完成改造对照

| 原方案条目 | 完成状态 | 当前实现位置 |
| --- | --- | --- |
| 引入 Zustand 替代单体 Context | ✅ 已完成 | `src/renderer/src/stores/`，按领域拆分多 store |
| 添加 ErrorBoundary + Suspense | ✅ 已完成 | `src/renderer/src/main.tsx` |
| Reducer 按 workspace 类型拆分 | ✅ 已完成 | `src/renderer/src/stores/tabs/` |
| QueryWorkspace 组件拆分 | ✅ 已完成 | `src/renderer/src/components/query/` |
| 结果集虚拟滚动 | ✅ 已完成 | `@tanstack/react-virtual` |
| Worker 线程隔离 | ✅ 已完成 | `db-query-worker` / `sqlite-worker` + `WorkerProxy` |
| 大结果集游标分页 | ✅ 已完成 | `query-cursor-manager.ts` |
| 引入 TanStack Query | ➖ 已取消 | 基于 Zustand store 封装统一请求流程即可 |
| CSS Modules 迁移 | ⏳ 未开始 | 保持全局 CSS 变量体系，按需评估 |
| Vitest / E2E / CI 建设 | ⏳ 未开始 | 见新方案 P3 |

## 参考

- 新整体优化方案：[docs/整体优化方案-2026-08-06.md](docs/整体优化方案-2026-08-06.md)
- 左侧对象树优化方案：[docs/左侧对象树全节点优化方案.md](docs/左侧对象树全节点优化方案.md)
