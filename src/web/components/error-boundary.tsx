import { Component, type ContextType, type ErrorInfo, type ReactNode } from 'react'
import { DEFAULT_LOCALE } from '@/core/i18n/locales'
import { getMessages } from '@/core/i18n/messages'
import type { MessageKey } from '@/core/i18n/messages/types'
import { I18nContext } from '@/web/lib/i18n'
import { Button } from './ui/button'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  static contextType = I18nContext

  declare context: ContextType<typeof I18nContext>

  state: State = { error: null }

  private t(key: MessageKey): string {
    return this.context?.t(key) ?? getMessages(DEFAULT_LOCALE)[key] ?? key
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="bg-surface border border-border rounded-lg p-6 max-w-md w-full space-y-4 text-center">
          <h1 className="text-lg font-semibold text-text">{this.t('errorBoundary.title')}</h1>
          <p className="text-sm text-muted">{this.state.error.message}</p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => this.setState({ error: null })}>
              {this.t('errorBoundary.retry')}
            </Button>
            <Button onClick={() => window.location.assign('/')}>
              {this.t('errorBoundary.home')}
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
