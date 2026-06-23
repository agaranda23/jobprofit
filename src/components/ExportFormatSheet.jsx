/**
 * ExportFormatSheet — bottom sheet for choosing CSV or PDF export format.
 *
 * Reuses the pro-upgrade-overlay / pro-upgrade-sheet CSS classes so the
 * animation, backdrop, and sizing are consistent with other sheets in the app.
 *
 * Props:
 *   open       — boolean
 *   title      — string, e.g. "Export records" or "Export everything"
 *   subtitle   — string shown below the title
 *   options    — [{ id, icon, label, sublabel }] — rendered in order
 *   onPick     — (id: string) => void — called when an option tile is tapped
 *   onClose    — () => void
 *
 * Mobile-first: each option tile is min 56px tall with a large tap target.
 * ESC and backdrop tap both close the sheet.
 */

import { useEffect, useRef } from 'react';
import Icon from './Icon';

export default function ExportFormatSheet({ open, title, subtitle, options = [], onPick, onClose }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);

  // Focus trap + ESC close
  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      closeRef.current?.focus();
    });

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
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

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

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
        aria-label={title}
      >
        {/* Close button */}
        <button
          ref={closeRef}
          type="button"
          className="pro-upgrade-sheet__close"
          aria-label="Close"
          onClick={() => onClose?.()}
        >
          &times;
        </button>

        {/* Header */}
        <div className="export-format-sheet__header">
          <p className="export-format-sheet__title">{title}</p>
          {subtitle && <p className="export-format-sheet__subtitle">{subtitle}</p>}
        </div>

        {/* Option tiles */}
        <div className="export-format-sheet__options" role="list">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="export-format-sheet__option"
              role="listitem"
              onClick={() => onPick?.(opt.id)}
            >
              {opt.icon && (
                <span className="export-format-sheet__option-icon" aria-hidden="true">
                  <Icon name={opt.icon} size={20} />
                </span>
              )}
              <span className="export-format-sheet__option-text">
                <span className="export-format-sheet__option-label">{opt.label}</span>
                {opt.sublabel && (
                  <span className="export-format-sheet__option-sublabel">{opt.sublabel}</span>
                )}
              </span>
              <span className="export-format-sheet__option-chevron" aria-hidden="true">›</span>
            </button>
          ))}
        </div>

        {/* Cancel */}
        <button
          type="button"
          className="export-format-sheet__cancel"
          onClick={() => onClose?.()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
