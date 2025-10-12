'use client'

import React, { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, errorInfo: React.ErrorInfo, reset: () => void) => ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  level?: 'page' | 'section' | 'component'
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
    this.props.onError?.(error, errorInfo)
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback && this.state.errorInfo) {
        return this.props.fallback(this.state.error, this.state.errorInfo, this.reset)
      }

      const level = this.props.level || 'component'
      
      // Default fallback UI based on level
      return (
        <div
          style={{
            padding: level === 'page' ? 32 : level === 'section' ? 16 : 8,
            margin: level === 'component' ? 8 : 0,
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: 6,
            fontSize: level === 'page' ? 14 : 12,
          }}
        >
          <div style={{ 
            fontWeight: 'bold', 
            color: '#c00',
            marginBottom: 8,
            fontSize: level === 'page' ? 16 : 14,
          }}>
            ⚠️ {level === 'page' ? 'Page Error' : level === 'section' ? 'Section Error' : 'Component Error'}
          </div>
          <div style={{ marginBottom: 8, color: '#600' }}>
            <strong>Error:</strong> {this.state.error.message}
          </div>
          {this.state.errorInfo && (
            <details style={{ fontSize: 11, color: '#666' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 4 }}>Stack trace</summary>
              <pre style={{ 
                overflow: 'auto', 
                padding: 8, 
                background: '#f5f5f5',
                borderRadius: 4,
                fontSize: 10,
              }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={this.reset}
            style={{
              marginTop: 12,
              padding: '6px 12px',
              background: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
            type="button"
          >
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

// Convenience wrapper for component-level errors
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: (error: Error, errorInfo: React.ErrorInfo, reset: () => void) => ReactNode
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback} level="component">
        <Component {...props} />
      </ErrorBoundary>
    )
  }
}

