import { dryRunKnowledgeUpdate } from './dry-run'

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) throw new Error('apply 尚未在当前 Phase 启用')
  const report = await dryRunKnowledgeUpdate()
  if (!report) { console.log('没有待处理批次'); return }
  console.log(`dry-run 已完成：${report.ordered_batch_ids.join(', ')} → ${report.target_content_version}`)
  console.log(`确认令牌：${report.confirmation_token}`)
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
