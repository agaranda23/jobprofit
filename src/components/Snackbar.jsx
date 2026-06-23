/**
 * Snackbar — single fixed-position renderer for the snackbar manager (JP-LU2).
 *
 * Reads the active descriptor from the useSnackbar() hook context and renders
 * ONE item at a time. Mount once inside AppShell.jsx just before </main>.
 *
 * Descriptor types and their rendered shapes:
 *   toast        — text + optional action button (e.g. "View" link)
 *   got-paid     — label + Cash/Bank/Card chip row + dismiss button
 *   realtime     — tap-to-navigate accepted/declined notification
 *   cost         — "add what this job cost you?" + "+ Add cost" button
 *   nudge        — pay-now soft prompt with "Set up" link
 *   nav          — one-time orientation text with dismiss X
 *
 * Props
 * ─────
 * active          — the head Descriptor from useSnackbar().active (or null)
 * onDismiss       — called with (id) when user taps dismiss or chip action fires
 * onTap           — called with (descriptor) on realtime tap (so AppShell can
 *                   setPendingJobId + navigate — keeps nav logic in AppShell)
 * onExpandCost    — called when "+ Add cost" is tapped (opens modal in AppShell)
 * onSetupPayNow   — called when "Set up" is tapped on nudge type
 * onCostDismiss   — called with (dismiss reason) when cost snackbar is dismissed
 * onGotPaidChip   — called with (job, method) when a chip is tapped
 */

import Icon from './Icon';

export default function Snackbar({
  active,
  onDismiss,
  onTap,
  onExpandCost,
  onSetupPayNow,
  onCostDismiss,
  onGotPaidChip,
}) {
  if (!active) return null;

  const { id, type, message, action, chips, job } = active;

  // ── nav / toast ──────────────────────────────────────────────────────────
  if (type === 'toast' || type === 'nav') {
    return (
      <div className={`snackbar snackbar--${type}`} role="status">
        <span className="snackbar__msg">{message}</span>
        {action && (
          <button
            type="button"
            className="snackbar__action"
            onClick={() => { onDismiss(id); action.onClick?.(); }}
          >
            {action.label}
          </button>
        )}
        {type === 'nav' && (
          <button
            type="button"
            className="snackbar__close"
            aria-label="Dismiss"
            onClick={() => onDismiss(id)}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
    );
  }

  // ── realtime (quote accepted / declined) ─────────────────────────────────
  if (type === 'realtime') {
    return (
      <div className="snackbar snackbar--realtime" role="status" aria-live="polite">
        <button
          type="button"
          className="snackbar__realtime-body"
          onClick={() => { onDismiss(id); onTap?.(active); }}
          aria-label={`${message} — tap to view job`}
        >
          <Icon name="complete" size={16} variant="success" className="snackbar__realtime-check" />
          {message}
        </button>
        <button
          type="button"
          className="snackbar__close"
          onClick={() => onDismiss(id)}
          aria-label="Dismiss"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }

  // ── got-paid (Speed-mode chip row) ────────────────────────────────────────
  if (type === 'got-paid') {
    const amtLabel = job?.amount != null ? ` £${job.amount}` : '';
    return (
      <div className="snackbar snackbar--got-paid" role="status" aria-live="polite">
        <span className="snackbar__got-paid-label">Got paid?{amtLabel}</span>
        <div className="snackbar__got-paid-chips">
          <button type="button" className="snackbar__got-paid-chip" onClick={() => { onDismiss(id); onGotPaidChip?.(job, 'cash'); }}>Cash</button>
          <button type="button" className="snackbar__got-paid-chip" onClick={() => { onDismiss(id); onGotPaidChip?.(job, 'bank transfer'); }}>Bank</button>
          <button type="button" className="snackbar__got-paid-chip" onClick={() => { onDismiss(id); onGotPaidChip?.(job, 'card'); }}>Card</button>
        </div>
        <button
          type="button"
          className="snackbar__close"
          aria-label="Dismiss"
          onClick={() => onDismiss(id)}
        >
          &times;
        </button>
      </div>
    );
  }

  // ── cost (post-paid cost-capture nudge) ───────────────────────────────────
  if (type === 'cost') {
    return (
      <div className="snackbar snackbar--cost" role="status" aria-live="polite">
        <span className="snackbar__cost-msg">
          Paid &#10003; &mdash; add what this job cost you?
        </span>
        <button
          type="button"
          className="snackbar__add-cost"
          onClick={() => onExpandCost?.(active)}
          aria-label="Add job cost"
        >
          + Add cost
        </button>
        <button
          type="button"
          className="snackbar__close"
          onClick={() => { onDismiss(id); onCostDismiss?.(id); }}
          aria-label="Dismiss"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }

  // ── nudge (pay-now soft prompt) ───────────────────────────────────────────
  if (type === 'nudge') {
    return (
      <div className="snackbar snackbar--nudge" role="status">
        <span className="snackbar__nudge-copy">
          Pay-now button available{' '}
          <button
            type="button"
            className="snackbar__nudge-setup"
            onClick={() => { onDismiss(id); onSetupPayNow?.(); }}
          >
            Set up
          </button>
        </span>
        <button
          type="button"
          className="snackbar__close"
          aria-label="Dismiss"
          onClick={() => onDismiss(id)}
        >
          &times;
        </button>
      </div>
    );
  }

  // ── chips (generic chip list, future use) ─────────────────────────────────
  if (type === 'chips' && Array.isArray(chips)) {
    return (
      <div className="snackbar snackbar--chips" role="status" aria-live="polite">
        <span className="snackbar__msg">{message}</span>
        <div className="snackbar__chips">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              className="snackbar__chip"
              onClick={() => { onDismiss(id); c.onClick?.(); }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button type="button" className="snackbar__close" aria-label="Dismiss" onClick={() => onDismiss(id)}>
          &times;
        </button>
      </div>
    );
  }

  return null;
}
