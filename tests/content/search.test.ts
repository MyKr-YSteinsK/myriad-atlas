import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAllContent } from '../../scripts/content/build-all'
import { compileNodes, contentVersion } from '../../scripts/content/compile-node'
import { compileQaIndex } from '../../scripts/content/compile-qa-index'
import { createContentWorkspace, schemasRoot } from '../../scripts/content/config'
import { validateSource } from '../../scripts/content/validate-source'

const fixtureRoot = resolve(process.cwd(), 'tests/fixtures/valid-corpus')
const fixtureWorkspace = createContentWorkspace(fixtureRoot, schemasRoot)
const temporaryRoots: string[] = []
const execFileAsync = promisify(execFile)

describe('search and QA runtime artifacts', () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('builds Pagefind from title, summary, takeaways and plain body text', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'myriad-search-'))
    temporaryRoots.push(root)
    const publicDirectory = resolve(root, 'public')
    const targetRoot = resolve(publicDirectory, '_generated')
    await buildAllContent({ workspace: fixtureWorkspace, publicDirectory, targetRoot })
    expect(await readdir(resolve(targetRoot, 'pagefind'))).toContain('pagefind.js')

    const bundleUrl = `${pathToFileURL(resolve(targetRoot, 'pagefind')).href}/`
    const moduleUrl = pathToFileURL(resolve(targetRoot, 'pagefind/pagefind.js')).href
    const script = `
      import { readFile } from 'node:fs/promises';
      import { fileURLToPath } from 'node:url';
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith('file:')) return nativeFetch(input, init);
        const bytes = await readFile(fileURLToPath(url));
        return new Response(bytes, { headers: { 'content-type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
      };
      const pagefind = await import(${JSON.stringify(moduleUrl)});
      await pagefind.init({ baseUrl: '/myriad-atlas/', bundlePath: ${JSON.stringify(bundleUrl)} });
      const terms = ['NebulaNeedle', '普通知识一', '结构摘要', '理解 fixture 结构'];
      console.log(JSON.stringify(await Promise.all(terms.map(async term => (await pagefind.search(term)).results.length))));
    `
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script])
    expect(JSON.parse(stdout.trim())).toEqual(expect.arrayContaining([expect.any(Number)]))
    expect(JSON.parse(stdout.trim()).every((count: number) => count > 0)).toBe(true)
    const catalog = JSON.parse(await readFile(resolve(targetRoot, 'catalog.json'), 'utf8')) as { nodes: Array<Record<string, unknown>> }
    expect(catalog.nodes.some((node) => 'plain_text' in node)).toBe(false)
  })

  it('orders QA chains and answers by their linear parent relation', async () => {
    const validation = await validateSource(fixtureWorkspace)
    const version = await contentVersion(fixtureWorkspace)
    const nodes = await compileNodes(validation, version, fixtureWorkspace)
    const index = compileQaIndex([...nodes].reverse(), version)

    expect(index.chains.map((chain) => chain.chain_id)).toEqual(['qa-0001'])
    expect(index.chains[0].answers.map((answer) => answer.node_id)).toEqual(['qa-0001', 'qa-0002'])
  })
})
