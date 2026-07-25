import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installPlatformBridge } from './platform/platform-bridge'
import { migrateLegacyStorageKeys } from './utils/localStorage-keys'
import './styles.css'

installPlatformBridge()
migrateLegacyStorageKeys()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<div className="app-loading">加载中...</div>}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  </React.StrictMode>
)
