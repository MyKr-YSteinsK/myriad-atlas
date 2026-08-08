import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { ReaderPreferences } from '../state/reader-db'

interface ReaderSettingsProps {
  open: boolean
  preferences: ReaderPreferences
  onChange: (patch: Partial<ReaderPreferences>) => void
  onReset: () => void
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

interface RangeSetting { key: 'fontSize' | 'lineHeight' | 'paragraphSpacing' | 'gutter' | 'contentWidth'; label: string; min: number; max: number; step: number; unit: string }

const ranges: RangeSetting[] = [
  { key: 'fontSize', label: '字号', min: 16, max: 22, step: 1, unit: 'px' },
  { key: 'lineHeight', label: '行间距', min: 1.5, max: 2, step: 0.05, unit: '' },
  { key: 'paragraphSpacing', label: '段落间距', min: 0.6, max: 1.2, step: 0.05, unit: 'em' },
  { key: 'gutter', label: '页面左右边距', min: 16, max: 32, step: 1, unit: 'px' },
  { key: 'contentWidth', label: '宽屏正文宽度', min: 560, max: 860, step: 20, unit: 'px' },
]

function ReaderSettingsPreview({ preferences }: Pick<ReaderSettingsProps, 'preferences'>) {
  const previewStyle = {
    '--reader-preview-font-size': String(preferences.fontSize) + 'px',
    '--reader-preview-line-height': String(preferences.lineHeight),
    '--reader-preview-paragraph-spacing': String(preferences.paragraphSpacing) + 'em',
    '--reader-preview-gutter': String(10 + ((preferences.gutter - 16) / 16) * 6) + 'px',
    '--reader-preview-measure': String(58 + ((preferences.contentWidth - 560) / 300) * 30) + '%',
  } as CSSProperties
  return <section className="reader-settings-preview" data-theme={preferences.theme} data-font={preferences.font} style={previewStyle} role="group" aria-label="阅读设置实时预览">
    <div className="reader-settings-preview-heading"><span>PREVIEW</span><strong>实时阅读预览</strong></div>
    <div className="reader-preview-viewport">
      {preferences.showProgress && <span className="reader-preview-progress" aria-hidden="true" />}
      <div className="reader-preview-page">
        <div className="reader-preview-content">
          <p className="reader-preview-title">知识如何形成联系</p>
          <p>理解一个概念时，新的信息会与已有知识建立联系。</p>
          <p>合适的字号、行距和段落节奏，会直接影响持续阅读的舒适度。</p>
          <div className="reader-preview-extra">
            <p className="reader-preview-subtitle">小标题示例</p>
            <p>一个好的阅读界面让注意力稳定停留在内容本身；<strong>强调文字</strong>与<code>行内代码</code>也保持清晰。</p>
          </div>
        </div>
      </div>
    </div>
  </section>
}

export function ReaderSettings({ open, preferences, onChange, onReset, onClose, triggerRef }: ReaderSettingsProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const handleKeys = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled'))
      const first = focusable[0]; const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const previousOverflow = document.body.style.overflow
    const trigger = triggerRef.current
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeys)
    closeButton.current?.focus()
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKeys); trigger?.focus() }
  }, [onClose, open, triggerRef])
  if (!open) return null
  return <div className="reader-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="reader-settings" role="dialog" aria-modal="true" aria-labelledby="reader-settings-title">
      <header><div><p>READER / SETTINGS</p><h2 id="reader-settings-title">阅读设置</h2></div><button ref={closeButton} type="button" onClick={onClose}>关闭</button></header>
      <ReaderSettingsPreview preferences={preferences} />
      <div className="reader-settings-controls">
        <section className="reader-settings-group"><h3>排版</h3>{ranges.map((setting) => <div key={setting.key} className="reader-range"><span><label htmlFor={`reader-${setting.key}`}>{setting.label}</label><output aria-label={`${setting.label}当前值`}>{preferences[setting.key]}{setting.unit}</output></span><input id={`reader-${setting.key}`} type="range" min={setting.min} max={setting.max} step={setting.step} value={preferences[setting.key]} onChange={(event) => onChange({ [setting.key]: Number(event.target.value) })} /></div>)}</section>
        <section className="reader-settings-group"><h3>字体与主题</h3><fieldset><legend>正文字体</legend><label><input type="radio" name="font" checked={preferences.font === 'system'} onChange={() => onChange({ font: 'system' })} />系统字体</label><label><input type="radio" name="font" checked={preferences.font === 'serif'} onChange={() => onChange({ font: 'serif' })} />中文衬线字体</label></fieldset><fieldset><legend>主题</legend>{(['system', 'light', 'dark', 'warm'] as const).map((theme) => <label key={theme}><input type="radio" name="theme" checked={preferences.theme === theme} onChange={() => onChange({ theme })} />{{ system: '跟随系统', light: '浅色', dark: '深色', warm: '暖色' }[theme]}</label>)}</fieldset></section>
        <section className="reader-settings-group"><h3>阅读辅助</h3><label><input type="checkbox" checked={preferences.showProgress} onChange={(event) => onChange({ showProgress: event.target.checked })} />显示阅读进度</label><label><input type="checkbox" checked={preferences.showToc} onChange={(event) => onChange({ showToc: event.target.checked })} />显示目录</label><label><input type="checkbox" checked={preferences.codeWrap} onChange={(event) => onChange({ codeWrap: event.target.checked })} />代码换行</label></section>
      </div>
      <footer><button type="button" onClick={onReset}>恢复默认</button></footer>
    </section>
  </div>
}
