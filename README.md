# 万象回廊 · MyKr

**Myriad Atlas · MyKr**

面向个人知识管理与沉浸阅读的静态站点。它将严格校验 Markdown 知识节点，编译为安全的运行时 JSON，并提供适合移动端长文阅读的基础阅读器。

## 开发

```powershell
npm ci
npm run dev
npm run content:validate
npm run content:map:check
npm run test -- --run
npm run build
npm run verify
```

`npm run content:map` 会更新可提交的知识地图；`npm run preview` 用生产构建本地验收。站点地址为 [https://mykr-ysteinsk.github.io/myriad-atlas/](https://mykr-ysteinsk.github.io/myriad-atlas/)。

内容源码、运行时生成边界和关键入口请见 [项目地图](docs/PROJECT_MAP.md)。

## 当前范围

已实现：空内容库可构建、内容契约校验、节点编译、catalog/manifest/Pagefind 生成、Hash 路由应用壳、阅读设置与阅读进度持久化，以及 GitHub Pages 验证和部署工作流。

尚未实现：完整 PWA/离线更新、搜索 UI、路线导航与进度、完成/收藏/不会状态交互、批次导入及云同步。
