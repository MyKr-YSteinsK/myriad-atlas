import { describe, expect, it } from 'vitest'
import { compileMarkdown } from '../../scripts/content/compile-markdown'

describe('Markdown compilation', () => {
  it('creates stable heading IDs, GFM HTML, plain text and safe media URLs', async () => {
    const result = await compileMarkdown('## 同名\n\n- [x] 完成\n\n## 同名\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst ok = true\n```\n\n![说明](/media/example.png)')

    expect(result.toc).toEqual([{ id: '同名', depth: 2, text: '同名' }, { id: '同名-1', depth: 2, text: '同名' }])
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('language-ts')
    expect(result.media).toEqual(['/myriad-atlas/media/example.png'])
    expect(result.plainText).toContain('const ok = true')
  })

  it('rejects raw HTML and unsafe URL protocols', async () => {
    await expect(compileMarkdown('<script>alert(1)</script>')).rejects.toThrow(/Raw HTML/)
    await expect(compileMarkdown('[bad](javascript:alert(1))')).rejects.toThrow(/Unsafe link/)
  })
})
