// WhatsApp invoice text + wa.me link builder for the new Get Paid flow.
// Distinct from the legacy waInvoiceLink in App.jsx (which uses the old
// `invoices` collection). This one reads directly from the job + biz.
//
// Tone refresh (2026-07-03): warmer greeting + a single "Invoice · Job ·
// Amount due · Due" summary line. The hosted-link CTA, VAT-inclusive amount,
// partial-payment Received/Balance block, Stripe pay-by-card line, and bank
// transfer block are all unchanged by this pass — only the surrounding
// copy/structure moved.

import { splitVatInclusive } from './vatUtils.js';

const WA_URL_LIMIT = 2000; // wa.me practical URL cap; truncate long summaries

/**
 * Builds the WhatsApp invoice message.
 *
 * @param {object} args
 * @param {object} args.job
 * @param {object} args.biz
 * @param {string} args.invoiceNumber
 * @param {string} args.dueDate
 * @param {string} [args.hostedInvoiceUrl] — when set, prepends "View & pay your invoice: <url>"
 *   as the primary CTA so the customer opens the hosted invoice page rather than reading
 *   a plain-text message. The rest of the message follows as context. Falls back cleanly
 *   when empty/absent (old behaviour — text-only message).
 */
export function buildInvoiceWhatsAppMessage({ job, biz, invoiceNumber, dueDate, hostedInvoiceUrl = '' }) {
  const customer = (job?.customer || job?.customerName || '').split(' ')[0] || '';
  const total = job?.total ?? job?.amount ?? 0;
  const showVat = !!biz?.vatRegistered;
  // Prices entered in the app are VAT-INCLUSIVE (gross). When the trader is
  // VAT-registered we derive the VAT portion from the gross; we never add VAT
  // on top. Non-registered traders: grossTotal = total, no VAT line shown.
  const grossTotal = showVat ? splitVatInclusive(total).gross : total;
  const dueStr = new Date(dueDate).toLocaleDateString('en-GB');
  const summary = (job?.summary || 'Work completed').slice(0, 200);
  const stripeLink = biz?.stripePaymentLink || biz?.stripe_payment_link || '';

  // Partial payments: if any amount has been received, show Received + Balance
  // so the customer is never chased for the full gross when a deposit was paid.
  const payments = Array.isArray(job?.payments) ? job.payments : [];
  const amountPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const balance = grossTotal - amountPaid;
  const showPartialBlock = amountPaid > 0;

  const lines = [`Hi ${customer} 👋`, '', 'Thanks again for choosing us. Your invoice is ready.', ''];

  // Hosted invoice link — the headline CTA when available.
  // The customer taps this to see the full branded document + pay by card.
  // We keep the key facts (amount, due date) in the text so the message is
  // useful even if the link is not tapped (e.g. previewed as plain text).
  if (hostedInvoiceUrl) {
    lines.push(`View & pay your invoice: ${hostedInvoiceUrl}`);
    lines.push('');
  }

  lines.push(
    `Invoice: ${invoiceNumber} · Job: ${summary} · Amount due: £${grossTotal.toFixed(2)}${showVat ? ' (inc VAT)' : ''} · Due: ${dueStr}`,
    ...(showPartialBlock ? [
      `Received: £${amountPaid.toFixed(2)}`,
      `Balance: £${balance.toFixed(2)}`,
    ] : []),
    '',
  );

  // Pay-by-card block — shown only when a static Stripe Payment Link is set
  // AND no hosted invoice URL is present (avoid duplicating the pay CTA).
  if (stripeLink && !hostedInvoiceUrl) {
    lines.push(`Pay by card: ${stripeLink}`);
    lines.push('');
  }

  // Bank transfer header — relabelled to "Or by bank transfer:" when card option
  // is present so the two payment methods read as clear alternatives.
  const hasCardOption = (stripeLink && !hostedInvoiceUrl) || !!hostedInvoiceUrl;
  const bankHeader = hasCardOption ? 'Or by bank transfer:' : 'Bank details:';

  if (biz?.accountName || biz?.sortCode || biz?.accountNumber) {
    lines.push(bankHeader);
    if (biz.accountName) lines.push(`Name: ${biz.accountName}`);
    if (biz.sortCode) lines.push(`Sort code: ${biz.sortCode}`);
    if (biz.accountNumber) lines.push(`Account: ${biz.accountNumber}`);
    lines.push('');
  } else if (biz?.bankDetails) {
    lines.push(bankHeader);
    lines.push(biz.bankDetails);
    lines.push('');
  }

  lines.push(`Reference: ${invoiceNumber}`);
  lines.push('', 'Thanks!');
  // Omit the sign-off line entirely (not just leave it blank) when no
  // business name is set — avoids a dangling empty last line.
  if (biz?.name) lines.push(biz.name);

  return lines.join('\n');
}

/**
 * Builds a post-paid WhatsApp review-request message.
 * Sent via the PostPaidSheet "Leave a Google review" CTA after a job is marked paid.
 * PostPaidSheet only shows that CTA when biz.google_review_link is set (hasReviewLink
 * gate) — this builder still degrades cleanly (omits the link line) if called without one.
 *
 * @param {object} args
 * @param {object} args.job  — the paid job (customer, customerName)
 * @param {object} args.biz  — the trader's profile (google_review_link, name, business_name, trading_name)
 */
export function buildReviewRequestWhatsAppMessage({ job, biz }) {
  const firstName = (job?.customer || job?.customerName || '').split(' ')[0] || '';
  const reviewLink = biz?.google_review_link || '';
  const bizName = biz?.name || biz?.business_name || biz?.trading_name || '';
  const lines = [];
  lines.push(firstName ? `Hi ${firstName} 👋` : 'Hi 👋');
  lines.push('');
  lines.push("Thanks so much for your payment — it was a pleasure working with you. If you've got 30 seconds, we'd really appreciate a review:");
  if (reviewLink) { lines.push(''); lines.push(`⭐ ${reviewLink}`); }
  lines.push('');
  lines.push('Thanks!');
  if (bizName) lines.push(bizName); // omit blank sign-off line when business name unset
  return lines.join('\n');
}

// Normalises a UK phone number for wa.me. Strips spaces, replaces a leading
// 0 with the UK country code 44, and drops a leading +. Returns '' if no
// usable digits — wa.me will then open with no recipient (acceptable
// degradation per PRD).
export function buildWhatsAppLink({ phone, message }) {
  const cleanPhone = (phone || '').replace(/\s/g, '').replace(/^0/, '44').replace(/^\+/, '');
  const link = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  if (link.length > WA_URL_LIMIT) {
    // Encoded message is too long; rare with our ~200-char summary cap, but
    // safe-guard against huge bank details blobs by trimming the message.
    const baseLen = `https://wa.me/${cleanPhone}?text=`.length;
    const room = WA_URL_LIMIT - baseLen;
    const truncated = encodeURIComponent(message).slice(0, room);
    return `https://wa.me/${cleanPhone}?text=${truncated}`;
  }
  return link;
}
