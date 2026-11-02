import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Keep an individual side chat failure inside its native tab. */
export class RenderBoundary extends Component<{
  children?: ReactNode
  className?: string
}, { error?: string }> {
  state: { error?: string } = {}

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[dsh-side-chat] render error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error === undefined) return this.props.children
    return <div className={this.props.className} role="alert">
      <span>dsh-side-chat: {this.state.error}</span>
      <button type="button" aria-label="Retry" onClick={() => { this.setState({ error: undefined }) }}>↻</button>
    </div>
  }
}
