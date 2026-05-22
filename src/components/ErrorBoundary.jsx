import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 36 }}>⚠</div>
          <div style={{ color: '#e05c2a', fontWeight: 600, fontSize: 15 }}>
            Something went wrong loading this tab
          </div>
          <div style={{ color: '#4a4a4a', fontSize: 13, maxWidth: 420, lineHeight: 1.5 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 20px', background: '#2563b0', color: '#fff',
              border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
