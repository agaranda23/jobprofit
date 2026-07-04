/**
 * AccountantExportRangeSheet — period picker for the Xero/QuickBooks
 * accountant-pack export. Opens after the user picks "Xero" or "QuickBooks"
 * in ExportFormatSheet (Pro users only — non-Pro taps are intercepted before
 * this sheet ever opens, see AppShell's handleMoneyExportFormatPick).
 *
 * Reuses the pro-upgrade-overlay / pro-upgrade-sheet CSS classes for visual
 * consistency with ExportFormatSheet and ProUpgradeSheet.
 *
 * Props:
 *   open       — boolean
 *   platform   — 'xero' | 'quickbooks' — only used for the title/copy
 *   generating — boolean — disables the tiles + shows a "Preparing…" state
 *   onGenerate — (period: string, customStart?: string, customEnd?: string) => void
 *   onClose    — () => void
 */

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

const PRESETS = [
  { id: 'this_tax_year', label: 'This tax year', sublabel: '6 Apr — 5 Apr' },
  { id: 'last_tax_year', label: 'Last tax year', sublabel: 'The previous 6 Apr — 5 Apr' },
  { id: 'this_quarter', label: 'This quarter', sublabel: 'Current calendar quarter' },
];

const PLATFORM_LABEL = { xero: 'Xero', quickbooks: 'QuickBooks' };

export default function AccountantExportRangeSheet({ open, platform, generating = false, onGenerate, onClose }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Reset the custom-range form whenever the sheet transitions closed→open.
  // Done during render (React's recommended "adjusting state when a prop
  // changes" pattern) rather than in the effect below, so it doesn't trigger
  // a cascading setState-in-effect render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setCustomOpen(false);
      setCustomStart('');
      setCustomEnd('');
    }
  }

  const platformLabel = PLATFORM_LABEL[platform] || 'accountant';

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key === 'Tab' && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
        } else if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  const customValid = !!customStart && !!customEnd;

  return (
    <div
      className="pro-upgrade-overlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={sheetRef}
        className="pro-upgrade-sheet export-format-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Export for ${platformLabel}`}
      >
        <button ref={closeRef} type="button" className="pro-upgrade-sheet__close" aria-label="Close" onClick={() => onClose?.()}>
          &times;
        </button>

        <div className="export-format-sheet__header">
          <p className="export-format-sheet__title">Export for {platformLabel}</p>
          <p className="export-format-sheet__subtitle">
            Pick a period. We'll build a {platformLabel}-ready ZIP of CSV files for your accountant to import.
          </p>
        </div>

        <div className="export-format-sheet__options" role="list">
          {PRESETS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="export-format-sheet__option"
              role="listitem"
              disabled={generating}
              onClick={() => onGenerate?.(opt.id)}
            >
              <span className="export-format-sheet__option-icon" aria-hidden="true">
                <Icon name="date" size={20} />
              </span>
              <span className="export-format-sheet__option-text">
                <span className="export-format-sheet__option-label">{opt.label}</span>
                <span className="export-format-sheet__option-sublabel">{opt.sublabel}</span>
              </span>
              <span className="export-format-sheet__option-chevron" aria-hidden="true">›</span>
            </button>
          ))}

          <button
            type="button"
            className="export-format-sheet__option"
            role="listitem"
            disabled={generating}
            onClick={() => setCustomOpen(v => !v)}
          >
            <span className="export-format-sheet__option-icon" aria-hidden="true">
              <Icon name="filter" size={20} />
            </span>
            <span className="export-format-sheet__option-text">
              <span className="export-format-sheet__option-label">Custom range</span>
              <span className="export-format-sheet__option-sublabel">Pick your own start/end dates</span>
            </span>
            <span className="export-format-sheet__option-chevron" aria-hidden="true">{customOpen ? '⌄' : '›'}</span>
          </button>

          {customOpen && (
            <div className="export-format-sheet__custom-range">
              <label className="export-format-sheet__custom-field">
                <span>From</span>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} disabled={generating} />
              </label>
              <label className="export-format-sheet__custom-field">
                <span>To</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} disabled={generating} />
              </label>
              <button
                type="button"
                className="export-format-sheet__custom-generate"
                disabled={!customValid || generating}
                onClick={() => onGenerate?.('custom', customStart, customEnd)}
              >
                {generating ? 'Preparing…' : 'Generate'}
              </button>
            </div>
          )}
        </div>

        <button type="button" className="export-format-sheet__cancel" onClick={() => onClose?.()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
