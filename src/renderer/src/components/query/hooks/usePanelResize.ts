/**
 * 编辑器与结果面板的高度拖拽调整 hook
 * 通过鼠标拖拽分隔条动态调整编辑器区域的高度百分比（15% ~ 85%）。
 */
import { useRef, useState } from 'react'

/** usePanelResize 返回值接口 */
export interface UsePanelResizeReturn {
  /** 编辑器区域高度百分比（15~85） */
  editorHeightPercent: number
  /** 绑定到分隔条的 mousedown 处理函数 */
  handleResizeMouseDown: (event: React.MouseEvent) => void
}

/**
 * 编辑器与结果面板高度拖拽调整 hook
 * @param workspaceRef - 工作区容器 ref，用于计算拖拽百分比
 * @returns 编辑器高度百分比、拖拽开始处理函数
 */
export function usePanelResize(workspaceRef: React.RefObject<HTMLElement | null>): UsePanelResizeReturn {
  const [editorHeightPercent, setEditorHeightPercent] = useState(38)
  /** 拖拽起始状态：记录鼠标起始 Y 坐标和起始高度百分比 */
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null)

  /** mousemove：根据拖拽偏移量计算新高度百分比，限制在 15%~85% 范围内 */
  const handleResizeMouseMove = (event: MouseEvent): void => {
    if (!dragState.current || !workspaceRef.current) return
    const deltaY = event.clientY - dragState.current.startY
    const workspaceHeight = workspaceRef.current.getBoundingClientRect().height
    const percentDelta = (deltaY / workspaceHeight) * 100
    const newPercent = Math.max(15, Math.min(85, dragState.current.startHeight + percentDelta))
    setEditorHeightPercent(newPercent)
  }

  /** mouseup：清除拖拽状态，移除全局事件监听，恢复鼠标样式和文本选择 */
  const handleResizeMouseUp = (): void => {
    dragState.current = null
    document.removeEventListener('mousemove', handleResizeMouseMove)
    document.removeEventListener('mouseup', handleResizeMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  /** mousedown：记录拖拽起始状态，注册全局 mousemove/mouseup 监听 */
  const handleResizeMouseDown = (event: React.MouseEvent): void => {
    event.preventDefault()
    dragState.current = { startY: event.clientY, startHeight: editorHeightPercent }
    document.addEventListener('mousemove', handleResizeMouseMove)
    document.addEventListener('mouseup', handleResizeMouseUp)
    // 拖拽期间设置 row-resize 光标并禁止文本选择
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  return { editorHeightPercent, handleResizeMouseDown }
}
