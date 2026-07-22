import { readFileSync } from 'node:fs'

export interface DatabaseSslOptions {
  rejectUnauthorized: boolean
  ca?: Buffer
  cert?: Buffer
  key?: Buffer
}

export interface SslConnectionConfig {
  sslEnabled: boolean
  sslRejectUnauthorized: boolean
  sslCaPath: string
  sslCertPath: string
  sslKeyPath: string
  sslServerName?: string
}

const readOptionalFile = (path: string): Buffer | undefined => path.trim() ? readFileSync(path.trim()) : undefined

export const buildSslConfig = (connection: SslConnectionConfig): DatabaseSslOptions | undefined => {
  if (!connection.sslEnabled) return undefined
  return {
    rejectUnauthorized: connection.sslRejectUnauthorized,
    ca: readOptionalFile(connection.sslCaPath),
    cert: readOptionalFile(connection.sslCertPath),
    key: readOptionalFile(connection.sslKeyPath)
  }
}
