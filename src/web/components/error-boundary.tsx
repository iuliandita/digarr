import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/button'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

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
          <h1 className="text-lg font-semibold text-text">Something went wrong</h1>
          <p className="text-sm text-muted">{this.state.error.message}</p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button onClick={() => window.location.assign('/')}>Go home</Button>
          </div>
        </div>
      </div>
    )
  }
}
