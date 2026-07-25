import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2'
import { Client } from 'ssh2'
import { readFileSync } from 'node:fs'
import { basename, posix } from 'node:path'
import type { WebContents } from 'electron'
import type { ConnectionRepository } from '../database/connection-repository'
import type { SshFileActionResult, SshFileEntry, SshFileListResult } from '../../shared/ssh-files'
import { IpcChannel } from '../../shared/ipc-channels'

interface SshSession {
  client: Client
  stream: ClientChannel
  webContents: WebContents
  sessionId: string
}

interface SshConnectOptions {
  sessionId: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
  connectionId?: number
}

export class SshService {
  private sessions = new Map<string, SshSession>()
  private pendingClients = new Map<string, Client>()
  private connectionRepository: ConnectionRepository

  constructor(connectionRepository: ConnectionRepository) {
    this.connectionRepository = connectionRepository
  }

  async connect(options: SshConnectOptions, webContents: WebContents): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      let finalOptions = { ...options }

      const doConnect = (): void => {
        // A tab can reconnect while an earlier async connection is still pending.
        // Keep exactly one client for a session id so output cannot be mirrored twice.
        this.disconnect(finalOptions.sessionId)
        const client = new Client()
        this.pendingClients.get(finalOptions.sessionId)?.end()
        this.pendingClients.set(finalOptions.sessionId, client)

        const config: ConnectConfig = {
          host: finalOptions.host,
          port: finalOptions.port || 22,
          username: finalOptions.username,
          readyTimeout: 15000
        }

        if (finalOptions.authType === 'privateKey') {
          try {
            config.privateKey = readFileSync(finalOptions.privateKeyPath!)
            if (finalOptions.passphrase) config.passphrase = finalOptions.passphrase
          } catch (err) {
            resolve({ success: false, message: `读取私钥文件失败: ${String(err)}` })
            return
          }
        } else {
          config.password = finalOptions.password || ''
        }

        client.on('ready', () => {
          if (this.pendingClients.get(finalOptions.sessionId) !== client) {
            client.end()
            resolve({ success: false, message: '连接已被新的会话替换' })
            return
          }
          client.shell({ term: 'xterm-256color', rows: 24, cols: 120 }, (err, stream) => {
            if (err) {
              client.end()
              resolve({ success: false, message: `打开 Shell 失败: ${err.message}` })
              return
            }

            const session: SshSession = { client, stream, webContents, sessionId: finalOptions.sessionId }
            this.pendingClients.delete(finalOptions.sessionId)
            this.sessions.set(finalOptions.sessionId, session)

            stream.on('data', (data: Buffer) => {
              if (!webContents.isDestroyed()) {
                webContents.send(IpcChannel.ssh.output(finalOptions.sessionId), data.toString('utf8'))
              }
            })

            stream.stderr.on('data', (data: Buffer) => {
              if (!webContents.isDestroyed()) {
                webContents.send(IpcChannel.ssh.output(finalOptions.sessionId), data.toString('utf8'))
              }
            })

            stream.on('close', () => {
              if (this.sessions.get(finalOptions.sessionId) === session) this.sessions.delete(finalOptions.sessionId)
              if (!webContents.isDestroyed()) {
                webContents.send(IpcChannel.ssh.closed(finalOptions.sessionId))
              }
            })

            resolve({ success: true, message: '连接成功' })
          })
        })

        client.on('error', (err) => {
          if (this.pendingClients.get(finalOptions.sessionId) === client) this.pendingClients.delete(finalOptions.sessionId)
          resolve({ success: false, message: `SSH 连接失败: ${err.message}` })
        })

        try {
          client.connect(config)
        } catch (err) {
          resolve({ success: false, message: `连接异常: ${String(err)}` })
        }
      }

      if (finalOptions.connectionId && !finalOptions.password && finalOptions.authType === 'password') {
        const stored = this.connectionRepository.getById(finalOptions.connectionId)
        if (stored) {
          const isSshConnection = stored.engine === 'SSH'
          finalOptions = {
            ...finalOptions,
            host: finalOptions.host || stored.host,
            port: finalOptions.port || stored.port,
            username: finalOptions.username || stored.username,
            password: isSshConnection ? (stored.password || stored.sshPassword) : stored.sshPassword
          }
        }
      }

      doConnect()
    })
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.stream.write(data)
    }
  }

  resize(sessionId: string, rows: number, cols: number): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.stream.setWindow(rows, cols, 0, 0)
    }
  }

  private sftp<T>(sessionId: string, action: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    const session = this.sessions.get(sessionId)
    if (!session) return Promise.reject(new Error('SSH 会话未连接'))
    return new Promise((resolve, reject) => {
      session.client.sftp((error, channel) => {
        if (error) {
          reject(error)
          return
        }
        void action(channel)
          .then(resolve, reject)
          .finally(() => {
            try { channel.end() } catch { /* ignore */ }
          })
      })
    })
  }

  private realPath(sftp: SFTPWrapper, remotePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      sftp.realpath(remotePath || '.', (error, resolvedPath) => error ? reject(error) : resolve(resolvedPath))
    })
  }

  async listFiles(sessionId: string, remotePath = '.'): Promise<SshFileListResult> {
    try {
      return await this.sftp(sessionId, async (sftp) => {
        const resolvedPath = await this.realPath(sftp, remotePath)
        const entries = await new Promise<SshFileEntry[]>((resolve, reject) => {
          sftp.readdir(resolvedPath, (error, list) => {
            if (error) {
              reject(error)
              return
            }
            resolve(list
              .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
              .map<SshFileEntry>((entry) => ({
                name: entry.filename,
                path: posix.join(resolvedPath, entry.filename),
                type: entry.attrs.isDirectory() ? 'directory' : entry.attrs.isSymbolicLink() ? 'link' : 'file',
                size: entry.attrs.size,
                modifiedAt: entry.attrs.mtime * 1000
              }))
              .sort((left, right) => {
                if (left.type === 'directory' && right.type !== 'directory') return -1
                if (left.type !== 'directory' && right.type === 'directory') return 1
                return left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
              }))
          })
        })
        return { success: true, message: '', path: resolvedPath, entries }
      })
    } catch (error) {
      return { success: false, message: `读取远程目录失败：${error instanceof Error ? error.message : String(error)}`, path: remotePath, entries: [] }
    }
  }

  async uploadFiles(sessionId: string, remoteDirectory: string, localPaths: string[]): Promise<SshFileActionResult> {
    if (!localPaths.length) return { success: false, message: '未选择文件', canceled: true }
    try {
      await this.sftp(sessionId, async (sftp) => {
        const targetDirectory = await this.realPath(sftp, remoteDirectory)
        for (const localPath of localPaths) {
          const remotePath = posix.join(targetDirectory, basename(localPath))
          await new Promise<void>((resolve, reject) => {
            sftp.fastPut(localPath, remotePath, (error) => error ? reject(error) : resolve())
          })
        }
      })
      return { success: true, message: `已上传 ${localPaths.length} 个文件` }
    } catch (error) {
      return { success: false, message: `上传失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  async downloadFile(sessionId: string, remotePath: string, localPath: string): Promise<SshFileActionResult> {
    try {
      await this.sftp(sessionId, (sftp) => new Promise<void>((resolve, reject) => {
        sftp.fastGet(remotePath, localPath, (error) => error ? reject(error) : resolve())
      }))
      return { success: true, message: '文件下载完成' }
    } catch (error) {
      return { success: false, message: `下载失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  async deleteFile(sessionId: string, remotePath: string, type: SshFileEntry['type']): Promise<SshFileActionResult> {
    try {
      await this.sftp(sessionId, (sftp) => new Promise<void>((resolve, reject) => {
        const done = (error?: Error | null): void => error ? reject(error) : resolve()
        if (type === 'directory') sftp.rmdir(remotePath, done)
        else sftp.unlink(remotePath, done)
      }))
      return { success: true, message: type === 'directory' ? '目录已删除' : '文件已删除' }
    } catch (error) {
      return { success: false, message: `删除失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  disconnect(sessionId: string): void {
    const pending = this.pendingClients.get(sessionId)
    if (pending) {
      try { pending.end() } catch { /* ignore */ }
      this.pendingClients.delete(sessionId)
    }
    const session = this.sessions.get(sessionId)
    if (session) {
      try { session.stream.end() } catch { /* ignore */ }
      try { session.client.end() } catch { /* ignore */ }
      this.sessions.delete(sessionId)
    }
  }

  disconnectAll(): void {
    const sessionIds = new Set([...this.sessions.keys(), ...this.pendingClients.keys()])
    for (const sessionId of sessionIds) {
      this.disconnect(sessionId)
    }
  }
}
