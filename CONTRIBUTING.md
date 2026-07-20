# 参与贡献

感谢你对 OrbiSQL 的关注。Bug 修复、数据库适配、交互改进、文档完善和测试补充都非常欢迎。

## 开始之前

1. 搜索现有 Issue，确认问题或建议尚未被讨论。
2. 对较大的功能改动，请先创建 Issue 说明目标、使用场景和实现思路。
3. 不要在代码、日志、截图或测试数据中提交密码、令牌及真实业务数据。

## 开发流程

```bash
git clone https://github.com/lixinxins/OrbiSQL.git
cd OrbiSQL
yarn install
yarn dev
```

提交前请至少运行：

```bash
yarn typecheck
yarn build
```

## Pull Request

- 一个 Pull Request 尽量只解决一个主题。
- 清楚说明修改内容、原因、影响范围及验证方式。
- UI 改动请提供修改前后的截图。
- 数据库相关改动请标明验证过的数据库类型和版本。
- 不要提交 `node_modules/`、`out/`、`release/`、本地数据库或编辑器配置。

## 代码约定

- 使用 TypeScript，保持现有代码结构和命名风格。
- 数据库差异应放在主进程服务或适配器中处理，避免在组件中散布方言判断。
- 所有用户输入的 SQL 标识符和参数都需要安全处理。
- 新增用户可见文案时，同时补充中英文界面翻译。
