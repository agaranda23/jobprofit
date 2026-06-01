/**
 * ProUpgradeSheet — the "why upgrade" sales surface.
 *
 * Opens from every upgrade tap across the app:
 *   - UpgradeBanner ("Start free trial" on Money tab)
 *   - ProGate lock badge
 *   - Today GetProPill
 *   - Settings → Subscription → Upgrade to Pro row
 *
 * The sheet presents the value proposition and has a single primary CTA
 * that calls startCheckout() to begin the Stripe Checkout flow.
 *
 * Props:
 *   open    — boolean, controls visibility
 *   source  — string for telemetry: 'today_pill' | 'progate' | 'upgrade_banner' | 'settings'
 *   onClose — called when the sheet should close (ESC, overlay tap, "Maybe later")
 */

import { useEffect, useRef } from 'react';
import { startCheckout } from '../lib/billing';
import { logTelemetry } from '../lib/telemetry';

const FEATURES = [
  { label: 'True Profit after overhead', sub: 'see what you actually make, not just what came in' },
  { label: 'Tax pot (year-to-date)', sub: 'keep enough back for the taxman, all year' },
  { label: 'Est. Profit/Hour', sub: 'know if your time is actually worth it' },
  { label: 'Best & worst jobs', sub: 'stop taking work that loses you money' },
  { label: 'Margin nudges', sub: 'get told when your margin slipped this week' },
  { label: 'Cashflow Profit-vs-Cost view', sub: 'the trend that matters' },
  { label: 'Tax pot reminder on Today', sub: 'every day you open the app' },
  { label: 'VAT this quarter', sub: 'what to set aside for HMRC if VAT-registered' },
  { label: 'Automatic chase ladder', sub: 'late invoices chased so you don\'t have to' },
  { label: 'Unlimited invoices', sub: 'vs 3/month on free' },
];

const COMPETITORS = [
  { name: 'JobProfit Pro', price: '£12/mo', highlight: true },
  { name: 'Tradify Lite', price: '£34/user/mo', highlight: false },
  { name: 'ServiceM8', price: '~£24/user/mo', highlight: false },
];

export default function ProUpgradeSheet({ open, source = 'unknown', onClose }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);

  // Fire telemetry on open
  useEffect(() => {
    if (!open) return;
    logTelemetry('pro_upsell_sheet_viewed', { source });
  }, [open, source]);

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
    logTelemetry('upgrade_clicked', { source });
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
