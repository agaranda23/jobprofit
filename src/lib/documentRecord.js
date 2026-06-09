// Pure helpers that derive display metadata for the Quotes and Invoices record
// accordions in JobDetailDrawer (Design 1, 2026-06).
//
// Both functions return { metaString, chipLabel, chipClass, state } where:
//   metaString  — collapsed one-liner shown in the CollapsedSectionRow meta prop
//   chipLabel   — text inside the status chip (empty string = no chip)
//   chipClass   — one of: 'neutral' | 'green' | 'amber' | 'rose' | 'muted' | ''
//   state       — machine state key, used by the UI to decide empty vs filled body

import { shouldShowPartPaidChip, formatPartPaidLabel } from './partPaidChip.js';
import { deriveDisplayStatus } from './jobStatus.js';

// ─── Internal date formatter ──────────────────────────────────────────────────
// Kept internal so both functions are unit-testable without injecting anything.
// Accepts ISO strings (with or without time component) and YYYY-MM-DD strings.
// Returns '' for falsy values.
function ddMmm(raw) {
  if (!raw) return '';
  try {
    const d = raw.length === 10 ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

// Returns true when the job has at least one line item or a non-zero total/amount.
function hasQuoteContent(job) {
  if (Array.isArray(job.lineItems) && job.lineItems.length > 0) return true;
  const t = Number(job.total ?? job.amount ?? 0);
  return t > 0;
}

// ─── Quote record ─────────────────────────────────────────────────────────────
/**
 * Derives display metadata for the Quotes record accordion.
 *
 * States (furthest-reached wins):
 *   'none'    — no quote content and no quoteSentAt
 *   'draft'   — has content but no quoteSentAt
 *   'sent'    — quoteSentAt set, not opened, not accepted
 *   'opened'  — quoteLinkOpenedAt set, not accepted
 *   'signed'  — acceptedAt set OR quoteStatus === 'accepted'
 *
 * @param {object} job
 * @returns {{ metaString: string, chipLabel: string, chipClass: string, state: string }}
 */
export function buildQuoteRecordMeta(job) {
  if (!job) return { metaString: 'None yet', chipLabel: '', chipClass: '', state: 'none' };

  const isSigned =
    !!job.acceptedAt || job.quoteStatus === 'accepted';

  if (isSigned) {
    const d = ddMmm(job.acceptedAt);
    return {
      metaString: d ? `Signed ${d}` : 'Signed',
      chipLabel: 'Signed',
      chipClass: 'green',
      state: 'signed',
    };
  }

  const isOpened = !!job.quoteLinkOpenedAt;
  if (isOpened) {
    const d = ddMmm(job.quoteLinkOpenedAt);
    return {
      metaString: d ? `Opened ${d}` : 'Opened',
      chipLabel: 'Opened',
      chipClass: 'neutral',
      state: 'opened',
    };
  }

  const isSent = !!job.quoteSentAt;
  if (isSent) {
    const d = ddMmm(job.quoteSentAt);
    return {
      metaString: d ? `Sent ${d}` : 'Sent',
      chipLabel: 'Sent',
      chipClass: 'neutral',
      state: 'sent',
    };
  }

  if (hasQuoteContent(job)) {
    return {
      metaString: 'Not sent',
      chipLabel: 'Draft',
      chipClass: 'muted',
      state: 'draft',
    };
  }

  return { metaString: 'None yet', chipLabel: '', chipClass: '', state: 'none' };
}

// ─── Invoice record ───────────────────────────────────────────────────────────
/**
 * Derives display metadata for the Invoices record accordion.
 *
 * States (highest-priority wins):
 *   'none'     — no invoiceSentAt
 *   'paid'     — paymentStatus === 'paid' OR paidAt set
 *   'part-paid'— shouldShowPartPaidChip returns true (Invoiced/Overdue stage, partial balance)
 *   'overdue'  — invoiceDueDate is in the past, not paid
 *   'due'      — invoiceDueDate is today or within 3 days, not paid
 *   'sent'     — invoiceSentAt set, none of the above
 *
 * @param {object} job
 * @returns {{ metaString: string, chipLabel: string, chipClass: string, state: string }}
 */
export function buildInvoiceRecordMeta(job) {
  if (!job) return { metaString: 'None yet', chipLabel: '', chipClass: '', state: 'none' };

  if (!job.invoiceSentAt) {
    return { metaString: 'None yet', chipLabel: '', chipClass: '', state: 'none' };
  }

  // Paid — checked first (highest priority)
  const isPaid =
    job.paymentStatus === 'paid' ||
    !!job.paidAt;
  if (isPaid) {
    const d = ddMmm(job.paidAt);
    return {
      metaString: d ? `Paid ${d}` : 'Paid',
      chipLabel: 'Paid',
      chipClass: 'green',
      state: 'paid',
    };
  }

  // Overdue / Due — only when invoiceDueDate is set
  if (job.invoiceDueDate) {
    const due = new Date(job.invoiceDueDate + 'T00:00:00');
    const now = new Date();
    // Normalise to start-of-day for comparison
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueStart   = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffDays   = Math.round((dueStart - todayStart) / 86400000);

    if (diffDays < 0) {
      // Past due date — check part-paid first (partial payment takes priority over overdue)
      const stage = deriveDisplayStatus(job);
      if (shouldShowPartPaidChip(job, stage)) {
        return {
          metaString: formatPartPaidLabel(job),
          chipLabel: 'Part paid',
          chipClass: 'amber',
          state: 'part-paid',
        };
      }
      const daysOver = Math.abs(diffDays);
      return {
        metaString: `Overdue · ${daysOver}d`,
        chipLabel: 'Overdue',
        chipClass: 'rose',
        state: 'overdue',
      };
    }

    if (diffDays <= 3) {
      // Due today or within 3 days — check part-paid first
      const stage = deriveDisplayStatus(job);
      if (shouldShowPartPaidChip(job, stage)) {
        return {
          metaString: formatPartPaidLabel(job),
          chipLabel: 'Part paid',
          chipClass: 'amber',
          state: 'part-paid',
        };
      }
      const d = ddMmm(job.invoiceDueDate);
      return {
        metaString: d ? `Due ${d}` : 'Due',
        chipLabel: 'Due',
        chipClass: 'amber',
        state: 'due',
      };
    }
  }

  // Part-paid — Invoiced stage without a due date (or due date well in future)
  const stage = deriveDisplayStatus(job);
  if (shouldShowPartPaidChip(job, stage)) {
    return {
      metaString: formatPartPaidLabel(job),
      chipLabel: 'Part paid',
      chipClass: 'amber',
      state: 'part-paid',
    };
  }

  // Sent — fallback
  const d = ddMmm(job.invoiceSentAt);
  return {
    metaString: d ? `Sent ${d}` : 'Sent',
    chipLabel: 'Sent',
    chipClass: 'neutral',
    state: 'sent',
  };
}
