import { useEffect } from 'react'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useDialogStore } from '../stores/useDialogStore'

/**
 * 应用级菜单事件：启动加载连接列表，并订阅主进程的
 * 新建连接 / 打开设置 / 打开关于 菜单请求，统一转成对话框打开动作。
 */
export function useAppMenuEvents(): void {
  useEffect(() => {
    void useConnectionStore.getState().actions.loadConnections()
    const unsubscribeCreate = window.omnidb.connections.onCreateRequested(() => {
      useDialogStore.getState().actions.setEditingConnection(null)
      useDialogStore.getState().actions.setShowConnectionDialog(true)
    })
    const unsubscribeSettings = window.omnidb.onSettingsRequested(() => {
      useDialogStore.getState().actions.setShowSettingsDialog(true)
    })
    const unsubscribeAbout = window.omnidb.onAboutRequested(() => {
      useDialogStore.getState().actions.setShowAboutDialog(true)
    })
    return () => {
      unsubscribeCreate()
      unsubscribeSettings()
      unsubscribeAbout()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
