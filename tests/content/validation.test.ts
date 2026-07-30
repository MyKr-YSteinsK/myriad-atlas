import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../scripts/content/parse-frontmatter'
import { validateSource } from '../../scripts/content/validate-source'

describe('content source contracts', () => {
  it('accepts the empty formal content library', async () => {
    const result = await validateSource()

    expect(result.nodes).toHaveLength(0)
    expect(result.routes).toHaveLength(0)
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
  })

  it('parses a frontmatter mapping and rejects duplicate YAML keys', () => {
    expect(parseFrontmatter('---\nid: example\n---\n正文').data).toEqual({ id: 'example' })
    expect(() => parseFrontmatter('---\nid: first\nid: second\n---\n正文')).toThrow(/Map keys must be unique/)
  })

  it('compiles every source schema in strict Draft 2020 mode', async () => {
    const directory = resolve(process.cwd(), 'schemas/source')
    const schemas = await Promise.all((await readdir(directory))
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => JSON.parse(await readFile(resolve(directory, file), 'utf8')) as object))
    const ajv = new Ajv2020({ allErrors: true, strict: true })

    for (const schema of schemas) expect(() => ajv.compile(schema)).not.toThrow()
  })
})
