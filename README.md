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

`npm run build` 会构建 PWA 应用外壳并注入 Service Worker；`npm run dev` 使用真实内容源（当前正式内容库为空）；`npm run dev:fixture` 使用 `tests/fixtures/valid-corpus` 验收非空界面和数据流。正常 `npm run build` 总会重新使用真实源覆盖 fixture。`npm run content:map` 会更新可提交的知识地图；`npm run preview` 用生产构建本地验收。站点地址为 [https://mykr-ysteinsk.github.io/myriad-atlas/](https://mykr-ysteinsk.github.io/myriad-atlas/)。

在 iPhone Safari 打开站点后，通过“分享 → 添加到主屏幕”安装。请从主屏幕 Web App 中主动开始“完整下载知识库”；应用关闭后不会承诺后台下载。个人备份仅包含阅读与个人状态，不包含可重新下载的正文、媒体或离线缓存。

内容源码、运行时生成边界和关键入口请见 [项目地图](docs/PROJECT_MAP.md)。

## 当前范围

已实现：严格内容契约与整体原子构建、正文 Pagefind 全文搜索、QA 索引、五项知识航图导航、路线进度、沉浸阅读、可安装 PWA、版本化完整离线知识下载与原子更新、完整性修复、Dexie v3、个人备份导出与整套替换恢复，以及 GitHub Pages 验证和部署工作流。

尚未实现：ZIP 知识批次导入、正式内容发布流程及云同步。
