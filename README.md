# 万象回廊 · MyKr

**Myriad Atlas · MyKr**

面向个人知识管理与沉浸阅读的静态站点。它将严格校验 Markdown 知识节点，编译为安全的运行时 JSON，并提供适合移动端长文阅读的基础阅读器。

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

`npm run dev` 使用真实内容源（当前正式内容库为空）；`npm run dev:fixture` 使用 `tests/fixtures/valid-corpus` 验收非空界面和数据流。正常 `npm run build` 总会重新使用真实源覆盖 fixture。`npm run content:map` 会更新可提交的知识地图；`npm run preview` 用生产构建本地验收。站点地址为 [https://mykr-ysteinsk.github.io/myriad-atlas/](https://mykr-ysteinsk.github.io/myriad-atlas/)。

内容源码、运行时生成边界和关键入口请见 [项目地图](docs/PROJECT_MAP.md)。

## 当前范围

已实现：严格内容契约与整体原子构建、正文 Pagefind 全文搜索、QA 索引、五项知识航图导航、首页继续入口、路线进度、领域/课程浏览、随机漫游、完成/收藏/不会/不感兴趣状态、线性问题链、“我的”汇总、Dexie v2 迁移、沉浸阅读，以及 GitHub Pages 验证和部署工作流。

尚未实现：完整 PWA/离线更新、个人备份恢复、ZIP 知识批次导入及云同步。
