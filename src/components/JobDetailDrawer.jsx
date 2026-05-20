import { useState, useEffect } from 'react';
import PaymentSummaryBlock from './PaymentSummaryBlock';
import PaymentHistoryList from './PaymentHistoryList';
import RecordPaymentModal from './RecordPaymentModal';
import SendInvoiceModal from './SendInvoiceModal';
import {
  getChaseState,
  recordChase,
  buildChaseLink,
  computeTier,
  lastChasedLabel,
} from '../lib/chaseLadder';
import { computeBalance, computeAmountPaid } from '../lib/payments';
import { gbp } from '../lib/today';

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Derives the customer phone number from whichever field the job uses.
 * Returns an empty string when no phone is present.
 */
function resolvePhone(job) {
  return job.customerPhone || job.phone || job.mobile || job.whatsapp || '';
}

/**
 * Returns true when the "Chase customer" CTA should be visible.
 * Three gates must all pass: job is unpaid, outstanding > 0, phone exists.
 */
function shouldShowChase(job) {
  const paid =
    job.paid === true ||
    job.paymentStatus === 'paid' ||
    job.jobStatus === 'paid' ||
    job.status === 'paid';
  if (paid) return false;

  const outstanding = computeBalance(job);
  if (outstanding <= 0) return false;

  return !!resolvePhone(job);
}

/**
 * Derives how many days the invoice has been outstanding, defaulting to 0
 * when the job has no date (safe for buildChaseMessage).
 */
function daysSinceDue(job) {
  const raw = job.invoiceSentAt || job.invoiceDate || job.date;
  if (!raw) return 0;
  const due = new Date(raw);
  const diffMs = Date.now() - due.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Maps the job's status fields to the display badge used in the card list.
 * Mirrors deriveDisplayStatus in WorkScreen — kept inline so JobDetailDrawer
 * has no import from WorkScreen (no circular dep).
 */
function deriveStatus(job) {
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  if (job.invoiceStatus === 'invoiced' || job.status === 'invoice_sent') return 'Invoiced';
  if (job.jobStatus === 'complete' || job.status === 'complete') return 'Done';
  if (job.jobStatus === 'active' || job.status === 'active') return 'Active';
  return 'Quoted';
}

const STATUS_CLASS = {
  Quoted:   'status--quoted',
  Active:   'status--active',
  Done:     'status--done',
  Invoiced: 'status--invoiced',
  Paid:     'status--paid',
};

// ── Main component ────────────────────────────────────────────────────────

/**
 * JobDetailDrawer — bottom-sheet that slides up from the bottom of the screen.
 *
 * Pattern: backdrop + panel from the bottom, matching the mobile-first PWA
 * convention. Uses the same backdrop class as AccountDrawer but the panel
 * slides up rather than right (see .job-detail-sheet in index.css).
 *
 * Props:
 *   job           – full job object (required)
 *   biz           – business settings (name, bank, VAT) — needed for invoice generation
 *   profile       – Supabase profiles row or null — needed for paywall gating
 *   jobs          – all jobs array — needed by nextInvoiceNumber to avoid gaps
 *   onUpdateJob(updatedJob) – persists job field updates (sets invoiceSentAt etc.)
 *   onAddPayment(job, payload) – from AppShell, persists to jobMeta side-channel
 *   onClose()     – called when the sheet should close
 */
export default function JobDetailDrawer({
  job,
  biz,
  profile,
  jobs,
  onUpdateJob,
  onAddPayment,
  onClose,
}) {
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = deriveStatus(job);
  const statusClass = STATUS_CLASS[status] || '';
  const displayName = job.customer || job.name || 'Unnamed job';
  const amount = job.total ?? job.amount;
  const showChase = shouldShowChase(job);

  // Invoice send CTA gating:
  // - "Send invoice" when the job has never been invoiced (status not Invoiced/Paid,
  //   and invoiceSentAt is absent).
  // - "Resend invoice" (secondary link) when invoice was already sent.
  const invoiceAlreadySent =
    status === 'Invoiced' || status === 'Paid' ||
    !!job.invoiceSentAt || job.status === 'invoice_sent';
  const showSendInvoice = status !== 'Paid' && !invoiceAlreadySent;
  const showResendInvoice = status !== 'Paid' && invoiceAlreadySent;

  const chaseState = getChaseState(job.id);
  const tier = computeTier(chaseState);
  const chasedLabel = lastChasedLabel(chaseState);

  const handleChase = () => {
    const phone = resolvePhone(job);
    const outstanding = computeBalance(job);
    const amountPaid = computeAmountPaid(job);
    const link = buildChaseLink({
      phone,
      name: job.customer || job.name || '',
      amountOutstanding: gbp(outstanding),
      daysSinceDue: daysSinceDue(job),
      tier,
      amountPaid,
    });
    if (!link) return;
    recordChase(job.id);
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  // flash callback passed down to RecordPaymentModal so success toasts
  // appear in the drawer context rather than nowhere
  const showFlash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Bottom sheet panel */}
      <div
        className="job-detail-sheet"
        role="dialog"
        aria-label={`Job detail: ${displayName}`}
        aria-modal="true"
      >
        {/* Handle bar */}
        <div className="job-detail-sheet-handle" aria-hidden="true" />

        {/* Header row */}
        <div className="job-detail-header">
          <div className="job-detail-header-left">
            <span className={`job-status-pill ${statusClass}`}>{status[0]}</span>
            <div className="job-detail-title-block">
              <div className="job-detail-customer">{displayName}</div>
              {job.summary && (
                <div className="job-detail-summary">{job.summary}</div>
              )}
            </div>
          </div>
          <div className="job-detail-header-right">
            {typeof amount === 'number' && (
              <div className="job-detail-amount">
                {gbp(amount)}
              </div>
            )}
            <button
              className="job-detail-close"
              onClick={onClose}
              aria-label="Close job detail"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="job-detail-body">
          {/* Payment summary — self-gates; only renders when there's payment state */}
          <PaymentSummaryBlock
            job={job}
            onRecordPayment={() => setPaymentModalOpen(true)}
            onMarkAsPaid={() => {
              const balance = computeBalance(job);
              if (balance > 0) {
                onAddPayment(job, {
                  amount: balance,
                  date: new Date().toISOString().slice(0, 10),
                  method: 'unknown',
                  note: '',
                });
                showFlash('Job marked paid');
              }
            }}
          />

          {/* Primary CTA block — mutually exclusive based on invoice state */}
          {showSendInvoice && (
            <div className="job-detail-cta-row">
              <button
                type="button"
                className="btn-primary job-detail-cta-primary"
                onClick={() => setInvoiceModalOpen(true)}
              >
                Send invoice
              </button>
            </div>
          )}

          {/* Once invoice is sent: Record payment becomes the primary CTA */}
          {!showSendInvoice && status !== 'Paid' && (
            <div className="job-detail-cta-row">
              <button
                type="button"
                className="btn-primary job-detail-cta-primary"
                onClick={() => setPaymentModalOpen(true)}
              >
                Record payment
              </button>
            </div>
          )}

          {/* Resend invoice — secondary, only when invoice already sent and not paid */}
          {showResendInvoice && (
            <div className="job-detail-resend-row">
              <button
                type="button"
                className="btn-ghost job-detail-resend-btn"
                onClick={() => setInvoiceModalOpen(true)}
              >
                Resend invoice
              </button>
            </div>
          )}

          {/* Chase CTA — only when unpaid + outstanding > 0 + phone present */}
          {showChase && (
            <div className="job-detail-chase-row">
              <button
                type="button"
                className="btn-secondary job-detail-chase-btn"
                onClick={handleChase}
              >
                Chase customer
              </button>
              {chasedLabel && (
                <span className="job-detail-chased-label">{chasedLabel}</span>
              )}
            </div>
          )}

          {/* Payment history — self-gates when no payments */}
          <PaymentHistoryList job={job} />
        </div>

        {/* Toast */}
        {toast && (
          <div className="job-detail-toast" role="status">{toast}</div>
        )}
      </div>

      {/* RecordPaymentModal — rendered outside the sheet so it sits on top */}
      {paymentModalOpen && (
        <RecordPaymentModal
          job={job}
          onAddPayment={onAddPayment}
          onClose={() => setPaymentModalOpen(false)}
          flash={showFlash}
        />
      )}

      {/* SendInvoiceModal — rendered outside the sheet so it sits on top */}
      {invoiceModalOpen && (
        <SendInvoiceModal
          job={job}
          biz={biz ?? {}}
          profile={profile ?? null}
          jobs={jobs ?? []}
          onUpdate={onUpdateJob ?? (() => {})}
          onClose={() => setInvoiceModalOpen(false)}
          flash={showFlash}
        />
      )}
    </>
  );
}
