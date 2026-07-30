import { useAppUpdate } from './app-update-context'

export function AppUpdateNotice() {
  const { state, activateUpdate, ignoreUpdate } = useAppUpdate()
  if (state.status === 'update-available' && !state.ignored) return <aside className="app-update-notice" role="status">
    <p>{state.isExternal ? '另一个标签页已发现新应用版本。' : '新应用版本可用。'}{state.targetVersion ? ` 版本 ${state.targetVersion}` : ''}</p>
    {state.error && <p>{state.error}</p>}
    <div><button type="button" onClick={() => void activateUpdate()}>更新并重新加载</button><button type="button" onClick={ignoreUpdate}>稍后</button></div>
  </aside>
  if (state.status === 'activating') return <aside className="app-update-notice" role="status"><p>正在保存本地状态并切换新版本……</p></aside>
  if (state.status === 'error') return <aside className="app-update-notice" role="status"><p>{state.error}</p></aside>
  return null
}
