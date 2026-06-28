import React from 'react';

/**
 * ErrorBoundary — root-level safety net for render-time throws.
 *
 * Must be a class component; hooks have no error-boundary equivalent in
 * React 19. Catches any throw from the subtree and renders a recoverable
 * fallback instead of a fully blank page.
 *
 * No telemetry / no external network calls — console.error + visible UI only.
 * Inspired by the PR #125 blank-page incident (root cause fixed in PR-c;
 * this adds the safety net so the next unexpected throw is survivable).
 *
 * Placed in main.jsx above AppShell so it catches crashes in AppShell itself,
 * not just crashes inside AppShell's children. AppShell uses AppErrorBoundary
 * variant="app" internally; this is the outer fallback of last resort.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Preserve the full trace so a DevTools screenshot captures everything.
    console.error('[ErrorBoundary] Uncaught render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      const { error } = this.state;
      return (
        <div className="error-boundary">
          <h1 className="error-boundary__title">Something went wrong</h1>
          <p className="error-boundary__body">
            The app hit an error and stopped. Reloading usually fixes it.
          </p>
          <button
            className="error-boundary__reload action-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <details className="error-boundary__details">
            <summary>Show error details</summary>
            <pre>{error?.message ?? 'Unknown error'}</pre>
          </details>
          <p className="error-boundary__footnote">
            If reloading doesn&rsquo;t help, message the team and include the error above.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
