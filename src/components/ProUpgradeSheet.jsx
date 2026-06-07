/**
 * ProUpgradeSheet — the "why upgrade" sales surface.
 *
 * Opens from every upgrade tap across the app:
 *   - UpgradeBanner ("Start free trial" on Money tab)    → trigger='upgrade_banner'
 *   - ProGate lock badge on Insight cards                → trigger='insight_locked'
 *   - Today GetProPill                                   → trigger='today_pill'
 *   - Settings → Subscription → Upgrade to Pro row      → trigger='settings'
 *   - TrialBanner → startCheckout() direct (no sheet)
 *   - White-label nudge in SendInvoiceModal              → trigger='whitelabel_footer'
 *   - Auto-chase locked row in Settings                  → trigger='auto_chase_locked'
 *
 * The sheet fires upgrade_sheet_viewed on open (with trigger) and
 * checkout_started on CTA tap (with the same trigger), forming the
 * attribution chain that feeds subscription_active.last_trigger.
 *
 * Props:
 *   open    — boolean, controls visibility
 *   trigger — string from UPGRADE_TRIGGERS enum; defaults to 'settings'
 *   onClose — called when the sheet should close (ESC, overlay tap, "Maybe later")
 *
 * @deprecated prop `source` is accepted as a fallback alias for `trigger` so
 *   existing callers keep working during the migration — remove by 2026-Q3.
 */

import { useEffect, useRef } from 'react';
import { startCheckout } from '../lib/billing';
import { logTelemetry, setLastUpgradeTrigger, UPGRADE_TRIGGERS } from '../lib/telemetry';

const FEATURES = [
  { label: 'White-label documents', sub: 'remove "Sent with JobProfit" — your brand only on every quote, invoice & receipt' },
  { label: 'Auto-chase ladder', sub: 'polite nudge → firm reminder → final notice — Pro automates the escalation' },
  { label: 'True profit after your monthly bills', sub: 'see what you actually make, not just what came in' },
  { label: 'Tax pot (year-to-date)', sub: 'keep enough back for the taxman, all year' },
  { label: 'Est. Profit/Hour', sub: 'know if your time is actually worth it' },
  { label: 'Best & worst jobs', sub: 'stop taking work that loses you money' },
  { label: 'Margin nudges', sub: 'get told when your margin slipped this week' },
  { label: 'Tax pot reminder on Today', sub: 'every day you open the app' },
  { label: 'VAT this quarter', sub: 'what to set aside for HMRC if VAT-registered' },
  { label: 'AI quote builder', sub: 'describe the job, get a costed quote in seconds' },
];

const COMPETITORS = [
  { name: 'JobProfit Pro', price: '£12/mo', highlight: true },
  { name: 'Tradify Lite', price: '£34/user/mo', highlight: false },
  { name: 'ServiceM8', price: '~£24/user/mo', highlight: false },
];

export default function ProUpgradeSheet({ open, trigger: triggerProp, source: sourceProp, onClose }) {
  // Accept either `trigger` (new) or `source` (legacy alias) so old callers keep working.
  const trigger = triggerProp ?? sourceProp ?? UPGRADE_TRIGGERS.SETTINGS;

  const sheetRef = useRef(null);
  const closeRef = useRef(null);

  // Fire upgrade_sheet_viewed on open and persist the trigger for the
  // checkout_started → subscription_active attribution chain.
  useEffect(() => {
    if (!open) return;
    setLastUpgradeTrigger(trigger);
    logTelemetry('upgrade_sheet_viewed', { trigger });
  }, [open, trigger]);

  // Focus trap + ESC close
  useEffect(() => {
    if (!open) return;

    // Move focus to the close button when the sheet opens
    const frame = requestAnimationFrame(() => {
      closeRef.current?.focus();
    });

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }

      // Tab trap: cycle within the sheet
      if (e.key === 'Tab' && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  // Prevent body scroll while sheet is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  const handleUpgrade = async () => {
    // checkout_started carries the same trigger as upgrade_sheet_viewed so
    // PostHog can funnel: sheet_viewed → checkout_started → subscription_active.
    // setLastUpgradeTrigger was already called on open; call again here in case
    // the user somehow reaches this handler without the open effect having fired.
    setLastUpgradeTrigger(trigger);
    logTelemetry('checkout_started', { trigger });
    const { error } = await startCheckout();
    if (error) {
      // startCheckout redirects on success; on error show it briefly
      // (no toast infrastructure here — log only, UX-safe)
      console.warn('ProUpgradeSheet: checkout error', error);
    }
  };

  return (
    <div
      className="pro-upgrade-overlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={sheetRef}
        className="pro-upgrade-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Upgrade to JobProfit Pro"
      >
        {/* Close button (top-right) */}
        <button
          ref={closeRef}
          type="button"
          className="pro-upgrade-sheet__close"
          aria-label="Close"
          onClick={onClose}
        >
          &times;
        </button>

        {/* 1. Header */}
        <div className="pro-upgrade-sheet__header">
          <div className="pro-upgrade-sheet__title">JobProfit Pro</div>
          <div className="pro-upgrade-sheet__price">£12<span className="pro-upgrade-sheet__price-period">/month</span></div>
          <div className="pro-upgrade-sheet__trust">14-day free trial &middot; no card needed &middot; cancel anytime</div>
        </div>

        {/* 2. Price comparison wedge */}
        <div className="pro-upgrade-sheet__wedge">
          <div className="pro-upgrade-sheet__wedge-rows">
            {COMPETITORS.map((c) => (
              <div
                key={c.name}
                className={`pro-upgrade-sheet__wedge-row${c.highlight ? ' pro-upgrade-sheet__wedge-row--highlight' : ''}`}
              >
                <span className="pro-upgrade-sheet__wedge-name">{c.name}</span>
                <span className="pro-upgrade-sheet__wedge-price">{c.price}</span>
              </div>
            ))}
          </div>
          <div className="pro-upgrade-sheet__wedge-caption">Same loop. A third of the price.</div>
        </div>

        {/* 3. Feature list */}
        <ul className="pro-upgrade-sheet__features" aria-label="What you unlock with Pro">
          {FEATURES.map((f) => (
            <li key={f.label} className="pro-upgrade-sheet__feature">
              <span className="pro-upgrade-sheet__feature-tick" aria-hidden="true">&#10003;</span>
              <span className="pro-upgrade-sheet__feature-body">
                <span className="pro-upgrade-sheet__feature-label">{f.label}</span>
                <span className="pro-upgrade-sheet__feature-sub"> &mdash; {f.sub}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* 4. Trust line */}
        <p className="pro-upgrade-sheet__trust-line">
          Built for UK sole traders &amp; small crews. Mobile-first. WhatsApp send. MTD-aware.
        </p>

        {/* 5. Primary CTA */}
        <button
          type="button"
          className="pro-upgrade-sheet__cta"
          onClick={handleUpgrade}
        >
          Start 14-day free trial &mdash; no card
        </button>

        {/* 6. Secondary dismiss */}
        <button
          type="button"
          className="pro-upgrade-sheet__maybe-later"
          onClick={onClose}
        >
          Maybe later
        </button>

        {/* 7. Footer */}
        <p className="pro-upgrade-sheet__footer">
          £12/month after trial. Cancel anytime in Settings.
        </p>
      </div>
    </div>
  );
}
