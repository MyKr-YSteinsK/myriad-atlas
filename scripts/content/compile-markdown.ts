import GithubSlugger from 'github-slugger'
import { toString } from 'mdast-util-to-string'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { Root as HastRoot } from 'hast'
import type { Schema } from 'hast-util-sanitize'
import { PROJECT_BASE_PATH } from './config'

export interface TocEntry { id: string; depth: number; text: string }
export interface CompiledMarkdown { html: string; toc: TocEntry[]; plainText: string; media: string[] }

function assetPath(path: string): string {
  return `${PROJECT_BASE_PATH.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function markdownSafety(toc: TocEntry[], media: string[]) {
  const slugger = new GithubSlugger()
  return (tree: Root): void => {
    visit(tree, (node) => {
      if (node.type === 'html') throw new Error('Raw HTML is forbidden in source Markdown')
      if (node.type === 'heading') {
        if (node.depth === 1) throw new Error('Node Markdown must not contain H1')
        const text = toString(node).trim()
        const id = slugger.slug(text)
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } }
        toc.push({ id, depth: node.depth, text })
      }
      if (node.type === 'image') {
        if (!node.alt?.trim() || !node.url.startsWith('/media/') || node.url.includes('..')) {
          throw new Error('Images require alt text and a safe /media/ path')
        }
        const rewritten = assetPath(node.url)
        node.url = rewritten
        media.push(rewritten)
      }
      if (node.type === 'link' && /^(?:javascript|data):/i.test(node.url)) {
        throw new Error('Unsafe link protocol')
      }
    })
  }
}

function externalLinkSafety() {
  return (tree: HastRoot): void => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return
      const href = typeof node.properties.href === 'string' ? node.properties.href : ''
      if (/^https?:\/\//i.test(href)) {
        node.properties.target = '_blank'
        node.properties.rel = ['noopener', 'noreferrer']
      }
    })
  }
}

export async function compileMarkdown(markdown: string): Promise<CompiledMarkdown> {
  const toc: TocEntry[] = []
  const media: string[] = []
  const schema = {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      '*': [...(defaultSchema.attributes?.['*'] ?? []), 'id'],
      code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    },
  } as unknown as Schema
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(markdownSafety, toc, media)
    .use(remarkRehype)
    .use(externalLinkSafety)
    .use(rehypeSanitize, schema)
    .use(rehypeStringify)
  const tree = processor.parse(markdown) as Root
  const plainText = toString(tree).trim()
  const output = await processor.run(tree)
  return { html: String(processor.stringify(output)), toc, plainText, media: [...new Set(media)] }
}

export async function compileAnswerMarkdown(markdown: string): Promise<string> {
  const compiled = await compileMarkdown(markdown)
  return compiled.html
}
