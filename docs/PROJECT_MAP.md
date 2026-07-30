# 项目地图

## 应用

- `src/main.tsx`：React 启动入口；`src/app/router.tsx`：HashRouter。
- `src/app/App.tsx`、`layout/` 与 `pages/`：五项导航、首页、路线、知识库、搜索、漫游、“我的”和节点路由。
- `src/lib/base-path.ts`：项目子路径与 Hash URL 的唯一解析入口；`src/lib/content-client.ts` / `search-repository.ts`：可失效重载的 ContentRepository 与 Pagefind SearchRepository。
- `src/app/reader/`：沉浸阅读器、设置面板、阅读设置生命周期 flush 及仅开发环境的长文样本；`src/app/state/reader-db.ts`：保留 v1 / v2 迁移链的 Dexie v3 数据库，包含个人状态、离线任务/文件和应用元数据表。
- `src/app/state/local-state.ts`：节点状态、路线位置、问题草稿、待删除、意见、阅读设置和应用偏好的唯一写入服务；个人写入统一维护备份 mutation count，同标签页 revision 订阅不跟踪下载进度。
- `src/pwa/`：可安装外壳、Service Worker 注册/更新生命周期、安装指引、Cache Storage 活动版本指针与 Dexie UI 镜像协调。离线内容的活动版本始终以 Cache Storage pointer 为准。
- `src/app/data/route-progress.ts`：路线进度与继续算法；`question-chains.ts`：QA ID、原子问题链创建、绑定和生成请求；`roaming.ts`：漫游池与安全随机。
- `src/app/styles/global.css`：主题 token、safe area、减少动态效果与阅读排版。

## 内容源与契约

- `src/content/`：正式 Markdown 节点（当前为空）。
- `src/data/taxonomy/`、`src/data/routes/`、`src/data/changelog/`：taxonomy、路线和版本日志；`public/media/`：内容媒体。
- `schemas/source/`：前台内容、taxonomy、路线和日志 Schema；`schemas/runtime/`：节点、catalog、taxonomy、路线和 manifest Schema。
- `scripts/content/validate-source.ts`：接受显式内容工作区的联合校验入口；`compile-markdown.ts` 与 `compile-node.ts`：安全 HTML 和单节点 JSON 编译。
- `tests/fixtures/valid-corpus/` 与 `tests/fixtures/invalid/`：不进入正式构建的非空语料和高风险契约矩阵。

## 生成数据流

`src/content` / `src/data` → 联合校验 → staging 中的节点、taxonomy、catalog、路线、QA 索引 → Pagefind 或空库搜索状态 → manifest 校验 → `_generated` 整体切换。

- `scripts/content/build-all.ts`：运行时产物总构建。
- `public/_generated/`：运行时 JSON 和 Pagefind，构建生成且不提交。
- `public/_generated/qa-index.json`：线性正式问题链索引；`npm run content:fixture` / `dev:fixture`：仅从测试语料生成本地非空运行时数据。
- `scripts/content/build-knowledge-map.ts` → `generated/knowledge-map.md`：可提交的确定性知识地图。
- `generated/imported-batches.json`：可提交的空批次索引；`inbox/`：本地批次与报告目录。
- `dist/`：Vite 部署产物，不提交；`npm run build` 同时注入 `dist/sw.js` 的应用外壳预缓存，运行时知识内容不进入该预缓存。

## 命令与部署

- `npm run content:validate`：只读验证源内容。
- `npm run content:build`：生成运行时内容产物；`npm run content:map` / `content:map:check`：更新或检查知识地图。
- `npm run content:fixture` / `npm run dev:fixture`：从隔离 fixture 构建非空开发数据；正常 build 会恢复真实空库。
- `npm run lint`、`npm run typecheck`、`npm run test -- --run`、`npm run build`、`npm run verify`：质量与生产构建入口。
- `.github/workflows/pages.yml`：在 `main` 验证并将 `dist/` 部署至 GitHub Pages。

## 后续预留

完整知识离线下载、备份恢复与 ZIP 批次导入尚未实现。
