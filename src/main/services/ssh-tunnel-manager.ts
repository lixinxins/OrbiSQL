import { readFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { Client, type ConnectConfig } from 'ssh2'

export interface SshTunnelConnection {
  host: string
  port: number
  sshEnabled: boolean
  sshHost: string
  sshPort: number
  sshUsername: string
  sshAuthType: 'password' | 'privateKey'
  sshPassword: string
  sshPrivateKeyPath: string
  sshPassphrase: string
}

export interface TunnelEndpoint {
  localHost: string
  localPort: number
}

interface ActiveTunnel extends TunnelEndpoint {
  client: Client
  server: Server
  signature: string
}

const signatureFor = (connection: SshTunnelConnection): string => JSON.stringify({
  sshHost: connection.sshHost,
  sshPort: connection.sshPort,
  sshUsername: connection.sshUsername,
  authType: connection.sshAuthType,
  keyPath: connection.sshPrivateKeyPath,
  targetHost: connection.host,
  targetPort: connection.port
})

export class SshTunnelManager {
  private readonly tunnels = new Map<string | number, ActiveTunnel>()

  async ensureTunnel(key: string | number, connection: SshTunnelConnection): Promise<TunnelEndpoint> {
    if (!connection.sshEnabled) {
      this.closeTunnel(key)
      return { localHost: connection.host, localPort: connection.port }
    }
    const signature = signatureFor(connection)
    const active = this.tunnels.get(key)
    if (active?.signature === signature && active.server.listening) {
      return { localHost: active.localHost, localPort: active.localPort }
    }
    this.closeTunnel(key)

    const client = new Client()
    const config: ConnectConfig = {
      host: connection.sshHost,
      port: connection.sshPort || 22,
      username: connection.sshUsername,
      readyTimeout: 10_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3
    }
    if (connection.sshAuthType === 'privateKey') {
      config.privateKey = readFileSync(connection.sshPrivateKeyPath)
      if (connection.sshPassphrase) config.passphrase = connection.sshPassphrase
    } else {
      config.password = connection.sshPassword
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      client.once('error', onError)
      client.once('ready', () => {
        client.off('error', onError)
        resolve()
      })
      client.connect(config)
    })

    const server = createServer((socket: Socket) => {
      client.forwardOut(socket.localAddress || '127.0.0.1', socket.localPort || 0, connection.host, connection.port, (error, stream) => {
        if (error) {
          socket.destroy(error)
          return
        }
        socket.pipe(stream).pipe(socket)
        stream.on('error', (streamError: Error) => socket.destroy(streamError))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      client.end()
      throw new Error('SSH 本地转发端口创建失败')
    }
    const tunnel: ActiveTunnel = { client, server, signature, localHost: '127.0.0.1', localPort: address.port }
    this.tunnels.set(key, tunnel)
    const invalidate = (): void => {
      if (this.tunnels.get(key) === tunnel) this.closeTunnel(key)
    }
    client.once('close', invalidate)
    client.once('error', invalidate)
    return { localHost: tunnel.localHost, localPort: tunnel.localPort }
  }

  getEndpoint(key: string | number): TunnelEndpoint | null {
    const tunnel = this.tunnels.get(key)
    return tunnel?.server.listening ? { localHost: tunnel.localHost, localPort: tunnel.localPort } : null
  }

  closeTunnel(key: string | number): void {
    const tunnel = this.tunnels.get(key)
    if (!tunnel) return
    this.tunnels.delete(key)
    tunnel.server.close()
    tunnel.client.end()
  }

  closeAll(): void {
    Array.from(this.tunnels.keys()).forEach((key) => this.closeTunnel(key))
  }
}

export const sshTunnelManager = new SshTunnelManager()
