// Receipt WhatsApp message builder — mirrors invoiceMessage.js conventions.
// A receipt is a paid-invoice confirmation: no bank details, no due date,
// just a thank-you with the paid amount + date.

/**
 * Derives the single best "paid on" date label for a job.
 *
 * Priority:
 *   1. Latest payment row in payments[] (most accurate — user recorded this)
 *   2. job.paidAt (set by Mark-paid path)
 *   3. Today's date (last resort — job is Paid but no date was captured)
 */
export function resolvePaidDate(job) {
  const payments = job?.payments;
  if (Array.isArray(payments) && payments.length > 0) {
    // Sort descending by date string (YYYY-MM-DD lexicographic sort is safe)
    const sorted = [...payments].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return sorted[0].date; // YYYY-MM-DD
  }
  if (job?.paidAt) {
    // ISO datetime from Mark-paid — slice to YYYY-MM-DD
    return job.paidAt.slice(0, 10);
  }
  // Fallback: today
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Total amount paid for the receipt. Uses payments[] sum when available;
 * falls back to job.amount (edge case: job marked paid without payment rows).
 */
export function resolveAmountPaid(job) {
  const payments = job?.payments;
  if (Array.isArray(payments) && payments.length > 0) {
    return payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }
  return Number(job?.total ?? job?.amount ?? 0) || 0;
}

/**
 * Format a YYYY-MM-DD or ISO datetime string to a human "1 Jun 2026" label.
 * Returns '' for falsy input.
 */
export function formatReceiptDate(raw) {
  if (!raw) return '';
  try {
    // YYYY-MM-DD: treat as local date to avoid UTC midnight offset
    const d = raw.length === 10 ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return raw;
  }
}

/**
 * Builds the WhatsApp receipt message.
 *
 * Parameters:
 *   job              – full job object
 *   biz              – business settings (name only; bank details are NOT included in receipts)
 *   hostedReceiptUrl – optional /r/<token> URL; when present the message LEADS with
 *                      "View your receipt: <url>" so the customer opens the branded
 *                      receipt page rather than reading plain text.
 *
 * Example output (with hostedReceiptUrl):
 *   Hi Sarah,
 *
 *   View your receipt: https://app.jobprofit.co.uk/r/<token>
 *
 *   Here's your receipt for: Replace kitchen taps
 *   Amount paid: £380.00
 *   Paid on: 1 Jun 2026
 *
 *   PAID IN FULL - thank you for your business.
 *
 *   Alan Plumbing Ltd
 */
export function buildReceiptWhatsAppMessage({ job, biz, hostedReceiptUrl = '' }) {
  const firstName = (job?.customer || job?.name || '').split(' ')[0] || 'there';
  const summary = (job?.summary || 'your job').slice(0, 200);
  const amountPaid = resolveAmountPaid(job);
  const paidDate = resolvePaidDate(job);
  const paidDateLabel = formatReceiptDate(paidDate);
  const bizName = biz?.name || '';

  const lines = [
    `Hi ${firstName},`,
    '',
  ];

  if (hostedReceiptUrl) {
    lines.push(`View your receipt: ${hostedReceiptUrl}`);
    lines.push('');
  }

  lines.push(
    `Here's your receipt for: ${summary}`,
    `Amount paid: £${amountPaid.toFixed(2)}`,
    `Paid on: ${paidDateLabel}`,
    '',
    'PAID IN FULL - thank you for your business.',
  );

  if (bizName) {
    lines.push('');
    lines.push(bizName);
  }

  return lines.join('\n');
}
