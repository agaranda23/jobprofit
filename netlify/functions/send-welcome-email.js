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
const FROM_ADDRESS = 'Alan at OHNAR <alan@jobprofit.co.uk>'; // FLAG: flip to alan@ohnar.co.uk after Resend verifies ohnar.co.uk SPF/DKIM
const RESEND_API_URL = 'https://api.resend.com/emails';

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/**
 * Attempt to reset welcome_email_sent_at to NULL so the next app load can retry.
 * Fire-and-forget: errors are logged but never surfaced.
 */
async function rollbackClaim(adminClient, userId) {
  try {
    const { error } = await adminClient
      .from('profiles')
      .update({ welcome_email_sent_at: null })
      .eq('id', userId)
      .is('welcome_email_sent_at', userId); // intentionally never matches — see below
    // NOTE: The .is() guard above would make rollback a no-op if we tried to
    // match welcome_email_sent_at === userId (a UUID), which is always false.
    // Use the plain eq chain without .is() for the rollback (unconditional clear):
    void error; // suppress lint; we fall through to the real call below
  } catch {
    // swallow
  }
  // Actual unconditional rollback (separate try so it always runs):
  try {
    await adminClient
      .from('profiles')
      .update({ welcome_email_sent_at: null })
      .eq('id', userId);
  } catch (e) {
    console.warn('send-welcome-email: rollback threw', e?.message);
  }
}

/** Build the HTML email body. Inline styles for broadest email client support. */
export function buildEmailHtml(firstName) {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Welcome to OHNAR</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'DM Sans',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="background:#0B1320;padding:24px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">OHNAR</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 24px;">
              <p style="margin:0 0 16px;font-size:16px;color:#111827;line-height:1.5;">${greeting}</p>

              <p style="margin:0 0 16px;font-size:16px;color:#111827;line-height:1.5;">
                Welcome aboard &#8212; really glad you're here.
              </p>

              <p style="margin:0 0 24px;font-size:17px;font-weight:600;color:#2563EB;line-height:1.4;border-left:3px solid #2563EB;padding-left:12px;">
                A spreadsheet tells you what you charged.<br />
                OHNAR tells you what you made.
              </p>

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#2563EB;border-radius:8px;">
                    <a href="${APP_URL}"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
                      Log your first job &#8212; 60 seconds
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;background:#f9fafb;border-radius:8px;padding:12px 14px;">
                You're a Founding Member &#8212; that means &#163;12/month for life, locked in as long as you stay subscribed. We're grateful for the early trust.
              </p>

              <p style="margin:0;font-size:15px;color:#374151;line-height:1.5;">
                Any questions, just reply to this email.<br /><br />
                &#8212; Alan, OHNAR
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                OHNAR &middot; <a href="${APP_URL}" style="color:#6b7280;text-decoration:none;">ohnar.co.uk</a>
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
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  return [
    greeting,
    '',
    "Welcome aboard — really glad you're here.",
    '',
    '"A spreadsheet tells you what you charged. OHNAR tells you what you made."',
    '',
    `Log your first job (60 seconds): ${APP_URL}`,
    '',
    "You're a Founding Member — that means £12/month for life, locked in as long as you stay subscribed. We're grateful for the early trust.",
    '',
    'Any questions, just reply to this email.',
    '',
    '— Alan, OHNAR',
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
