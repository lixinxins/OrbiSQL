import { useEffect } from 'react'
import type { AppTheme } from '../../../shared/connections'
import { applyInterfaceLanguage, stopInterfaceLanguage } from '../i18n/interface-language'
import { useUIStore } from '../stores/useUIStore'

/**
 * 语言/主题偏好：持久化到 localStorage 并同步主进程偏好设置；
 * 兼容旧的 system 偏好，项目默认保持浅色，深色玻璃主题仅在用户主动选择时启用。
 */
export function useInterfacePreferences(): void {
  const language = useUIStore((s) => s.language)
  const theme = useUIStore((s) => s.theme)

  useEffect(() => {
    localStorage.setItem('omnidb.preferences.language', language)
    localStorage.setItem('omnidb.preferences.theme', theme)

    const applyTheme = (currentTheme: AppTheme) => {
      // 兼容旧的 system 偏好；项目默认保持浅色，深色玻璃主题仅在用户主动选择时启用。
      const resolved = currentTheme === 'classic' ? 'classic' : 'light'
      document.documentElement.dataset.theme = resolved
    }

    applyTheme(theme)

    if (theme === 'system') {
      // 兼容旧持久化数据：system 统一回落到浅色。
      applyInterfaceLanguage(language)
      void window.omnidb.updatePreferences({ language, theme })
      return stopInterfaceLanguage
    }

    applyInterfaceLanguage(language)
    void window.omnidb.updatePreferences({ language, theme })
    return stopInterfaceLanguage
  }, [language, theme])
}
