import React from 'react';

/**
 * DrawerErrorBoundary — wraps JobDetailDrawer so a render crash shows a tappable
 * fallback instead of a blank white screen.
 *
 * Resets automatically when the `jobId` key changes (user opens a different job).
 * This is intentional: the drawer is keyed by jobId in WorkScreen so switching
 * jobs always mounts a fresh boundary with no prior error state.
 *
 * Background: React error boundaries must be class components — there is no
 * hook equivalent. This is the minimal implementation; no logging service is
 * wired yet (follow-up: add logTelemetry on componentDidCatch).
 */
export default class DrawerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // TODO (follow-up): wire to logTelemetry when that module is available server-side
    console.error('[DrawerErrorBoundary] render error', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
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
              <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 20 }}>
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
    return this.props.children;
  }
}
