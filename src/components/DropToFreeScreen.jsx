/**
 * DropToFreeScreen — Moment-2: shown ONCE on the first app-open after the trial
 * expires, BEFORE plan='free' is written to the DB.
 *
 * This is the "honesty fix": today flipExpiredTrialToFree flips silently, which
 * means a user could send an invoice with a surprise footer before being told.
 * This screen fires first, explains what changed, then AppShell flips the plan
 * and marks drop_to_free_seen after the user dismisses it.
 *
 * Render rules:
 *   - Full-screen overlay (not a bottom sheet) — this is a plan-change event,
 *     not a feature pitch. No close button in the corner — user must tap a CTA.
 *   - "Go Pro — £12/month" → startCheckoutImmediate (no coupon, charged today)
 *   - "Stay on free" → onDismiss callback (AppShell flips plan + marks seen)
 *
 * Props:
 *   onDismiss      — called when user taps "Stay on free"; AppShell owns the
 *                    plan-flip + mark-seen side-effects so this stays pure UI.
 *   onUpgrade      — called when user taps "Go Pro"; caller fires checkout.
 *   upgradeLoading — boolean, disables the upgrade CTA while checkout is pending.
 *   upgradeError   — string | null, shown under the CTA on checkout failure.
 */

import { useEffect, useRef } from 'react';
import { logTelemetry, UPGRADE_TRIGGERS } from '../lib/telemetry.js';

const KEEP_ITEMS = [
  'Unlimited quotes, invoices & receipts',
  'Get paid straight from your phone',
  'WhatsApp send & signature on acceptance',
  'Everything you\'ve already created stays exactly as it is',
];

const LOSE_ITEMS = [
  'Auto-chase — you\'ll chase late payers by hand again',
  'True profit, tax pot & profit/hour — the Insight Layer',
  'Your name only on documents (see below)',
];

export default function DropToFreeScreen({
  onDismiss,
  onUpgrade,
  upgradeLoading = false,
  upgradeError = null,
}) {
  const upgradeRef = useRef(null);

  // Focus the upgrade CTA on mount so one-handed use doesn't need to hunt.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      upgradeRef.current?.focus();
    });
    logTelemetry('drop_to_free_viewed', { trigger: UPGRADE_TRIGGERS.DROP_TO_FREE });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Lock body scroll while this screen is visible.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleUpgrade = () => {
    logTelemetry('drop_to_free_upgrade_clicked', { trigger: UPGRADE_TRIGGERS.DROP_TO_FREE });
    onUpgrade?.();
  };

  const handleDismiss = () => {
    logTelemetry('drop_to_free_dismissed', { trigger: UPGRADE_TRIGGERS.DROP_TO_FREE });
    onDismiss?.();
  };

  return (
    <div
      className="drop-to-free-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Your free Pro trial has ended"
    >
      <div className="drop-to-free-screen">
        <div className="drop-to-free-scroll">

          {/* Headline */}
          <h1 className="drop-to-free-headline">Your free Pro trial has ended</h1>

          {/* Sub */}
          <p className="drop-to-free-sub">
            You&rsquo;re on the free plan now. The important bit doesn&rsquo;t change: quotes, invoices, receipts, getting paid &mdash; still unlimited, still free, forever.
          </p>

          {/* Keep block */}
          <div className="drop-to-free-block drop-to-free-block--keep">
            <div className="drop-to-free-block-title">You keep &mdash; free, forever</div>
            <ul className="drop-to-free-list" aria-label="What you keep">
              {KEEP_ITEMS.map((item) => (
                <li key={item} className="drop-to-free-item drop-to-free-item--keep">
                  <span className="drop-to-free-item-icon" aria-hidden="true">&#10003;</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Lose block */}
          <div className="drop-to-free-block drop-to-free-block--lose">
            <div className="drop-to-free-block-title">Pro is paused</div>
            <ul className="drop-to-free-list" aria-label="What is paused">
              {LOSE_ITEMS.map((item) => (
                <li key={item} className="drop-to-free-item drop-to-free-item--lose">
                  <span className="drop-to-free-item-icon" aria-hidden="true">&#9675;</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer note */}
          <div className="drop-to-free-footer-note">
            <div className="drop-to-free-footer-note-title">One thing to know</div>
            <p className="drop-to-free-footer-note-body">
              From now on, new quotes and invoices show a small &ldquo;Sent with OHNAR&rdquo; line at the bottom. Your existing documents don&rsquo;t change. Go Pro any time to remove it and put only your name on your work.
            </p>
          </div>

          {/* Primary CTA */}
          <button
            ref={upgradeRef}
            type="button"
            className="drop-to-free-cta drop-to-free-cta--upgrade"
            onClick={handleUpgrade}
            disabled={upgradeLoading}
          >
            {upgradeLoading ? 'Opening checkout…' : 'Go Pro — £12/month'}
          </button>

          {/* LEG SLOT 2 — verbatim compliance disclosure under "Go Pro" */}
          <p className="drop-to-free-legal">
            &pound;12/month, charged today then monthly. Cancel anytime in two taps from Settings &mdash; effective straight away, no phone call or email needed.
          </p>

          {upgradeError && (
            <p className="drop-to-free-error" role="alert">{upgradeError}</p>
          )}

          {/* Secondary dismiss */}
          <button
            type="button"
            className="drop-to-free-cta drop-to-free-cta--dismiss"
            onClick={handleDismiss}
          >
            Stay on free
          </button>

        </div>
      </div>
    </div>
  );
}
