import { safeStorage } from 'electron'

export function encryptPassword(password: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全保存密码，请取消“保存密码”后重试')
  }
  return safeStorage.encryptString(password)
}

export function decryptPassword(cipher: Uint8Array | null): string | undefined {
  if (!cipher) return undefined
  if (!safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(cipher))
  } catch (e) {
    console.error('[Repository] 密码解密失败:', e)
    return undefined
  }
}
