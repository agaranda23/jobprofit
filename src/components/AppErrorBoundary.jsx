import React from 'react';
import { logTelemetry } from '../lib/telemetry.js';

/**
 * AppErrorBoundary — generalised error boundary usable at three scopes:
 *
 *   variant="drawer"  (default) — drawer sheet with Close button, mirrors the
 *                                 original DrawerErrorBoundary UI exactly.
 *   variant="screen"            — full-width card with a "Tap to retry" button
 *                                 that resets the boundary.  Used by FinanceScreen,
 *                                 TodayScreen and WorkScreen (Jobs) — one screen's
 *                                 render throw never takes down the other tabs.
 *   variant="app"               — full-viewport fallback of last resort, used by
 *                                 AppShell.  Shows a "Reload" button.
 *
 * The `resetKey` prop can be used to reset the boundary externally (changing the
 * key unmounts and remounts, clearing the error state).  This is the same pattern
 * DrawerErrorBoundary uses with jobId — the consumer just passes a stable value
 * when it does not need external resets.
 *
 * The `screen` prop (variant="screen" only) is a short label — e.g. "today",
 * "jobs", "finance" — used to (a) tailor the fallback copy and (b) tag the
 * crash telemetry event so we know which tab crashed. Defaults to 'finance'
 * copy/behaviour unchanged for existing callers that don't pass it.
 *
 * Background: React error boundaries must be class components — there is no hook
 * equivalent.
 */
const SCREEN_COPY = {
  finance: 'Something went wrong loading your figures',
  today: "Something went wrong loading today's jobs",
  jobs: 'Something went wrong loading your jobs',
};

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const variant = this.props.variant || 'drawer';
    console.error(`[AppErrorBoundary:${variant}] render error`, error, info?.componentStack);
    // No PII: error.message is a static/dev-authored string, never user record data.
    logTelemetry('error_boundary_crash', {
      variant,
      screen: this.props.screen || null,
      message: error?.message,
    });
  }

  handleReset() {
    this.setState({ error: null });
    this.props.onReset?.();
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const variant = this.props.variant || 'drawer';

    if (variant === 'app') {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100dvh',
            padding: '32px 24px',
            textAlign: 'center',
          }}
          role="alert"
        >
          <p style={{ fontWeight: 600, marginBottom: 8, fontSize: '1.1rem' }}>
            Something went wrong
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-label)', marginBottom: 24 }}>
            An unexpected error occurred. Reload to get back on track.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => window.location.reload()}
            style={{ minWidth: 160 }}
          >
            Reload
          </button>
        </div>
      );
    }

    if (variant === 'screen') {
      return (
        <div
          style={{
            margin: '24px 16px',
            padding: '20px',
            borderRadius: 12,
            background: 'var(--surface, #f5f5f5)',
            textAlign: 'center',
          }}
          role="alert"
        >
          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            {SCREEN_COPY[this.props.screen] || SCREEN_COPY.finance}
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-label)', marginBottom: 20 }}>
            An unexpected error occurred. Tap to retry.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={this.handleReset}
            style={{ width: '100%', maxWidth: 320 }}
          >
            Retry
          </button>
        </div>
      );
    }

    // variant === 'drawer' — original DrawerErrorBoundary UI
    const { onClose } = this.props;
    return (
      <>
        <div
          className="drawer-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          className="job-detail-sheet"
          role="dialog"
          aria-label="Error"
          aria-modal="true"
          style={{ padding: '24px 20px' }}
        >
          <div className="job-detail-sheet-handle" aria-hidden="true" />
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>Couldn&rsquo;t load job details</p>
            <p style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-label)', marginBottom: 20 }}>
              Something went wrong. Close and try again.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={onClose}
              style={{ width: '100%' }}
            >
              Close
            </button>
          </div>
        </div>
      </>
    );
  }
}
