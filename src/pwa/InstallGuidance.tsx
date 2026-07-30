import { useEffect, useState } from 'react'
import { isIphoneSafari, isStandalone } from './install-detection'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

const DISMISS_KEY = 'myriad-atlas.install-guidance.dismissed'

export function InstallGuidance() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent>()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === 'true')
  const standalone = isStandalone(window.matchMedia('(display-mode: standalone)').matches, (navigator as Navigator & { standalone?: boolean }).standalone === true)
  const iphoneSafari = isIphoneSafari(navigator.userAgent)
  useEffect(() => {
    const onBeforeInstall = (event: Event): void => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])
  const dismiss = (): void => {
    localStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }
  if (dismissed) return null
  if (standalone) return <p className="install-guidance" role="status">当前正作为主屏幕 Web App 运行；建议在此处完成下载并长期使用。</p>
  if (iphoneSafari) return <section className="install-guidance"><h3>添加到 iPhone 主屏幕</h3><p>在 Safari 的分享菜单中选择“添加到主屏幕”，再从图标启动万象回廊。Safari 标签页与主屏幕 Web App 的本地数据可能独立。</p><button type="button" onClick={dismiss}>暂不显示</button></section>
  if (deferredPrompt) return <section className="install-guidance"><p>此浏览器可安装万象回廊。</p><button type="button" onClick={() => { void deferredPrompt.prompt(); setDeferredPrompt(undefined) }}>安装应用</button><button type="button" onClick={dismiss}>暂不显示</button></section>
  return null
}
