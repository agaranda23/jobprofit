/**
 * sendTraderAcceptEmail — fire-and-forget notification helper
 *
 * Sends a Resend-powered email to the trader when a customer signs their quote.
 * This is NOT transactional — the caller must never block the customer-facing
 * response on this function's result. Always call with await but treat the
 * return value as advisory (log failures, don't surface them to the user).
 *
 * Graceful degradation:
 *   - If RESEND_API_KEY is unset → logs and returns { ok: false, reason: 'no_api_key' }
 *   - If Resend returns 4xx/5xx → logs and returns { ok: false, reason: 'resend_error' }
 *   - If the fetch times out (3s) → logs and returns { ok: false, reason: '...' }
 *
 * Provider: Resend (https://resend.com)
 *   Sender:  OHNAR Notifications <alan@ohnar.co.uk> — ohnar.co.uk is verified
 *   in the Resend dashboard (SPF/DKIM). Replies route to getohnar@gmail.com.
 *
 * Required env vars:
 *   RESEND_API_KEY  — Netlify dashboard → Environment variables
 * Optional env vars:
 *   APP_BASE_URL    — defaults to https://ohnar.co.uk
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SENDER = 'OHNAR Notifications <alan@ohnar.co.uk>';
const REPLY_TO = 'getohnar@gmail.com';
const DEFAULT_APP_URL = 'https://ohnar.co.uk';

/**
 * @param {object} params
 * @param {string} params.traderEmail
 * @param {string|null} params.traderBusinessName
 * @param {string|null} params.customerName
 * @param {string|null} params.jobDescription
 * @param {string|number} params.amount
 * @param {string} params.acceptedAt  — ISO 8601 string
 * @returns {Promise<{ ok: boolean, id?: string, reason?: string }>}
 */
export async function sendTraderAcceptEmail({
  traderEmail,
  traderBusinessName,
  customerName,
  jobDescription,
  amount,
  acceptedAt,
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[email] RESEND_API_KEY not set — skipping trader notification');
    return { ok: false, reason: 'no_api_key' };
  }

  const appBaseUrl = process.env.APP_BASE_URL || DEFAULT_APP_URL;
  const displayName = customerName || 'Your customer';
  const displayJob = jobDescription || '(no description)';
  const displayBusiness = traderBusinessName || 'JobProfit';
  const signedDate = new Date(acceptedAt).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
  });

  const subject = `${displayName} accepted your quote — £${amount}`;

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #0F1B2D;">
      <h2 style="margin-top: 0; color: #0F1B2D;">Quote accepted</h2>
      <p><strong>${displayName}</strong> just accepted your quote for:</p>
      <div style="background: #f4f7f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0;">${displayJob}</p>
        <p style="margin: 0; font-size: 1.25em; font-weight: 700;">£${amount}</p>
      </div>
      <p style="color: #555; font-size: 14px;">Signed: ${signedDate}</p>
      <p>
        <a href="${appBaseUrl}"
           style="display: inline-block; background: #2BC48A; color: #fff; text-decoration: none;
                  padding: 12px 20px; border-radius: 8px; font-weight: 600;">
          Open JobProfit
        </a>
      </p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 32px 0 16px;">
      <p style="color: #888; font-size: 12px; margin: 0;">
        Sent by ${displayBusiness} via JobProfit &middot;
        You received this because a customer signed a quote you sent.
      </p>
    </div>
  `.trim();

  const text = [
    'Quote accepted',
    '',
    `${displayName} just accepted your quote for:`,
    displayJob,
    `£${amount}`,
    '',
    `Signed: ${signedDate}`,
    '',
    `Open in JobProfit: ${appBaseUrl}`,
  ].join('\n');

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER,
        to: traderEmail,
        reply_to: REPLY_TO,
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[email] Resend returned error:', res.status, errText);
      return { ok: false, reason: 'resend_error', status: res.status };
    }

    const data = await res.json().catch(() => ({}));
    console.log('[email] Trader notification sent, id:', data.id || '(none)');
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    return { ok: false, reason: err.message };
  }
}
