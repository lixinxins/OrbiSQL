import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installPlatformBridge } from './platform/platform-bridge'
import './styles.css'

installPlatformBridge()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
