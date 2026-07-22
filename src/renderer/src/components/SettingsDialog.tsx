import { useEffect } from 'react'
import { Check, GearSix, Sun, Translate, X } from '@phosphor-icons/react'
import type { AppLanguage, AppTheme } from '../../../shared/connections'

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
          <div><h2 id="settings-title">设置</h2><p>OrbiSQL 应用偏好设置</p></div>
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
          <div className="settings-row settings-theme-row">
            <span className="settings-row-icon"><Sun /></span>
            <div><strong>外观主题</strong><small>选择切换外观主题，设置后立即生效</small></div>
            <div className="theme-card-grid" role="radiogroup" aria-label="外观主题">
              {([
                { value: 'system', label: '跟随系统', colors: ['#6366f1', '#161b22'] },
                { value: 'light', label: '明亮浅色', colors: ['#4f6df5', '#f6f8fb'] },
                { value: 'classic', label: '经典蓝', colors: ['#6366f1', '#0d1117'] },
                { value: 'slate', label: '柔和灰', colors: ['#64748b', '#111827'] },
                { value: 'violet', label: '紫罗兰', colors: ['#8b5cf6', '#0f0a1c'] }
              ] as Array<{ value: AppTheme; label: string; colors: [string, string] }>).map((option) => (
                <button
                  type="button"
                  className={`theme-card${theme === option.value ? ' selected' : ''}`}
                  role="radio"
                  aria-checked={theme === option.value}
                  key={option.value}
                  onClick={() => onThemeChange(option.value)}
                >
                  <span className="theme-card-preview" style={{ background: option.colors[1] }}>
                    <i style={{ background: option.colors[0] }} />
                    <i style={{ background: option.colors[0] }} />
                    <i style={{ background: option.colors[1] === '#f6f8fb' ? '#ffffff' : '#21262d' }} />
                  </span>
                  <span className="theme-card-name">{option.label}</span>
                  <span className="theme-card-check"><Check weight="bold" /></span>
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
