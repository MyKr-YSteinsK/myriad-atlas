# 万象回廊 · MyKr 仓库约束

## 项目边界

- 正式名称为“万象回廊 · MyKr”（英文：Myriad Atlas · MyKr）；`MyKr` 始终后置。
- 在 Windows 和 PowerShell 中开发；iPhone Safari 是首要阅读客户端。
- 站点是 GitHub Pages 项目站点，固定基础路径为 `/myriad-atlas/`，应用使用 Hash 路由。
- 技术方向固定为 React、TypeScript、Vite、Dexie、Ajv、unified、Pagefind 与后续 Workbox `injectManifest`。不要在没有明确决策时替换技术栈或加入大型依赖。

## 内容与数据

- 永久节点 ID、taxonomy ID、route ID、route code 及特殊课程四位序号不得修改、复用或重新分配。
- 不得自行新建领域、课程或正式知识节点；Schema 变更必须是明确的产品决策。
- 内容契约、解析、引用、迁移、状态、生产构建与关键流程优先于非关键 UI 测试。
- `completed` 与 `unknown` 可以并存；路线进度只计算 `core` 与 `anchor`，不计算 `optional`。
- `uninterested` 只作为本地待删除语义；QA chain 必须线性，预留 ID 删除或隐藏后也不得复用。
- `tests/fixtures/` 不得进入正式内容、知识地图或生产构建；Dexie 升级必须保留旧版本声明并通过事务迁移，禁止清库重建。
- Workbox 应用预缓存与版本化知识缓存必须分离；Cache Storage active pointer 是知识读取的唯一版本来源，active 缺文件不得回退网络。
- 下载、知识更新与恢复必须先验证完整候选再切换；Service Worker 不自动 skip waiting，iPhone 主屏幕 Web App 不承诺后台下载。
- 个人备份只包含不可重新下载的个人数据，不得包含正文、媒体、搜索索引、Cache Storage 或离线任务；恢复和清除个人数据不得清理 active 知识缓存。
- `inbox/authoring/` 是永不提交的本地草稿区；`content:new` 与 `batch:create` 只能准备草稿、ZIP 和 dry-run，不得 apply、commit 或 push。删除、移动和 QA ID 分配必须继续使用显式的高级工作流，禁止由通用作者工具推断。

## 实施与 Git

- Plan 是临时只读执行输入：不得编辑、删除、重命名或提交。
- 每个明确 Phase 在通过其验证后独立提交；Codex 不得 push。
- 禁止 force push、改写历史、`git reset --hard` 与覆盖用户未提交文件。
- 工作区来源不明、分支或远端不安全、需要更改基础路径或 BrowserRouter、Schema 或持久化假设冲突、测试无法可靠定位失败原因时，停止并报告。

## 阅读体验与可访问性

- 正文阅读优先，正文中不得放置持续动效、状态操作或推荐浮层。
- 触摸目标约 44×44 CSS px，必须有可见焦点、语义标签与 safe area 处理；不使用 emoji 作为正式图标。
- 支持系统减少动态效果，避免无意义渐变、毛玻璃、发光和卡片墙。

## 文档与验证

- 仅在公共用法、架构、数据、配置、部署或安全假设变化时更新永久文档。
- 常用验证命令：`npm run content:validate`、`npm run content:map:check`、`npm run lint`、`npm run typecheck`、`npm run test -- --run`、`npm run build`、`npm run verify`。
- 报告应说明变更文件、实际验证结果、commit SHA、已知限制与仍需的手动验收。
