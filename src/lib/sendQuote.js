// sendQuote — shared "send a quote via WhatsApp" flow.
//
// Extracted from ReviewSheet.jsx's handleQuoteWhatsApp (the quote-mode WhatsApp
// send) so the voice-quote confirm card (AddJobModal) and the Jobs-tab
// ReviewSheet share byte-identical send behaviour. Do not re-implement this
// logic anywhere else — both callers must import this file.
//
// Decision tree (unchanged from the original ReviewSheet implementation):
//   0. deposit > 0 + no bank details + not Pro/Stripe-connected → bank-gate
//      (abort before any cloud write; the caller shows its own bank-gate UI —
//      see BankGateSheet.jsx — and the trader re-taps Send once details are saved).
//   1. Clamp stale deposit_amount_pence to the current job total at send time.
//   2. Mint/reuse publicAccessToken and AWAIT its write to the cloud BEFORE
//      generating the PDF or share link — this is the fix for the "Quote not
//      found" bug. The URL is embedded in both the QR code and the PDF; if the
//      customer opens the link before the cloud write completes (even 200ms),
//      fetchPublicJob returns null → "Quote not found."
//   3. If the cloud write fails offline → warn the trader and abort the send.
//   4. canShareFile(file) + has phone  → navigator.share({ files, text })
//   5. canShareFile(file), no phone    → navigator.share({ files, text }) only
//   6. No Web Share Level 2 + phone    → wa.me text-only + auto-trigger PDF download
//   7. No Web Share Level 2, no phone  → clipboard copy of quote URL
//   8. AbortError                      → don't close, don't flash error (token is saved)

import QRCode from 'qrcode';
import { getQuotePDFBlob, downloadQuotePDF } from './invoicePDF';
import { buildQuoteWhatsAppMessage } from './quoteMessage';
import { buildWhatsAppLink } from './invoiceMessage';
import { buildPublicQuoteUrl } from './publicQuoteToken';
import { persistPublicToken, reissuePublicToken } from './store';
import { extractJobMeta, writeJobMeta, readJobMeta } from './jobMeta';
import { logTelemetry } from './telemetry';
import { getJobProfit } from './cashflow';
import { isPro } from './plan';
import { canShareFile } from './webShare';
import { stagePatch } from './jobStatus';
import { profileHasBank } from './bankDetails.js';

const DEPOSIT_TEACH_KEY = 'jp.deposit_bank_teach_shown';

function resolvePhone(job) {
  return job.customerPhone || job.phone || job.mobile || job.whatsapp || '';
}

/**
 * Returns true when sending this quote requires the just-in-time bank-details
 * gate: a deposit is requested, the trader is not Pro+Stripe-connected (i.e.
 * cannot take an online deposit), and no bank details are on file yet.
 *
 * Exported so callers can pre-flight the check (e.g. AddJobModal wants to know
 * BEFORE it persists/closes anything) as well as being used internally by
 * sendQuote() as the actual gate — single source of truth, checked twice.
 *
 * @param {{ profile: object, depositPercent: number }} args
 * @returns {boolean}
 */
export function needsBankGate({ profile, depositPercent = 0 } = {}) {
  const isOnlineDeposit = isPro(profile) &&
    profile?.stripe_connect_status === 'connected' &&
    !!profile?.stripe_user_id;
  return depositPercent > 0 && !isOnlineDeposit && !profileHasBank(profile);
}

/**
 * Sends a quote to a customer via WhatsApp (Web Share API with a wa.me
 * fallback). See the file header for the full decision tree.
 *
 * @param {object} job - the job to send a quote for
 * @param {object} opts
 * @param {object} opts.biz              - business settings (name, bank details, etc.)
 * @param {object} opts.profile          - trader profile (Stripe/plan/bank fields)
 * @param {number} [opts.depositPercent] - 0/25/50/custom deposit percent for this send
 * @param {string} [opts.depositDue]     - ISO date the deposit is due by (informational;
 *                                         stored on the job for a future reminder — not
 *                                         yet rendered on the quote document/message)
 * @param {Array}  [opts.receipts]       - job receipts, used for the profit telemetry event
 * @param {Function} [opts.onUpdate]     - (updatedJob) => void — persists the job patch
 * @param {Function} [opts.flash]        - (message) => void — toast callback
 * @param {Function} [opts.onClose]      - () => void — called when the send flow completes
 *                                          (or the share sheet is dismissed after the token
 *                                          has already been persisted)
 * @param {Function} [opts.setBusy]      - (bool) => void — busy/spinner flag
 * @param {string}   [opts.source]       - telemetry source tag (default 'review_sheet')
 * @returns {Promise<{ok: boolean, reason?: string, updatedJob?: object, shareMethod?: string}>}
 */
export async function sendQuote(job, {
  biz,
  profile,
  depositPercent = 0,
  depositDue = null,
  receipts = [],
  onUpdate,
  flash,
  onClose,
  setBusy,
  source = 'review_sheet',
} = {}) {
  // Step 0: Bank-gate — only fires when a deposit is requested by bank transfer
  // (i.e. NOT Pro+Stripe-connected). We do NOT fire the identity gate here —
  // that is invoice-send territory. No cloud call has been made yet.
  if (needsBankGate({ profile, depositPercent })) {
    return { ok: false, reason: 'bank-gate' };
  }

  setBusy?.(true);

  // ── Offline-retry token guard ─────────────────────────────────────────────
  // reissuePublicToken() only looks at the in-memory `job` object. If a PRIOR
  // send attempt minted a fresh token but the cloud write never confirmed
  // (offline), the caller's job still has no token on it (onUpdate is never
  // called on a failed attempt — see below) — so a naive retry would mint a
  // SECOND, different token. Both the failed and the eventual successful
  // write get queued for the offline sync replay (see store.js
  // updateJobMetaInCloud → _enqueueMetaFallback); if they carry different
  // token values, whichever queued write applies LAST wins and can silently
  // invalidate a link the trader already shared (intermittent 404s).
  //
  // Fix: check the local jobMeta cache (written unconditionally, below, BEFORE
  // the cloud write is attempted) for a token from a previous attempt on this
  // job and reuse it. Every retry then carries the SAME token, so however many
  // queued writes eventually replay, they are idempotent — same value, no race.
  const cachedMeta = readJobMeta(job?.id);
  const tokenSource = (!job?.publicAccessToken && cachedMeta.publicAccessToken && !cachedMeta.publicTokenRevokedAt && !job?.publicTokenRevokedAt)
    ? { ...job, publicAccessToken: cachedMeta.publicAccessToken }
    : job;
  // When the job's previous link was revoked, mint a fresh UUID so the new link
  // works and the old revoked URL stays dead (old token no longer matches any DB row).
  // When not revoked, reuse the existing token to keep any bookmarked links stable.
  const { token, wasRevoked } = reissuePublicToken(tokenSource);

  // ── Step 1: persist the token to cloud BEFORE producing the shareable URL ──
  // Build the full meta snapshot that includes the new token and stage fields so
  // the single cloud write captures everything in one round-trip.
  const isLead = job.status === 'lead' || !job.status;
  const jobTotal = Number(job.total ?? job.amount ?? 0);
  // Clamp: if deposit_amount_pence from a previous send exceeds current total
  // (e.g. trader edited the price after the first send), recompute from current total.
  const rawDepositPence = depositPercent > 0 && jobTotal > 0
    ? Math.round(jobTotal * (depositPercent / 100) * 100)
    : 0;
  const lockedDepositPence = Math.min(rawDepositPence, Math.round(jobTotal * 100));
  const updatedJob = {
    ...job,
    ...(isLead ? stagePatch('Quoted') : {}),
    quoteStatus: 'sent',
    quoteSentAt: new Date().toISOString(),
    publicAccessToken: token,
    // Clear the revoke flag when we minted a fresh token — without this the
    // Netlify functions would still return 404 for the new link.
    ...(wasRevoked ? { publicTokenRevokedAt: undefined } : {}),
    quoteDraft: false,
    deposit_percent:       depositPercent > 0 ? depositPercent : 0,
    deposit_amount_pence:  lockedDepositPence > 0 ? lockedDepositPence : null,
    ...(depositDue ? { deposit_due_date: depositDue } : {}),
  };
  // Write to localStorage first (synchronous, always succeeds). This is also
  // what makes the offline-retry token guard above work — the token is cached
  // here even when the cloud write below fails.
  const mergedMeta = writeJobMeta(updatedJob.id, extractJobMeta(updatedJob));

  // Await the cloud write. If we're offline the token can't reach Supabase, so
  // the sign link will be dead — surface this clearly rather than producing a
  // silently broken link.
  const persistResult = await persistPublicToken(updatedJob.id, mergedMeta);
  if (!persistResult.ok) {
    if (persistResult.offline) {
      flash?.('No connection — quote link won\'t work until you\'re back online. Try again when connected.');
    } else {
      flash?.('Could not save quote link — try again');
    }
    setBusy?.(false);
    return { ok: false, reason: persistResult.offline ? 'offline' : 'persist-failed' };
  }

  // Token is now committed to the cloud. The URL is safe to share.
  const quoteUrl = buildPublicQuoteUrl(token);
  const phone = resolvePhone(job);
  // Merge biz with profile bank details so the bank-transfer deposit block
  // appears in the WhatsApp message for traders who saved bank details via the
  // bank-gate (profile is optimistically updated at that point by the caller).
  const bizWithBank = {
    ...(biz || {}),
    accountName:   biz?.accountName   || profile?.account_name   || '',
    sortCode:      biz?.sortCode      || biz?.sort_code || profile?.sort_code || '',
    accountNumber: biz?.accountNumber || biz?.account_number || profile?.account_number || '',
  };
  const message = buildQuoteWhatsAppMessage({ job: updatedJob, biz: bizWithBank, quoteUrl });
  const link = buildWhatsAppLink({ phone: phone || '', message });

  // Pre-generate QR for embedding in the PDF.
  // Mirrors the invoice pay-now flow's QRCode.toDataURL pattern.
  // Best-effort: if QR generation fails, the PDF still renders with just the
  // clickable button (qrDataUrl falsy in drawSignQuoteRow).
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(quoteUrl, {
      width: 128,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
  } catch {
    // QR generation failed — proceed without it
  }

  const isProUser = isPro(profile);
  let shareMethod = 'wame_fallback';
  try {
    const blob = await getQuotePDFBlob({ job: updatedJob, biz, profile, quoteUrl, qrDataUrl });
    const customer = (job?.customer || 'quote').replace(/\s/g, '-');
    const file = new File([blob], `quote-${customer}.pdf`, { type: 'application/pdf' });

    if (canShareFile(file)) {
      shareMethod = 'web_share_files';
      const shareData = phone
        ? { files: [file], text: message + '\n' + link, title: 'Your quote' }
        : { files: [file], text: message, title: 'Your quote' };
      await navigator.share(shareData);
    } else if (phone) {
      shareMethod = 'wame_fallback';
      window.open(link, '_blank', 'noopener');
      await downloadQuotePDF({ job: updatedJob, biz, profile, quoteUrl, qrDataUrl, hidePoweredBy: isProUser });
    } else {
      // No file share, no phone — copy the quote URL so the user can paste it
      shareMethod = 'web_share_text';
      try {
        await navigator.clipboard.writeText(quoteUrl);
        flash?.('Link copied — paste it in WhatsApp');
      } catch {
        flash?.('Share this URL: ' + quoteUrl);
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      // User dismissed the share sheet. The token was already persisted so it's
      // safe to call onUpdate and close — the link exists in the cloud.
      onUpdate?.(updatedJob);
      flash?.('Quote saved — tap Send to share when ready');
      setBusy?.(false);
      onClose?.();
      return { ok: true, reason: 'aborted', updatedJob };
    }
    // PDF generation failed — fall back to text-only wa.me
    shareMethod = 'wame_fallback';
    if (phone) {
      window.open(link, '_blank', 'noopener');
    } else {
      flash?.('Could not share — try copying the link');
      setBusy?.(false);
      return { ok: false, reason: 'share-failed' };
    }
  }

  logTelemetry('quote_send', { channel: 'whatsapp', source, share_method: shareMethod });
  const _q1 = getJobProfit(job, receipts);
  logTelemetry('quote_sent', { headline_price: _q1.quote, job_costs: _q1.materials, true_profit: _q1.profit, channel: 'whatsapp' });
  // The cloud write already happened above. onUpdate here updates React state
  // (in-memory jobs list) — it will call writeJobMeta+syncMetaToCloud again but
  // that is idempotent (same meta object, no-op cloud write).
  onUpdate?.(updatedJob);

  // First-send teach: fire once when the trader sends their first deposit request
  // by bank transfer. Shown AFTER the quote is sent (not before — don't block).
  // Matches the bank-gate condition exactly (not just "not Pro") — a Pro trader
  // without Stripe connected is still on the bank-transfer deposit path.
  const isOnlineDeposit = isProUser &&
    profile?.stripe_connect_status === 'connected' &&
    !!profile?.stripe_user_id;
  if (depositPercent > 0 && !isOnlineDeposit) {
    try {
      const alreadyShown = localStorage.getItem(DEPOSIT_TEACH_KEY) === 'yes';
      if (!alreadyShown) {
        localStorage.setItem(DEPOSIT_TEACH_KEY, 'yes');
        flash?.('Deposit asked for. When it lands, open the job and tap Record deposit.');
      } else {
        flash?.('Quote sent');
      }
    } catch {
      flash?.('Quote sent');
    }
  } else {
    flash?.('Quote sent');
  }

  setBusy?.(false);
  onClose?.();
  return { ok: true, updatedJob, shareMethod };
}
