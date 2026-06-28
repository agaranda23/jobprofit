/**
 * sendChaseEmail — trader self-nudge via Resend when push is unavailable.
 *
 * This is NOT a customer-facing email. It sends to the TRADER (profiles.email)
 * to notify them that one of their invoices needs chasing. The WhatsApp/SMS
 * chase to the customer remains a manual action from the app.
 *
 * Called from chase-reminders.js when sendPushToUser returns { sent: 0 }
 * (VAPID keys absent or no registered subscriptions for that user).
 *
 * Design invariants:
 *   - Graceful no-op if RESEND_API_KEY is unset — returns { skipped: 'no_api_key' }.
 *     Safe to deploy before RESEND_API_KEY is provisioned.
 *   - Skips silently when the trader has no email address (phone-OTP users).
 *   - Fail-soft: swallows Resend 4xx/5xx without throwing. A failed nudge must
 *     never break the chase-reminders run for other users.
 *   - Plain-text only — reliable across all email clients, no HTML maintenance.
 *
 * @param {{ userId: string, adminClient: object, job: object, dpd: number, currentTier: number }} opts
 * @returns {Promise<{ sent: true } | { skipped: string } | { error: string }>}
 */

const FROM_ADDRESS = 'Alan at OHNAR <alan@jobprofit.co.uk>'; // FLAG: flip to alan@ohnar.co.uk after Resend verifies ohnar.co.uk SPF/DKIM
const RESEND_API_URL = 'https://api.resend.com/emails';
// Netlify sets process.env.URL to the PRIMARY custom domain at runtime.
// Falls back to ohnar.co.uk so deep-links are always brand-correct.
const APP_BASE_URL = (process.env.URL || 'https://ohnar.co.uk').replace(/\/$/, '');

export async function sendChaseEmail({ userId, adminClient, job, dpd, currentTier }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return { skipped: 'no_api_key' };
  }

  // Look up the trader's email from profiles (already fetched in chase-reminders for
  // the auto_chase check; we re-query here to keep this helper self-contained and
  // avoid coupling the call-site to passing the full profile object).
  let traderEmail;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (error || !data?.email) {
      return { skipped: 'no_email' };
    }
    traderEmail = data.email;
  } catch {
    return { skipped: 'no_email' };
  }

  if (typeof traderEmail !== 'string' || !traderEmail.includes('@')) {
    return { skipped: 'no_email' };
  }

  const customerName = job.meta?.customer || job.customer_name || 'Customer';
  const amount = Number(job.amount ?? job.meta?.total ?? job.meta?.amount ?? 0);
  const amountStr = amount
    ? `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    : '';
  const deepLink = `${APP_BASE_URL}/?job=${encodeURIComponent(job.id)}#/work`;

  const subject = `Chase reminder: ${customerName}${amountStr ? ` — ${amountStr}` : ''} — ${dpd} day${dpd === 1 ? '' : 's'} overdue`;

  const lines = [
    `Hi,`,
    ``,
    `This is a reminder to chase ${customerName} for an unpaid invoice.`,
    ``,
    amountStr ? `Amount:   ${amountStr}` : null,
    `Overdue:  ${dpd} day${dpd === 1 ? '' : 's'}`,
    currentTier ? `Chase tier: ${currentTier}` : null,
    ``,
    `Open the job in JobProfit:`,
    deepLink,
    ``,
    `— JobProfit`,
  ].filter((l) => l !== null).join('\n');

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [traderEmail],
        subject,
        text: lines,
      }),
    });

    if (!res.ok) {
      // Swallow Resend 4xx/5xx — a failed nudge must not throw and break the caller.
      const errText = await res.text().catch(() => 'unknown');
      console.warn(`sendChaseEmail: Resend API error ${res.status} for user ${userId}`, errText);
      return { error: `Resend ${res.status}` };
    }
  } catch (err) {
    // Network-level failure — swallow and log.
    console.warn(`sendChaseEmail: fetch threw for user ${userId}`, err?.message);
    return { error: err?.message ?? 'fetch_threw' };
  }

  console.log(`sendChaseEmail: sent to trader ${userId} for job ${job.id}`);
  return { sent: true };
}
