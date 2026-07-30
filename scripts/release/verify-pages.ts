const argument = (name: string): string | undefined => process.argv.slice(2).find((value, index, all) => all[index - 1] === name)
async function main(): Promise<void> {
  const base = argument('--url') ?? 'https://mykr-ysteinsk.github.io/myriad-atlas'; const appVersion = argument('--app-version'); const contentVersion = argument('--content-version')
  if (!appVersion || !contentVersion) throw new Error('需要 --app-version 与 --content-version')
  for (const path of ['/', '/manifest.webmanifest', '/sw.js', '/_generated/app-changelog.json', '/_generated/knowledge-changelog.json', '/_generated/content-manifest.json', '/_generated/catalog.json', '/_generated/knowledge-map.json']) {
    const response = await fetch(`${base}${path}`); if (!response.ok) throw new Error(`Pages 文件不可用：${path}`)
    const text = await response.text(); if (path.includes('app-changelog') && !text.includes(appVersion) || path.includes('knowledge-changelog') && !text.includes(contentVersion)) throw new Error(`Pages 版本不匹配：${path}`)
  }
  console.log('Pages 单次校验通过。')
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
