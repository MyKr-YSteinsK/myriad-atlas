import { dryRunKnowledgeUpdate } from './dry-run'
import { applyKnowledgeUpdate } from './apply-knowledge'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--status')) { const report = await dryRunKnowledgeUpdate(); console.log(report ? `待确认：${report.confirmation_token}` : '没有待处理批次'); return }
  if (args.includes('--recover')) throw new Error('recover 仅处理保留的 journal；当前未提供可恢复 run-id')
  const confirmAt = args.indexOf('--confirm')
  if (args.includes('--apply')) {
    if (confirmAt < 0 || !args[confirmAt + 1]) throw new Error('apply 必须提供 --confirm "<token>"')
    const result = await applyKnowledgeUpdate({ confirmationToken: args[confirmAt + 1] })
    console.log(`已应用：${result.applied.join(', ')} → ${result.targetVersion}`)
    if (result.archiveWarning) console.warn(`归档警告：${result.archiveWarning}`)
    return
  }
  const report = await dryRunKnowledgeUpdate()
  if (!report) { console.log('没有待处理批次'); return }
  console.log(`dry-run 已完成：${report.ordered_batch_ids.join(', ')} → ${report.target_content_version}`)
  console.log(`确认令牌：${report.confirmation_token}`)
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
