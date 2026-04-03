import { useCallback, useEffect, useRef, useState } from 'react'

const DISMISS_KEY = 'digarr:install-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(false)
  const [showIosHint, setShowIosHint] = useState(false)
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isStandalone()) return
    if (isIos()) {
      const dismissed = localStorage.getItem(DISMISS_KEY)
      if (!dismissed) setShowIosHint(true)
      return
    }

    function handlePrompt(e: Event) {
      e.preventDefault()
      deferredPromptRef.current = e as BeforeInstallPromptEvent
      const dismissed = localStorage.getItem(DISMISS_KEY)
      if (!dismissed) setCanInstall(true)
    }

    window.addEventListener('beforeinstallprompt', handlePrompt)
    return () => window.removeEventListener('beforeinstallprompt', handlePrompt)
  }, [])

  const promptInstall = useCallback(async () => {
    const prompt = deferredPromptRef.current
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice
    setCanInstall(false)
    deferredPromptRef.current = null
  }, [])

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, '1')
    setCanInstall(false)
    setShowIosHint(false)
  }, [])

  return { canInstall, showIosHint, promptInstall, dismiss }
}
