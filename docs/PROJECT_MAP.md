# 项目地图

## 应用

- `src/main.tsx`：React 启动入口；`src/app/router.tsx`：HashRouter。
- `src/app/App.tsx` 与 `src/app/pages/`：空库、节点加载、错误边界和路由页面。
- `src/lib/base-path.ts`：项目子路径与 Hash URL 的唯一解析入口；`src/lib/content-client.ts`：运行时 catalog 与节点 JSON 客户端。
- `src/app/reader/`：沉浸阅读器、设置面板及仅开发环境的长文样本；`src/app/state/reader-db.ts`：Dexie `myriad-atlas` 数据库、阅读设置和位置。
- `src/app/styles/global.css`：主题 token、safe area、减少动态效果与阅读排版。

## 内容源与契约

- `src/content/`：正式 Markdown 节点（当前为空）。
- `src/data/taxonomy/`、`src/data/routes/`、`src/data/changelog/`：taxonomy、路线和版本日志；`public/media/`：内容媒体。
- `schemas/source/`：前台内容、taxonomy、路线和日志 Schema；`schemas/runtime/`：节点、catalog、taxonomy、路线和 manifest Schema。
- `scripts/content/validate-source.ts`：联合校验入口；`compile-markdown.ts` 与 `compile-node.ts`：安全 HTML 和单节点 JSON 编译。

## 生成数据流

`src/content` / `src/data` → 联合校验 → 节点 JSON → taxonomy、catalog、路线 → Pagefind 或空库搜索状态 → manifest。

- `scripts/content/build-all.ts`：运行时产物总构建。
- `public/_generated/`：运行时 JSON 和 Pagefind，构建生成且不提交。
- `scripts/content/build-knowledge-map.ts` → `generated/knowledge-map.md`：可提交的确定性知识地图。
- `generated/imported-batches.json`：可提交的空批次索引；`inbox/`：本地批次与报告目录。
- `dist/`：Vite 部署产物，不提交。

## 命令与部署

- `npm run content:validate`：只读验证源内容。
- `npm run content:build`：生成运行时内容产物；`npm run content:map` / `content:map:check`：更新或检查知识地图。
- `npm run lint`、`npm run typecheck`、`npm run test -- --run`、`npm run build`、`npm run verify`：质量与生产构建入口。
- `.github/workflows/pages.yml`：在 `main` 验证并将 `dist/` 部署至 GitHub Pages。

## 后续预留

完整 PWA/Workbox、搜索 UI、路线 UI 与进度、完整本地状态交互及批次导入尚未实现。
