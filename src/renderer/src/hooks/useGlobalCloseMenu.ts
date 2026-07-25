import { useEffect } from 'react'

/**
 * Automatically binds click, blur, and escape key listeners to close a menu when it's open.
 * @param isOpen Whether the menu is currently open
 * @param close The callback to close the menu
 */
export function useGlobalCloseMenu(isOpen: boolean, close: () => void): void {
  useEffect(() => {
    if (!isOpen) return

    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen, close])
}
