import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]'

/**
 * Menu button pattern: arrow keys move between items, Escape returns focus to the trigger.
 * The menu closes whenever `closeKey` changes (pass the route inside the router).
 */
export function useMenu(closeKey?: string) {
  const [open, setOpen] = useState(false)
  const openRef = useRef(open)
  openRef.current = open
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<'first' | 'last' | null>(null)
  const menuId = useId()

  // Skip items hidden by responsive classes, or arrow keys would stop on them
  const items = useCallback(
    () =>
      [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])].filter(
        (el) => typeof el.checkVisibility !== 'function' || el.checkVisibility(),
      ),
    [],
  )

  const focusInside = useCallback(
    () => !!containerRef.current?.contains(document.activeElement),
    [],
  )

  const close = useCallback((restoreFocus: boolean) => {
    pendingFocus.current = null
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // A menu item that navigates unmounts itself; keep focus on the trigger instead of <body>.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close whenever the key changes
  useEffect(() => {
    if (openRef.current) close(focusInside())
  }, [closeKey])

  useEffect(() => {
    if (!open) return
    if (pendingFocus.current) {
      const list = items()
      const target = pendingFocus.current === 'first' ? list[0] : list[list.length - 1]
      target?.focus()
      pendingFocus.current = null
    }
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(focusInside())
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, items, close, focusInside])

  function openAt(edge: 'first' | 'last') {
    if (open) {
      const list = items()
      ;(edge === 'first' ? list[0] : list[list.length - 1])?.focus()
      return
    }
    pendingFocus.current = edge
    setOpen(true)
  }

  function onTriggerKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown' || ((e.key === 'Enter' || e.key === ' ') && !open)) {
      e.preventDefault()
      openAt('first')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openAt('last')
    } else if (e.key === 'Tab' && open) {
      close(false)
    }
  }

  function onMenuKeyDown(e: ReactKeyboardEvent) {
    const list = items()
    const current = document.activeElement as HTMLElement | null
    const index = current ? list.indexOf(current) : -1
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = list[(index + 1) % list.length]
    else if (e.key === 'ArrowUp') next = list[(index - 1 + list.length) % list.length]
    else if (e.key === 'Home') next = list[0]
    else if (e.key === 'End') next = list[list.length - 1]
    else if (e.key === ' ' && current?.tagName === 'A') {
      // Links ignore Space; menu items are expected to activate on it
      e.preventDefault()
      current.click()
      return
    } else if (e.key === 'Tab') {
      // Hand focus to the trigger first so the browser tabs onward from a stable point
      triggerRef.current?.focus()
      close(false)
      return
    }
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return {
    open,
    close,
    containerRef,
    triggerProps: {
      ref: triggerRef,
      onClick: () => setOpen((v) => !v),
      onKeyDown: onTriggerKeyDown,
      'aria-expanded': open,
      'aria-haspopup': 'menu' as const,
      'aria-controls': open ? menuId : undefined,
    },
    menuProps: {
      ref: menuRef,
      id: menuId,
      onKeyDown: onMenuKeyDown,
    },
  }
}
