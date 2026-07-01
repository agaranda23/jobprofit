/**
 * PostPaidSheet — bottom sheet shown after the PaidCelebration overlay auto-dismisses.
 *
 * Props:
 *   active              — boolean; true = visible (must be false while PaidCelebration is showing)
 *   job                 — the job that was just marked paid
 *   profile             — trader's Supabase profiles row
 *   onClose             — called when the sheet should close (ESC, backdrop tap, dismiss button)
 *   onBookAgain(p)      — called with { customer, phone, address } to pre-fill AddJobModal
 *   onGoToReviewSettings — called to navigate to Settings > Invoices & Quotes review-link row
 *
 * iOS PWA note: WhatsApp links use window.open(..., '_blank', 'noopener') to match
 * the existing "Chase on WhatsApp" pattern in JobDetailDrawer. Using <a target="_blank">
 * would eject the iOS standalone PWA into Safari — never do that here.
 */

import { useEffect } from 'react';
import { buildWhatsAppLink, buildReviewRequestWhatsAppMessage } from '../lib/invoiceMessage.js';

// ── PostPaidSheet ─────────────────────────────────────────────────────────────

export default function PostPaidSheet({ active, job, profile, onClose, onBookAgain, onGoToReviewSettings }) {
  // ── Hooks zone — ALL hooks above the early return ────────────────────────────

  // ESC key dismisses the sheet.
  useEffect(() => {
    if (!active) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [active, onClose]);

  // Prevent body scroll and disable swipe pager while sheet is open.
  useEffect(() => {
    if (!active) return;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('overlay-open');
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('overlay-open');
    };
  }, [active]);

  // ── Early return guard (after all hooks) ─────────────────────────────────────
  if (!active) return null;

  const hasReviewLink = !!(profile?.google_review_link?.trim());
  const customerFirstName = (job?.customer || '').split(' ')[0] || '';
  const bookLabel = customerFirstName ? `Book ${customerFirstName} again` : 'Book again';

  const handleReviewClick = () => {
    const message = buildReviewRequestWhatsAppMessage({ job, biz: profile });
    const link = buildWhatsAppLink({ phone: job?.phone, message });
    // window.open with '_blank' + noopener matches the existing WhatsApp pattern
    // used throughout the app (JobDetailDrawer, WorkScreen chase bar).
    // Do NOT use <a target="_blank"> — it ejects iOS PWA standalone mode into Safari.
    window.open(link, '_blank', 'noopener');
  };

  const handleBookAgain = () => {
    onBookAgain?.({
      customer: job?.customer || '',
      phone: job?.phone || '',
      address: job?.address || '',
    });
    onClose?.();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      data-testid="post-paid-sheet"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className="modal post-paid-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-paid-sheet-title"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'calc(1.5rem + var(--kb-inset, 0px))' }}
      >
        {/* Header row */}
        <div className="post-paid-sheet__header">
          <h2 id="post-paid-sheet-title" className="modal-title" style={{ margin: 0 }}>
            What&rsquo;s next?
          </h2>
          <button
            type="button"
            className="post-paid-sheet__dismiss"
            aria-label="Dismiss"
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* CTA stack */}
        <div className="post-paid-sheet__ctas">
          {hasReviewLink ? (
            <button
              type="button"
              className="btn-primary post-paid-sheet__btn"
              data-testid="review-button"
              onClick={handleReviewClick}
            >
              Leave a Google review
            </button>
          ) : (
            <button
              type="button"
              className="post-paid-sheet__nudge"
              data-testid="review-link-nudge"
              onClick={onGoToReviewSettings}
            >
              <span className="post-paid-sheet__nudge-headline">Get more 5-star reviews</span>
              <span className="post-paid-sheet__nudge-sub">Set your review link &rarr;</span>
            </button>
          )}

          <button
            type="button"
            className="btn-primary post-paid-sheet__btn"
            data-testid="book-again-button"
            onClick={handleBookAgain}
          >
            {bookLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
