import { Component, type ContextType, type ErrorInfo, type ReactNode } from 'react'
import { DEFAULT_LOCALE } from '@/core/i18n/locales'
import { getMessages } from '@/core/i18n/messages'
import type { MessageKey } from '@/core/i18n/messages/types'
import { CHANNEL, GIT_SHA, VERSION } from '@/version'
import { I18nContext } from '@/web/lib/i18n'
import { Button } from './ui/button'
import { Disclosure } from './ui/disclosure'

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

    const { message } = this.state.error
    const build = `v${VERSION} (${GIT_SHA.slice(0, 7)}, ${CHANNEL})`

    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div
          role="alert"
          className="bg-surface border border-border rounded-lg p-6 max-w-md w-full space-y-4"
        >
          <div className="space-y-2 text-center">
            <h1 className="text-lg font-semibold text-text">{this.t('errorBoundary.title')}</h1>
            <p className="text-sm text-muted">{this.t('errorBoundary.body')}</p>
          </div>
          <div className="flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>
              {this.t('errorBoundary.reload')}
            </Button>
            <Button variant="outline" onClick={() => window.location.assign('/')}>
              {this.t('errorBoundary.home')}
            </Button>
          </div>
          <Disclosure title={this.t('errorBoundary.details')}>
            <pre className="whitespace-pre-wrap break-words text-xs text-muted select-all">
              {`${message}\n${build}`}
            </pre>
          </Disclosure>
        </div>
      </div>
    )
  }
}
