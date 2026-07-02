/**
 * send-welcome-email — Netlify function
 *
 * Sends a one-time welcome email to a newly-registered user via Resend.
 * Called fire-and-forget from AppShell.jsx on first authenticated profile load
 * when profile.email && !profile.welcome_email_sent_at.
 *
 * Design invariants:
 *   - Graceful no-op if RESEND_API_KEY is unset (returns 200). Safe to merge
 *     before the founder provisions a Resend account.
 *   - Skips silently when the user has no email address (phone-OTP users).
 *   - Idempotent: checks profiles.welcome_email_sent_at before sending.
 *     Uses a guarded UPDATE (WHERE welcome_email_sent_at IS NULL) so a race
 *     between two simultaneous calls cannot double-send.
 *   - On Resend failure, rolls back the claim so the next app load can retry.
 *
 * Auth:
 *   POST with Authorization: Bearer <supabase-access-token>
 *   JWT verified server-side via Supabase service-role client — user ID is
 *   never trusted from the request body.
 *
 * Required env vars:
 *   VITE_SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS, server-only)
 *   RESEND_API_KEY            — Resend API key (optional at merge time;
 *                               function no-ops safely if absent)
 *
 * Response shapes:
 *   200  { sent: true }              — email dispatched
 *   200  { skipped: 'no_api_key' }   — RESEND_API_KEY not set
 *   200  { skipped: 'no_email' }     — phone-OTP user, no email on record
 *   200  { skipped: 'already_sent' } — welcome_email_sent_at already set
 *   401  { error }                   — missing / invalid JWT
 *   500  { error }                   — Supabase config error
 *   502  { error }                   — Resend API failure or DB error
 */

import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Netlify sets process.env.URL to the PRIMARY custom domain at runtime.
// Falls back to ohnar.co.uk so the welcome email CTA is always brand-correct.
const APP_URL = (process.env.URL || 'https://ohnar.co.uk').replace(/\/$/, '');
const FROM_ADDRESS = 'Alan at OHNAR <alan@ohnar.co.uk>';
const REPLY_TO = 'getohnar@gmail.com';
const RESEND_API_URL = 'https://api.resend.com/emails';

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/**
 * Build the HTML email body. Inline styles for broadest email client support.
 *
 * The logo is loaded from a hosted URL (${APP_URL}/ohnar-logo-dark.png), not a
 * base64 data-URI — most email clients (Gmail, Outlook) strip or block inline
 * data-URI images, so a hosted PNG is required for the logo to render at all.
 */
export function buildEmailHtml(firstName) {
  const greeting = firstName ? `Hi ${firstName} \u{1F44B}` : 'Hi there \u{1F44B}';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Welcome to OHNAR</title>
</head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:'DM Sans',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:28px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(11,19,32,.06);">

          <!-- Header -->
          <tr>
            <td style="background:#0B1320;padding:22px 32px;" align="left">
              <img src="${APP_URL}/ohnar-logo-dark.png" alt="OHNAR" width="140" height="31" style="display:block;border:0;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:30px 32px 8px;">
              <p style="margin:0 0 14px;font-size:22px;font-weight:800;color:#0B1320;line-height:1.2;">${greeting}</p>
              <p style="margin:0 0 18px;font-size:15px;color:#334155;line-height:1.55;">
                Welcome aboard &#8212; really glad you're here. OHNAR is the fastest way to quote, get paid, and actually <b>see what each job made</b> &#8212; all from your phone.
              </p>

              <!-- Profit hook -->
              <p style="margin:0 0 22px;font-size:17px;font-weight:700;color:#2563EB;line-height:1.4;border-left:4px solid #2563EB;padding-left:14px;">
                A spreadsheet tells you what you charged.<br />OHNAR tells you what you <span style="text-decoration:underline;">made</span>.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">
                <tr>
                  <td style="background:#2563EB;border-radius:10px;">
                    <a href="${APP_URL}" style="display:inline-block;padding:15px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Log your first job &#8212; 60 seconds \u{2192}</a>
                  </td>
                </tr>
              </table>

              <!-- Getting started -->
              <p style="margin:0 0 12px;font-size:12px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;">Getting started</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
                <tr>
                  <td width="26" valign="top" style="font-size:16px;color:#0E9F6E;font-weight:800;">\u{2713}</td>
                  <td style="font-size:14px;color:#1e2d44;line-height:1.5;"><b style="color:#0B1320;">Log a job by voice</b> &#8212; Just say it &#8212; "kitchen job, Sarah, &#163;780" &#8212; OHNAR writes it up.</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
                <tr>
                  <td width="26" valign="top" style="font-size:16px;color:#0E9F6E;font-weight:800;">\u{2713}</td>
                  <td style="font-size:14px;color:#1e2d44;line-height:1.5;"><b style="color:#0B1320;">Send a quote or invoice</b> &#8212; Your branding, sent from your phone, paid by card.</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
                <tr>
                  <td width="26" valign="top" style="font-size:16px;color:#0E9F6E;font-weight:800;">\u{2713}</td>
                  <td style="font-size:14px;color:#1e2d44;line-height:1.5;"><b style="color:#0B1320;">See your true profit</b> &#8212; What you actually made on the job, after costs. Not just what you charged.</td>
                </tr>
              </table>

              <!-- Founding member -->
              <p style="margin:18px 0 22px;font-size:13.5px;color:#8a6a12;line-height:1.5;background:#fdf6e3;border:1px solid #f0dfa8;border-radius:9px;padding:12px 14px;">
                <b>You're a Founding Member</b> &#8212; &#163;12/month locked for life, as long as you stay subscribed. Thanks for the early trust.
              </p>

              <!-- Independence + human -->
              <p style="margin:0 0 18px;font-size:15px;color:#334155;line-height:1.55;">
                Your customers, your brand, your data &#8212; <b>no strings</b>. Any questions, just reply to this email &#8212; I read every one.<br /><br />
                &#8212; Alan, OHNAR
              </p>

              <!-- PWA install tip -->
              <p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.5;background:#f4f7fc;border-radius:9px;padding:11px 14px;">
                \u{1F4F2} <b>Tip:</b> Add OHNAR to your home screen so it opens like an app &#8212; open <a href="${APP_URL}" style="color:#2563EB;text-decoration:none;">ohnar.co.uk</a>, tap Share \u{2192} &#8220;Add to Home Screen&#8221;.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0B1320;padding:18px 32px;">
              <p style="margin:0 0 6px;font-size:12px;color:#dce8fd;font-weight:700;">OHNAR &middot; Run your business. Get paid. Repeat.</p>
              <p style="margin:0;font-size:11px;color:#8ba0c4;line-height:1.5;">
                OHNAR is a trading name of JOB PROFIT LTD, registered in England &amp; Wales (No. 17249792). 128 City Road, London EC1V 2NX. \u{00B7} <a href="${APP_URL}" style="color:#9dc0fb;text-decoration:none;">ohnar.co.uk</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text fallback for email clients that can't render HTML. */
export function buildEmailText(firstName) {
  const greeting = firstName ? `Hi ${firstName} \u{1F44B}` : 'Hi there \u{1F44B}';
  return [
    greeting,
    '',
    "Welcome aboard — really glad you're here. OHNAR is the fastest way to quote, get paid, and actually see what each job made — all from your phone.",
    '',
    '"A spreadsheet tells you what you charged. OHNAR tells you what you made."',
    '',
    `Log your first job (60 seconds): ${APP_URL}`,
    '',
    'GETTING STARTED',
    '✓ Log a job by voice — Just say it — "kitchen job, Sarah, £780" — OHNAR writes it up.',
    '✓ Send a quote or invoice — Your branding, sent from your phone, paid by card.',
    '✓ See your true profit — What you actually made on the job, after costs. Not just what you charged.',
    '',
    "You're a Founding Member — £12/month locked for life, as long as you stay subscribed. Thanks for the early trust.",
    '',
    'Your customers, your brand, your data — no strings. Any questions, just reply to this email — I read every one.',
    '',
    '— Alan, OHNAR',
    '',
    `Tip: Add OHNAR to your home screen so it opens like an app — open ${APP_URL}, tap Share → "Add to Home Screen".`,
  ].join('\n');
}

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Graceful no-op when RESEND_API_KEY is absent ────────────────────────
  // Required behaviour: merging this PR before the founder provisions Resend
  // must be completely safe — no 500s, no broken sign-ins.
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.log('send-welcome-email: skipped — RESEND_API_KEY not set');
    return json(200, { skipped: 'no_api_key' });
  }

  // ── 2. Validate Supabase env vars ───────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'send-welcome-email: missing Supabase env vars.',
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey
    );
    return json(500, { error: 'Server configuration error' });
  }

  // ── 3. Verify Supabase JWT ──────────────────────────────────────────────────
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearerToken) {
    return json(401, { error: 'Unauthorized' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let userId;
  try {
    const { data: userData, error: authError } = await adminClient.auth.getUser(bearerToken);
    if (authError || !userData?.user?.id) {
      return json(401, { error: 'Unauthorized' });
    }
    userId = userData.user.id;
  } catch (err) {
    console.error('send-welcome-email: JWT verification failed', err?.message);
    return json(401, { error: 'Unauthorized' });
  }

  // ── 4. Fetch the profile ────────────────────────────────────────────────────
  let profile;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('email, first_name, welcome_email_sent_at')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('send-welcome-email: profile fetch failed', error.message);
      return json(502, { error: 'Database error' });
    }
    profile = data;
  } catch (err) {
    console.error('send-welcome-email: profile fetch threw', err?.message);
    return json(502, { error: 'Database error' });
  }

  // ── 5. Skip phone-OTP users with no email ──────────────────────────────────
  const email = profile?.email;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    console.log(`send-welcome-email: skipped user ${userId} — no email address`);
    return json(200, { skipped: 'no_email' });
  }

  // ── 6. Idempotency check — skip if already sent ────────────────────────────
  if (profile?.welcome_email_sent_at) {
    console.log(`send-welcome-email: skipped user ${userId} — already sent at ${profile.welcome_email_sent_at}`);
    return json(200, { skipped: 'already_sent' });
  }

  // ── 7. Claim the send slot with a guarded UPDATE ───────────────────────────
  // WHERE welcome_email_sent_at IS NULL prevents a double-send if two app loads
  // fire simultaneously (extremely rare — the client already guards this, but
  // the server is the authoritative idempotency wall).
  //
  // We write the timestamp now, then send. On Resend failure we roll it back
  // so the next app load can retry. On success the column stays set permanently.
  const sentAt = new Date().toISOString();
  try {
    const { error: updateError } = await adminClient
      .from('profiles')
      .update({ welcome_email_sent_at: sentAt })
      .eq('id', userId)
      .is('welcome_email_sent_at', null);

    if (updateError) {
      console.error('send-welcome-email: claim update failed', updateError.message);
      return json(502, { error: 'Database error' });
    }
  } catch (err) {
    console.error('send-welcome-email: claim update threw', err?.message);
    return json(502, { error: 'Database error' });
  }

  // ── 8. Send via Resend ──────────────────────────────────────────────────────
  const firstName = profile?.first_name || null;
  const subject = "You're in — let's get you paid faster";

  let resendFailed = false;
  let resendErrorMsg = null;

  try {
    const resendRes = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        reply_to: REPLY_TO,
        subject,
        html: buildEmailHtml(firstName),
        text: buildEmailText(firstName),
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text().catch(() => 'unknown');
      console.error(`send-welcome-email: Resend API error ${resendRes.status}`, errText);
      resendFailed = true;
      resendErrorMsg = `Resend API error: ${resendRes.status}`;
    }
  } catch (err) {
    console.error('send-welcome-email: fetch to Resend threw', err?.message);
    resendFailed = true;
    resendErrorMsg = 'Failed to send email';
  }

  if (resendFailed) {
    // Roll back the claim so the next app-open can retry.
    try {
      await adminClient
        .from('profiles')
        .update({ welcome_email_sent_at: null })
        .eq('id', userId);
    } catch (e) {
      console.warn('send-welcome-email: rollback failed', e?.message);
    }
    return json(502, { error: resendErrorMsg });
  }

  console.log(`send-welcome-email: sent to ${email} for user ${userId}`);
  return json(200, { sent: true });
};
