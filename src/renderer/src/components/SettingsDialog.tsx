import { useEffect } from 'react'
import { Check, GearSix, Translate, X } from '@phosphor-icons/react'
import type { AppLanguage, AppTheme } from '@/shared/connections'

interface SettingsDialogProps {
  language: AppLanguage
  theme: AppTheme
  onLanguageChange: (language: AppLanguage) => void
  onThemeChange: (theme: AppTheme) => void
  onClose: () => void
}

function SettingsDialog({ language, theme, onLanguageChange, onThemeChange, onClose }: SettingsDialogProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span><GearSix weight="fill" /></span>
          <div><h2 id="settings-title">设置</h2><p>QuillDB 应用偏好设置</p></div>
          <button type="button" aria-label="关闭设置" onClick={onClose}><X /></button>
        </header>
        <div className="settings-content">
          <div className="settings-row">
            <span className="settings-row-icon"><Translate /></span>
            <div><strong>界面语言</strong><small>系统菜单与应用界面使用的语言</small></div>
            <select className="settings-select" value={language} onChange={(event) => onLanguageChange(event.target.value as AppLanguage)} aria-label="界面语言">
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
          <div className="">
            <div className="theme-wrap-list" role="radiogroup" aria-label="外观主题">
              {([
                { value: 'system', label: '跟随系统', thumbClass: 'thumb-follow' },
                { value: 'light', label: '明亮浅色', thumbClass: 'thumb-light' },
                { value: 'classic', label: '经典蓝', thumbClass: 'thumb-blue' },
                { value: 'slate', label: '柔和灰', thumbClass: 'thumb-gray' },
                { value: 'violet', label: '紫罗兰', thumbClass: 'thumb-purple' }
              ] as Array<{ value: AppTheme; label: string; thumbClass: string }>).map((option) => (
                <button
                  type="button"
                  className={`theme-item${theme === option.value ? ' active' : ''}`}
                  role="radio"
                  aria-checked={theme === option.value}
                  key={option.value}
                  onClick={() => onThemeChange(option.value)}
                >
                  <div className={`theme-thumb ${option.thumbClass}`} />
                  <span className="theme-name">{option.label}</span>
                  {theme === option.value && (
                    <div className="check-circle"><Check weight="bold" /></div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
        <footer><button type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}

export default SettingsDialog
