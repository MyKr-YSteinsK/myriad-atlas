import type { RuntimeNode } from '../../../content/types'

export const previewNode: RuntimeNode = {
  schema_version: 1,
  content_version: 'preview',
  id: 'reader-preview',
  title: '阅读器长文验收样本',
  domain_id: 'knowledge-roaming',
  domain_name: '知识漫游',
  course_id: 'knowledge-roaming-pool',
  course_name: '知识漫游池',
  summary: 'READER_PREVIEW_ONLY：用于验收排版、目录、表格、代码和阅读设置的开发专用样本。',
  takeaways: ['正文优先，设置不打断阅读。', '表格和代码在窄屏中保持可读。'],
  tags: ['preview'],
  prerequisites: ['missing-preview-prerequisite'],
  related: ['missing-preview-related'],
  self_check: [{ question: '为什么答案默认折叠？', answer_html: '<p>让读者先独立思考，再按需展开参考答案。</p>' }],
  body_html: '<p>这是一段足够长的中英文混排正文。Myriad Atlas keeps long-form reading calm, legible and selectable on small screens.</p><h2 id="preview-structure">层级与列表</h2><p>长 URL 不应撑破视口：https://example.com/a-very-long-path-that-keeps-going-with-readable-fallback-behavior-for-mobile-readers</p><ul><li>第一项</li><li>第二项</li></ul><blockquote><p>引用内容保持自然节奏。</p></blockquote><h3 id="preview-code">代码与表格</h3><pre><code class="language-ts">const reader = { stable: true, selectable: true }</code></pre><div tabindex="0"><table><thead><tr><th>项目</th><th>说明</th></tr></thead><tbody><tr><td>字体</td><td>系统或中文衬线</td></tr><tr><td>进度</td><td>节流保存</td></tr></tbody></table></div><h2 id="preview-ending">收束</h2><p>此样本不会进入正式 catalog、Pagefind 或知识地图。</p>',
  toc: [{ id: 'preview-structure', depth: 2, text: '层级与列表' }, { id: 'preview-code', depth: 3, text: '代码与表格' }, { id: 'preview-ending', depth: 2, text: '收束' }],
  plain_text: '阅读器验收样本',
  media: [],
  source_path: 'src/app/reader/dev/fixture.ts',
  sequence: 1,
}
