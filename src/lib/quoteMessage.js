// WhatsApp quote-link text builder for the "Send quote link" flow.
// Lighter than invoiceMessage.js — still a pre-work quote, not a payment
// request — but VAT and a deposit due-date are now shown when present,
// matching the invoice message's minimal presentation:
//
//   VAT: prices are VAT-inclusive (gross); we never add VAT on top, only
//   disclose "(inc VAT)" on the total line — same treatment as
//   invoiceMessage.js. Triggered by the trader's VAT-registration setting
//   OR this specific quote being voice-captured as "plus/inc VAT"
//   (job.vat, set by AddJobModal's buildQuotePayload from voiceParse's
//   `vat` field). The full subtotal/VAT/total breakdown lives on the PDF
//   (generateQuotePDF → drawSummaryBlock), not this message.
//
//   Deposit due-date: job.deposit_due_date (set by sendQuote.js from the
//   voice-quote confirm card's depositDue) is appended to whichever deposit
//   line renders below.
//
// Two deposit paths (V1):
//   depositPayUrl set  (Pro + Stripe) → Stripe pay link appended (existing behaviour)
//   bank details set + deposit_percent > 0 + no depositPayUrl → bank transfer block appended
//
// The bank block reads name/sort/account from biz (same fields as invoiceMessage.js).

import { splitVatInclusive } from './vatUtils.js';
import { formatToday } from './today.js';

/**
 * @param {{ job: object, biz: object, quoteUrl: string, depositPayUrl?: string }} params
 *   depositPayUrl — the /p/<token> URL for the deposit Checkout Session.
 *   When set (trader connected + deposit_percent > 0), appended as a separate
 *   tappable line above the main quote link so the customer can pay the deposit
 *   from the WhatsApp message without opening the quote page first.
 *   When absent or empty AND bank details are present AND deposit_percent > 0,
 *   a bank-transfer deposit block is appended instead.
 */
export function buildQuoteWhatsAppMessage({ job, biz, quoteUrl, depositPayUrl = '' }) {
  const firstName = (job?.customer || job?.customerName || '').split(' ')[0] || '';
  const summary = (job?.summary || job?.name || 'your job').slice(0, 200);
  const total = job?.total ?? job?.amount ?? 0;

  // VAT — two independent signals: the trader's profile-level VAT
  // registration, or this specific quote's voice-captured "plus/inc VAT" flag.
  const showVat = !!(biz?.vatRegistered || biz?.vat_registered) || job?.vat === true;
  // Prices entered in the app are VAT-INCLUSIVE (gross). splitVatInclusive
  // derives net/VAT from that gross — we never add VAT on top. Decision
  // locked: ACC, 2026-06-21. Mirrors invoiceMessage.js's identical line.
  const grossTotal = showVat ? splitVatInclusive(total).gross : total;
  const totalStr = grossTotal > 0 ? `£${grossTotal.toFixed(2)}` : '';
  const businessName = biz?.name || biz?.business_name || '';

  // Deposit details
  const depositPercent = Number(job?.deposit_percent ?? 0);
  const depositAmount = depositPercent > 0 && total > 0
    ? `£${(total * depositPercent / 100).toFixed(2)}`
    : '';

  // Deposit due-date — informational, set by sendQuote.js from the voice-quote
  // confirm card's depositDue. Appended to whichever deposit line renders below.
  // Accepts either a bare YYYY-MM-DD date or a full ISO timestamp.
  const depositDueDate = job?.deposit_due_date
    ? (job.deposit_due_date.length === 10
        ? new Date(job.deposit_due_date + 'T00:00:00')
        : new Date(job.deposit_due_date))
    : null;
  const dueSuffix = depositDueDate ? ` · due ${formatToday(depositDueDate)}` : '';

  // Bank details from biz (mirrors invoiceMessage.js field names)
  const accountName   = biz?.accountName   || biz?.account_name   || '';
  const sortCode      = biz?.sortCode      || biz?.sort_code      || '';
  const accountNumber = biz?.accountNumber || biz?.account_number || '';
  const hasBankDetails = !!(sortCode && accountNumber);

  // Link-first ordering: WhatsApp truncates file-share captions on iOS,
  // so the sign URL must sit in the first 2-3 lines or the customer will
  // only see the PDF and miss the call to action. Greeting + sign link
  // come first; details (summary, total, deposit) sit below as context.
  const lines = [
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    `📝 Tap to view and accept or decline your quote:`,
    quoteUrl,
    '',
    `🔨 ${summary}`,
  ];
  if (totalStr) lines.push(`💷 Total: ${totalStr}${showVat ? ' (inc VAT)' : ''}`);

  // Deposit pay link (Pro + Stripe) — separate visible block below the sign link.
  if (depositPayUrl && depositAmount) {
    lines.push('');
    lines.push(`Pay ${depositAmount} deposit${dueSuffix} (locks in your slot):`);
    lines.push(depositPayUrl);
  } else if (!depositPayUrl && depositAmount && hasBankDetails) {
    // Bank-transfer deposit block (V1 — all traders without Stripe).
    lines.push('');
    lines.push(`Deposit to secure your booking: ${depositAmount} (${depositPercent}%)${dueSuffix}`);
    lines.push(`Pay by bank transfer to:`);
    if (accountName) lines.push(`Name: ${accountName}`);
    lines.push(`Sort code: ${sortCode}`);
    lines.push(`Account: ${accountNumber}`);
    lines.push(`Use your name as the reference, then drop me a message and I'll book you in.`);
  }

  lines.push('');
  lines.push(`Cheers,`);
  lines.push(businessName);

  return lines.join('\n');
}
