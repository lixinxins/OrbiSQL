import { useEffect, useState } from 'react'
import { Check, Copy, GithubLogo, X } from '@phosphor-icons/react'
import appIcon from '../../../../resources/icon.png'
import wechatQrCode from '../../../../resources/codeace-wechat.jpg'

interface AboutDialogProps {
  onClose: () => void
}

function AboutDialog({ onClose }: AboutDialogProps) {
  const [version, setVersion] = useState('0.1.0')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.omnidb.getAppInfo().then((info) => setVersion(info.version))
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const copyQq = async (): Promise<void> => {
    await navigator.clipboard.writeText('941697962')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return <div className="settings-backdrop about-dialog-backdrop" onMouseDown={onClose}>
    <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="about-dialog-close" aria-label="关闭关于窗口" onClick={onClose}><X /></button>
      <div className="about-product">
        <img src={appIcon} alt="OrbiSQL" />
        <div><h2 id="about-dialog-title">OrbiSQL</h2><p>跨平台桌面数据库管理工具</p><span>版本 {version}</span></div>
      </div>
      <div className="about-author"><strong>作者</strong><span>CodeAce</span></div>
      <div className="about-contact-grid">
        <div className="about-contact-copy">
          <span>QQ 联系方式</span>
          <strong>941697962</strong>
          <button type="button" onClick={() => void copyQq()}>{copied ? <Check /> : <Copy />}{copied ? '已复制' : '复制 QQ'}</button>
          <a href="https://github.com/lixinxins/OrbiSQL" target="_blank" rel="noreferrer"><GithubLogo />开源项目主页</a>
        </div>
        <div className="about-wechat"><span>微信</span><img src={wechatQrCode} alt="CodeAce 微信二维码" /><small>使用微信扫码添加好友</small></div>
      </div>
      <footer>Copyright © 2026 CodeAce · MIT License</footer>
    </section>
  </div>
}

export default AboutDialog
