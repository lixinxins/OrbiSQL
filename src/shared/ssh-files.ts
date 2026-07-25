export interface SshFileEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'link'
  size: number
  modifiedAt: number
}

export interface SshFileListResult {
  success: boolean
  message: string
  path: string
  entries: SshFileEntry[]
}

export interface SshFileActionResult {
  success: boolean
  message: string
  canceled?: boolean
}
