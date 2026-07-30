# 项目地图

## 当前入口

- `src/main.tsx`：React 启动入口。
- `src/app/router.tsx`：Hash 路由入口。
- `src/app/App.tsx`：当前最小应用壳。
- `src/lib/base-path.ts`：项目子路径与节点 Hash URL 的唯一解析入口。
- `src/app/styles/global.css`：基础主题、字体、安全区域和减少动态效果样式。

## 内容源码与数据

- `src/content/`：正式 Markdown 知识节点源码（当前为空）。
- `src/data/taxonomy/taxonomy.yaml`：冻结 taxonomy 的显示结构。
- `src/data/routes/`：路线源码（当前为空）。
- `src/data/changelog/`：应用与知识版本日志。
- `public/media/`：内容媒体源码。
- `generated/imported-batches.json`：可提交的批次导入索引（当前为空）。
- `inbox/batches/`：本地待处理批次；`inbox/processed/` 与 `inbox/reports/`：本地处理结果和报告。

## 生成边界

- `public/_generated/`：运行时内容产物，构建生成且不提交。
- `dist/`：Vite 生产产物，构建生成且不提交。
- `generated/`：可提交的确定性派生文档与索引。

内容校验、Markdown 编译、catalog、路线、搜索、manifest、知识地图和阅读器数据层将在后续 Phase 落到对应真实入口后补充本地图；此处不将它们标为已实现。

## 命令

- `npm run dev`：启动本地 Vite 开发服务器。
- `npm run lint`、`npm run typecheck`、`npm run test -- --run`：基础质量检查。
- `npm run build`：构建站点；`npm run verify`：统一质量入口。

## 后续预留

完整 PWA/Workbox、搜索 UI、批次导入流程与完整本地状态交互尚未实现。
