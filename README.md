# 万象回廊 · MyKr

**Myriad Atlas · MyKr**

面向个人知识管理与沉浸阅读的静态站点。它将严格校验 Markdown 知识节点，编译为安全的运行时 JSON，并提供适合移动端长文阅读、可安装 PWA 与完整离线知识库。

## 开发

```powershell
npm ci
npm run dev
npm run dev:fixture
npm run content:validate
npm run content:map:check
npm run test -- --run
npm run build
npm run verify
```

`npm run build` 会构建 PWA 应用外壳并注入 Service Worker；`npm run dev` 使用真实内容源；`npm run dev:fixture` 使用 `tests/fixtures/valid-corpus` 验收隔离的非空界面和数据流。正常 `npm run build` 总会重新使用真实源覆盖 fixture。`npm run content:map` 会更新可提交的知识地图；`npm run preview` 用生产构建本地验收。站点地址为 [https://mykr-ysteinsk.github.io/myriad-atlas/](https://mykr-ysteinsk.github.io/myriad-atlas/)。

在 iPhone Safari 打开站点后，通过“分享 → 添加到主屏幕”安装。请从主屏幕 Web App 中主动开始“完整下载知识库”；应用关闭后不会承诺后台下载。个人备份仅包含阅读与个人状态，不包含可重新下载的正文、媒体或离线缓存。

应用外壳与 Knowledge snapshot 独立版本化：应用更新不会要求知识版本同步升级。应用版本日志属于外壳预缓存；知识正文、媒体和搜索索引属于版本化知识快照。“重新下载”始终先创建并验证 staged candidate，不会原地覆盖 active 缓存；同一知识版本若出现真正的核心 fingerprint 变化，会被视为发布异常而拒绝覆盖。

日常内容生产先在本地 `inbox/authoring/` 草稿区完成；它永不提交。`content:new` 只生成带 TODO 的结构骨架，`batch:create` 只创建 ZIP 并执行 dry-run，删除、移动和 QA 继续使用高级流程：

```powershell
npm run content:new
# 编辑 inbox/authoring/... 中草稿
npm run batch:create -- --source inbox/authoring/<batch-id> --batch-id <batch-id> --target-version <YYYY.MM.DD-NN> --released-on <YYYY-MM-DD> --summary "..."
npm run update-knowledge -- --apply --confirm "<token>"
```

正式 apply 默认只做 dry-run；将 ZIP 放入 `inbox/batches` 后运行：

```powershell
npm run update-knowledge
npm run update-knowledge -- --apply --confirm "<token>"
npm run release:prepare
npm run release:check
```

apply 不会自动 commit 或 push；processed ZIP 与报告只保留在本地。由用户确认后再执行 `git push origin main`，不要 force push。

内容源码、运行时生成边界和关键入口请见 [项目地图](docs/PROJECT_MAP.md)。

## 当前范围

已实现：本地作者草稿到安全 ZIP / dry-run 工作流、显式确认 apply、可回滚文件事务、永久 tombstone、多运行时产物 join 的知识航图与移动端轨道布局、离线更新与高级诊断、个人备份恢复、低频路由懒加载及本地发布门禁。
