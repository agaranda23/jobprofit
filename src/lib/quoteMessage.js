// WhatsApp quote-link text builder for the "Send quote link" flow.
// Intentionally lighter than invoiceMessage.js — no VAT, no due date.
// This is a pre-work quote, not a payment request.
//
// Two deposit paths (V1):
//   depositPayUrl set  (Pro + Stripe) → Stripe pay link appended (existing behaviour)
//   bank details set + deposit_percent > 0 + no depositPayUrl → bank transfer block appended
//
// The bank block reads name/sort/account from biz (same fields as invoiceMessage.js).

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
  const totalStr = total > 0 ? `£${total.toFixed(2)}` : '';
  const businessName = biz?.name || biz?.business_name || '';

  // Deposit details
  const depositPercent = Number(job?.deposit_percent ?? 0);
  const depositAmount = depositPercent > 0 && total > 0
    ? `£${(total * depositPercent / 100).toFixed(2)}`
    : '';

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
  if (totalStr) lines.push(`💷 Total: ${totalStr}`);

  // Deposit pay link (Pro + Stripe) — separate visible block below the sign link.
  if (depositPayUrl && depositAmount) {
    lines.push('');
    lines.push(`Pay ${depositAmount} deposit (locks in your slot):`);
    lines.push(depositPayUrl);
  } else if (!depositPayUrl && depositAmount && hasBankDetails) {
    // Bank-transfer deposit block (V1 — all traders without Stripe).
    lines.push('');
    lines.push(`Deposit to secure your booking: ${depositAmount} (${depositPercent}%)`);
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
