/**
 * SendInvoiceModal — bottom-sheet for sending an invoice from JobDetailDrawer.
 *
 * Primary send path: wa.me deep-link opens WhatsApp directly with invoice
 * text + bank details. Fast, native, no app-switching friction.
 *
 * Secondary path ("More ways to send"):
 *   - Web Share API with PDF file (attaches the actual PDF — heavier but
 *     useful when the customer needs a formal document).
 *   - PDF download (for manual attachment or filing).
 *
 * Pay-now Connect prompt (Section 1.3 a, brief 2026-05-31):
 *   - If trader is NOT connected to Stripe: slim banner at top of modal.
 *     "Not now" dismisses for this invoice only (component-local state).
 *     "Set up" calls onNavigateToCardPayments.
 *     Send button still reads "Send invoice" — invoice sends as today.
 *   - If trader IS connected: Pay-now link is generated on modal open,
 *     prepended to all message paths. Button reads "Send invoice with Pay-now".
 *     Never blocks the send if the link fails to generate — falls back gracefully.
 *
 * Just-in-time bank-gate (2026-06-02):
 *   - If the trader skipped bank details during onboarding, the first time
 *     they try to send an invoice they are prompted to add them here.
 *   - Entering and saving bank details transitions the modal back to the send view.
 *   - Traders who already have bank details never see this prompt.
 *   - The gate only fires on the invoice-send path (not quote-send).
 *
 * Props:
 *   job              – full job object
 *   biz              – business settings object (name, bank details, VAT flag, etc.)
 *   profile          – Supabase profiles row (or null when unauthenticated)
 *   jobs             – all jobs array (needed by nextInvoiceNumber to avoid gaps)
 *   onUpdate(updatedJob) – persists the job update (sets invoiceSentAt, etc.)
 *   onClose()        – close the modal
 *   flash(msg)       – toast callback from the parent drawer
 *   onNavigateToCardPayments() – optional; called when trader taps "Set up" in connect prompt
 *   onProfileUpdate(patch)     – optional; saves bank details to Supabase profile
 */
import { useState, useEffect } from 'react';
import { getInvoicePDFBlob, downloadInvoicePDF } from '../lib/invoicePDF';
import { buildInvoiceWhatsAppMessage, buildWhatsAppLink } from '../lib/invoiceMessage';
import { buildPublicInvoiceUrl } from '../lib/publicInvoiceToken';
import { nextInvoiceNumber } from '../lib/invoiceNumber';
import { getMissingInvoiceFields } from '../lib/bizValidation';
import { resolveBusinessIdentity } from '../lib/resolveBusinessIdentity';
import { incrementSendCount, eligibleForWhiteLabelNudge, countInvoicesSentThisMonth, isPro } from '../lib/plan';
import { supabase } from '../lib/supabase';
import { logTelemetry, UPGRADE_TRIGGERS } from '../lib/telemetry';
import { getJobProfit } from '../lib/cashflow';
import { persistPublicToken, reissuePublicToken } from '../lib/store';
import { extractJobMeta, writeJobMeta } from '../lib/jobMeta';
import InvoiceDocumentPreview from './InvoiceDocumentPreview';
import ProUpgradeSheet from './ProUpgradeSheet';
import Icon from './Icon';
import { haptic } from '../lib/haptics.js';

// Returns true when this browser supports navigator.share() with a files array.
// Stored as a module-level constant so we don't recalculate on every render.
const SUPPORTS_FILE_SHARE =
  typeof navigator !== 'undefined' &&
  typeof navigator.share === 'function' &&
  typeof navigator.canShare === 'function';

// Returns true when the profile has bank details (sort code + account number).
// Used by the just-in-time bank gate — if either is missing, prompt on invoice send.
function profileHasBank(profile) {
  return !!(profile?.sort_code && profile?.account_number);
}

// Formats raw sort code digits as NN-NN-NN. Mirrors the wizard's formatSortCode.
function formatSortCode(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '-' + digits.slice(2);
  return digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4);
}

function canShareFile(file) {
  if (!SUPPORTS_FILE_SHARE) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SendInvoiceModal({
  job,
  biz,
  profile,
  jobs,
  receipts = [],
  onUpdate,
  onClose,
  flash,
  // Optional: called when the user taps "Add price" on the £0 banner.
  // The drawer passes () => { closeModal; setEditingField('amount') }.
  onNeedsPrice,
  // Optional: called when the trader taps "Set up" in the connect prompt.
  // Typically navigates to Settings → Card payments.
  onNavigateToCardPayments,
  // Optional: saves a partial profile patch to Supabase. Required for the
  // just-in-time bank gate — when absent the gate is shown but the save button
  // writes directly via supabase (fallback, no optimistic profile update in parent).
  onProfileUpdate,
}) {
  const [invoiceNumber, setInvoiceNumber] = useState(
    () => job.invoiceNumber || nextInvoiceNumber(jobs)
  );
  const [dueDate, setDueDate] = useState(() => {
    if (job.invoiceDueDate) return new Date(job.invoiceDueDate).toISOString().slice(0, 10);
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('send'); // 'send' | 'identity-gate' | 'bank-gate' | 'post-send-nudge'

  // White-label post-send nudge: shown once per session (first send) and at most
  // once per week (localStorage gate). Never blocks the send — fires AFTER success.
  // Key: jp.wl_nudge_last_shown — stores ISO timestamp of last display.
  const WL_NUDGE_KEY = 'jp.wl_nudge_last_shown';
  const WL_NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
  const [nudgeShownThisSession, setNudgeShownThisSession] = useState(false);
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false);

  // Goodwill notice: shown once to free users who may have hit the old cap
  // during its brief live window (2026-05-29 → 2026-06-03). Dismissed permanently.
  const GOODWILL_DISMISSED_KEY = 'jp.cap_removal_goodwill_dismissed';
  const [goodwillVisible, setGoodwillVisible] = useState(() => {
    if (!profile || profile?.plan !== 'free') return false;
    try { return localStorage.getItem(GOODWILL_DISMISSED_KEY) !== 'yes'; } catch { return false; }
  });
  const dismissGoodwill = () => {
    setGoodwillVisible(false);
    try { localStorage.setItem(GOODWILL_DISMISSED_KEY, 'yes'); } catch { /* ok */ }
  };
  // showPreview: toggles the in-app invoice document preview panel.
  // Collapsed by default so the send CTA is the first thing the founder sees.
  const [showPreview, setShowPreview] = useState(false);

  // ── Identity/bank-gate state — just-in-time detail entry ────────────────────
  // localProfile: mirrors the profile prop but is updated optimistically when the
  // trader saves details via the just-in-time gates. This lets the modal
  // re-derive resolvedBiz and the missing-fields warning without waiting for a
  // parent re-render. The parent's onProfileUpdate call (if wired) updates the
  // real profile state in AppShell asynchronously.
  const [localProfile, setLocalProfile] = useState(profile);

  // Identity-gate state (business_name / first_name / last_name — shown once,
  // just-in-time, when a brand-new user who skipped onboarding tries to send).
  const [idBusinessName, setIdBusinessName] = useState(() => profile?.business_name || '');
  const [idFirstName, setIdFirstName] = useState(() => profile?.first_name || '');
  const [idLastName, setIdLastName] = useState(() => profile?.last_name || '');
  const [idSaving, setIdSaving] = useState(false);
  const [idError, setIdError] = useState(null);

  // Bank-gate state (sort_code / account_number).
  const [bankSortCode, setBankSortCode] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState(null);

  // ── Pay-now state ────────────────────────────────────────────────────────────
  // isConnected: true when the trader has a connected Stripe account.
  const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;

  // payNowUrl: the generated Pay-now URL for connected traders. Populated on
  // mount via the create-invoice-payment-link function. Empty string = not yet
  // generated or generation failed. Never blocks the send.
  const [payNowUrl, setPayNowUrl]           = useState('');
  const [payNowLoading, setPayNowLoading]   = useState(false);

  // connectBannerDismissed: "Not now" in the connect prompt hides it for this
  // modal session only. Intentionally component-local (not persisted) so the
  // trader sees it again next time they open Send Invoice.
  const [connectBannerDismissed, setConnectBannerDismissed] = useState(false);

  // hostedInvoiceUrl: the /i/<token> link prepended to the WhatsApp message so
  // the customer opens the full branded invoice rather than reading plain text.
  //
  // reissuePublicToken handles the revoke → re-share case: if the job's previous
  // link was revoked we mint a fresh UUID here (making the old URL permanently
  // dead — the old token no longer matches any DB row) and record wasRevoked so
  // attemptSend() can clear publicTokenRevokedAt in the same cloud write.
  const [{ token: pendingToken, wasRevoked: pendingTokenWasRevoked }] = useState(
    () => reissuePublicToken(job)
  );
  const hostedInvoiceUrl = buildPublicInvoiceUrl(pendingToken);

  // All hooks above — no early returns until after this point (PR #125 lesson).

  // Generate a Pay-now link when the modal opens for connected traders.
  // Fire-and-forget: if it fails, the modal still renders and the send path
  // falls back to the existing bank-transfer-only message.
  useEffect(() => {
    if (!isConnected || !job?.id) return;
    let cancelled = false;

    async function generate() {
      setPayNowLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;

        const res = await fetch('/.netlify/functions/create-invoice-payment-link', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ invoiceId: job.id }),
        });

        if (!res.ok || cancelled) return;
        const { payUrl } = await res.json();
        if (!cancelled && payUrl) setPayNowUrl(payUrl);
      } catch {
        // Silently skip — falls back to bank transfer only.
      } finally {
        if (!cancelled) setPayNowLoading(false);
      }
    }

    generate();
    return () => { cancelled = true; };
  }, [isConnected, job?.id]);

  const isFirstSend = job.status !== 'invoice_sent';
  // Use localProfile (optimistically updated after bank-gate save) so the missing
  // fields warning and bank-gate check reflect the latest saved state.
  const missing = getMissingInvoiceFields(biz, localProfile);
  // Merge the Stripe Payment Link from profile into biz so the lib functions
  // (invoiceMessage, invoicePDF) can read it regardless of the nav path.
  // biz may be null in the new-nav flow where only profile is available.
  // When the trader is connected and a Pay-now URL was generated, we use that
  // as the stripePaymentLink so the invoiceMessage lib injects it naturally
  // into the WhatsApp template (see invoiceMessage.js — it already handles this field).
  const effectivePaymentLink =
    (isConnected && payNowUrl)
      ? payNowUrl
      : (localProfile?.stripe_payment_link || biz?.stripePaymentLink || '');

  // Merge biz (legacy localStorage) + localProfile (optimistically updated after bank-gate
  // save) so all document paths — WhatsApp message, PDF share, PDF download — see the
  // same complete business identity. Profile fields take priority because Settings
  // writes to profile, not to the stale localStorage biz object.
  const resolvedBiz = resolveBusinessIdentity(biz, localProfile);
  const bizWithStripe = {
    ...resolvedBiz,
    stripePaymentLink: effectivePaymentLink,
  };
  const message = buildInvoiceWhatsAppMessage({ job, biz: bizWithStripe, invoiceNumber, dueDate, hostedInvoiceUrl });
  // Check whether the job has a usable price — treat null AND 0 as "no price".
  const invAmount = Number(job.total ?? job.amount);
  const isUnpriced = !invAmount || invAmount <= 0;

  // Performs gates (paywall, bank-gate, price check) and — on first send —
  // awaits the cloud write of publicAccessToken before returning true.
  // Returns false when a gate blocks the send or the cloud write fails offline.
  const attemptSend = async () => {
    // Hard-stop backstop for £0 invoices — belt-and-suspenders behind the UI banner.
    if (isUnpriced) return false;
    // Just-in-time identity gate: if the trader skipped onboarding they may be
    // missing business_name / first_name / last_name — all printed on the invoice.
    // Collect them here before proceeding. Once saved, localProfile is updated
    // optimistically and the gate will not fire again this session.
    const identityMissing = !localProfile?.business_name || !localProfile?.first_name || !localProfile?.last_name;
    if (identityMissing) {
      logTelemetry('identity_gate_shown', { source: 'invoice_send' });
      setView('identity-gate');
      return false;
    }
    // Just-in-time bank gate: if the trader has no bank details, intercept the send
    // and show the bank-entry form. Once they save, they return here via setView('send')
    // with localProfile updated — the gate will not fire again.
    if (!profileHasBank(localProfile)) {
      logTelemetry('bank_gate_shown', { source: 'invoice_send' });
      setView('bank-gate');
      return false;
    }
    if (isFirstSend) {
      const now = new Date().toISOString();
      const updatedJob = {
        ...job,
        status: 'invoice_sent',
        invoiceSentAt: now,
        invoiceNumber,
        invoiceDueDate: new Date(dueDate).toISOString(),
        // Persist the public access token so the /i/<token> URL stays stable
        // and the trader can re-send the same link. When the previous link was
        // revoked, pendingToken is a fresh UUID (old link stays dead) and we
        // must clear publicTokenRevokedAt so the Netlify functions serve the new link.
        publicAccessToken: pendingToken,
        ...(pendingTokenWasRevoked ? { publicTokenRevokedAt: undefined } : {}),
        invoiceLinkSentAt: now,
      };

      // Write to localStorage synchronously first so in-app state is correct
      // even if the cloud write below is delayed.
      const mergedMeta = writeJobMeta(updatedJob.id, extractJobMeta(updatedJob));

      // Await the cloud write of the token. The hosted invoice URL is embedded in
      // the WhatsApp message; if the customer opens it before the cloud write lands,
      // they hit "Invoice not found." Awaiting here guarantees the token is in
      // Supabase before the message is produced.
      const persistResult = await persistPublicToken(updatedJob.id, mergedMeta);
      if (!persistResult.ok) {
        if (persistResult.offline) {
          flash('No connection — invoice link won\'t work until you\'re back online. Try again when connected.');
        } else {
          flash('Could not save invoice link — try again');
        }
        return false;
      }

      onUpdate(updatedJob);
      // Fire-and-forget Supabase increment — silently tolerates offline.
      incrementSendCount(supabase, profile?.id);

      // Telemetry: track when a free user reaches 4 docs sent in the month.
      // This is the leading indicator cohort the old cap would have hit/lost.
      // Fire only on the 4th send (not every send after) to avoid noise.
      if (!profile || profile?.plan === 'free') {
        const sentThisMonth = countInvoicesSentThisMonth(jobs);
        if (sentThisMonth === 3) {
          // This send makes it 4 — fire the milestone once.
          logTelemetry('free_user_4th_doc_sent_this_month', { plan: profile?.plan ?? 'free' });
        }
      }
    }
    return true;
  };

  // Decides whether to show the white-label nudge after a successful send.
  // Rules: free user AND (first send this session OR cooldown has expired).
  // Never blocks the send — called after the send succeeds.
  const shouldShowWhiteLabelNudge = () => {
    if (!eligibleForWhiteLabelNudge(profile)) return false;
    if (nudgeShownThisSession) return false;
    try {
      const last = localStorage.getItem(WL_NUDGE_KEY);
      if (last && Date.now() - new Date(last).getTime() < WL_NUDGE_COOLDOWN_MS) return false;
    } catch {
      // localStorage unavailable — show the nudge
    }
    return true;
  };

  const markNudgeShown = () => {
    setNudgeShownThisSession(true);
    try { localStorage.setItem(WL_NUDGE_KEY, new Date().toISOString()); } catch { /* ok */ }
    logTelemetry('white_label_nudge_shown', { source: 'post_send', plan: profile?.plan ?? 'free' });
  };

  // Primary path: wa.me deep-link — opens WhatsApp with invoice text + bank
  // details. Fast, no PDF generation overhead, works on any phone.
  const handleWhatsApp = async () => {
    logTelemetry('invoice_send', { channel: 'whatsapp' });
    const _iwa = getJobProfit(job, receipts);
    logTelemetry('invoice_sent', { headline_price: _iwa.quote, job_costs: _iwa.materials, true_profit: _iwa.profit, channel: 'whatsapp' });
    if (!await attemptSend()) return;
    haptic('medium');
    const link = buildWhatsAppLink({
      phone: job.customerPhone || job.phone || '',
      message,
    });
    window.open(link, '_blank', 'noopener');
    flash('Invoice sent');
    if (shouldShowWhiteLabelNudge()) {
      markNudgeShown();
      setView('post-send-nudge');
    } else {
      onClose();
    }
  };

  // Secondary path: Web Share API with PDF file (modern iOS/Android). Attaches
  // the actual PDF so customers who need a formal document get one.
  const handleSharePDF = async () => {
    logTelemetry('invoice_send', { channel: 'share' });
    const _ish = getJobProfit(job, receipts);
    logTelemetry('invoice_sent', { headline_price: _ish.quote, job_costs: _ish.materials, true_profit: _ish.profit, channel: 'share' });
    if (!await attemptSend()) return;
    haptic('medium');
    setBusy(true);
    try {
      // getInvoicePDFBlob is now async (generates QR code if payNowUrl is set).
      const blob = await getInvoicePDFBlob({ job, biz: bizWithStripe, profile, invoiceNumber, dueDate, payNowUrl, hidePoweredBy: isPro(profile) });
      const file = new File([blob], `${invoiceNumber}.pdf`, { type: 'application/pdf' });
      if (canShareFile(file)) {
        await navigator.share({
          files: [file],
          text: message,
          title: `Invoice ${invoiceNumber}`,
        });
        flash('Invoice sent');
        if (shouldShowWhiteLabelNudge()) { markNudgeShown(); setView('post-send-nudge'); } else { onClose(); }
      } else {
        // Fallback: download PDF + open WhatsApp deep-link with text.
        await downloadInvoicePDF({ job, biz: bizWithStripe, profile, invoiceNumber, dueDate, payNowUrl, hidePoweredBy: isPro(profile) });
        const link = buildWhatsAppLink({
          phone: job.customerPhone || job.phone || '',
          message,
        });
        window.open(link, '_blank', 'noopener');
        flash('Invoice sent');
        if (shouldShowWhiteLabelNudge()) { markNudgeShown(); setView('post-send-nudge'); } else { onClose(); }
      }
    } catch (err) {
      // navigator.share throws AbortError when the user dismisses the sheet —
      // that's intentional, not a failure. Don't flash an error for it and
      // don't close the modal so the trader can try again.
      if (err?.name !== 'AbortError') {
        flash('Could not send — try the download below');
      }
      // NOTE: attemptSend already called onUpdate — the token is in the cloud.
      // We can't rollback the cloud write but the state is consistent.
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const handleDownloadPDF = async () => {
    logTelemetry('invoice_send', { channel: 'download' });
    const _idl = getJobProfit(job, receipts);
    logTelemetry('invoice_sent', { headline_price: _idl.quote, job_costs: _idl.materials, true_profit: _idl.profit, channel: 'download' });
    if (!await attemptSend()) return;
    haptic('medium');
    try {
      // downloadInvoicePDF is now async (QR code generation).
      await downloadInvoicePDF({ job, biz: bizWithStripe, profile, invoiceNumber, dueDate, payNowUrl, hidePoweredBy: isPro(profile) });
      flash('Invoice downloaded');
      if (shouldShowWhiteLabelNudge()) { markNudgeShown(); setView('post-send-nudge'); } else { onClose(); }
    } catch {
      flash('PDF failed — check Settings for business details');
    }
  };

  // ── Post-send white-label nudge view ───────────────────────────────────────
  // Shown AFTER a successful send, never blocking. Single subtle line + Pro link.
  // The send is already done; onClose closes both this nudge and the modal.
  if (view === 'post-send-nudge') {
    return (
      <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal-sheet">
          <div className="modal-sheet-header">
            <h3 className="modal-sheet-title">Invoice sent</h3>
            <button className="modal-sheet-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="modal-sheet-body">
            <p className="modal-sheet-text modal-sheet-text--muted">
              Your customer will see &ldquo;Sent with OHNAR&rdquo; on this.
              Make it your name only &mdash;{' '}
              <button
                type="button"
                className="modal-inline-link"
                onClick={() => {
                  setUpgradeSheetOpen(true);
                }}
              >
                Pro &rsaquo;
              </button>
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost modal-sheet-btn"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  // ── Identity-gate view ────────────────────────────────────────────────────
  // Shown once, just-in-time, when a brand-new user who never completed onboarding
  // (business_name / first_name / last_name) tries to send their first invoice.
  // After saving, falls through to the bank-gate or straight to send.
  if (view === 'identity-gate') {
    const idCanSave =
      idBusinessName.trim().length > 0 &&
      idFirstName.trim().length > 0 &&
      idLastName.trim().length > 0 &&
      !idSaving;

    const handleIdentitySave = async () => {
      if (!idCanSave) return;
      setIdSaving(true);
      setIdError(null);
      try {
        const patch = {
          business_name: idBusinessName.trim(),
          first_name: idFirstName.trim(),
          last_name: idLastName.trim(),
        };
        if (onProfileUpdate) {
          await onProfileUpdate(patch);
        } else {
          const { data: { session: s } } = await supabase.auth.getSession();
          if (!s?.user?.id) throw new Error('Not signed in');
          const { error: dbErr } = await supabase
            .from('profiles')
            .update(patch)
            .eq('id', s.user.id);
          if (dbErr) throw dbErr;
        }
        setLocalProfile(prev => ({ ...(prev || {}), ...patch }));
        logTelemetry('identity_gate_completed', { source: 'invoice_send' });
        // Chain to bank-gate if bank details are still missing, otherwise send.
        setView(profileHasBank({ ...(localProfile || {}), ...patch }) ? 'send' : 'bank-gate');
      } catch (e) {
        setIdError(e?.message || 'Could not save — check your connection and try again');
      } finally {
        setIdSaving(false);
      }
    };

    return (
      <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal-sheet">
          <div className="modal-sheet-header">
            <h3 className="modal-sheet-title">Quick — your business details</h3>
            <button className="modal-sheet-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="modal-sheet-body">
            <p className="modal-sheet-text">
              Your business name and your name are printed on the invoice so your customer knows who to pay. One time only.
            </p>
          </div>

          <div className="invoice-fields-row" style={{ flexDirection: 'column', gap: 12 }}>
            <div className="invoice-field-group">
              <label className="invoice-field-label" htmlFor="ig-business-name">Trading name</label>
              <input
                id="ig-business-name"
                className="invoice-field-input"
                type="text"
                value={idBusinessName}
                placeholder="Smith Plumbing Ltd"
                onChange={e => setIdBusinessName(e.target.value)}
                autoFocus
                autoComplete="off"
                aria-label="Trading name"
              />
            </div>
            <div className="invoice-field-group">
              <label className="invoice-field-label" htmlFor="ig-first-name">First name</label>
              <input
                id="ig-first-name"
                className="invoice-field-input"
                type="text"
                value={idFirstName}
                placeholder="Alan"
                onChange={e => setIdFirstName(e.target.value)}
                autoComplete="off"
                aria-label="First name"
              />
            </div>
            <div className="invoice-field-group">
              <label className="invoice-field-label" htmlFor="ig-last-name">Last name</label>
              <input
                id="ig-last-name"
                className="invoice-field-input"
                type="text"
                value={idLastName}
                placeholder="Smith"
                onChange={e => setIdLastName(e.target.value)}
                autoComplete="off"
                aria-label="Last name"
              />
            </div>
          </div>

          {idError && (
            <p className="modal-sheet-error" role="alert">{idError}</p>
          )}

          <button
            type="button"
            className="btn-primary modal-sheet-btn"
            onClick={handleIdentitySave}
            disabled={!idCanSave}
          >
            {idSaving ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </div>
    );
  }

  // ── Bank-gate view ─────────────────────────────────────────────────────────
  // Shown once, just-in-time, when a trader who skipped onboarding bank details
  // tries to send their first invoice. Reuses the existing modal-sheet chrome.
  if (view === 'bank-gate') {
    const sortCodeValid = /^\d{6}$/.test(bankSortCode.replace(/\D/g, ''));
    const accountNumberValid = /^\d{6,8}$/.test(bankAccountNumber);
    const bankCanSave = sortCodeValid && accountNumberValid && !bankSaving;

    const handleBankSave = async () => {
      if (!bankCanSave) return;
      setBankSaving(true);
      setBankError(null);
      try {
        const patch = {
          sort_code: bankSortCode.trim(),
          account_number: bankAccountNumber.trim(),
        };
        if (onProfileUpdate) {
          await onProfileUpdate(patch);
        } else {
          // Fallback: write directly when onProfileUpdate is not threaded.
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user?.id) throw new Error('Not signed in');
          const { error: dbErr } = await supabase
            .from('profiles')
            .update(patch)
            .eq('id', session.user.id);
          if (dbErr) throw dbErr;
        }
        // Optimistically update localProfile so resolvedBiz and missing-fields
        // check pick up the new bank details without a parent re-render.
        setLocalProfile(prev => ({ ...(prev || {}), ...patch }));
        logTelemetry('bank_gate_completed', { source: 'invoice_send' });
        setView('send');
      } catch (e) {
        setBankError(e?.message || 'Could not save — check your connection and try again');
      } finally {
        setBankSaving(false);
      }
    };

    return (
      <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal-sheet">
          <div className="modal-sheet-header">
            <h3 className="modal-sheet-title">Add your bank details</h3>
            <button className="modal-sheet-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="modal-sheet-body">
            <p className="modal-sheet-text">
              Your bank details are printed on the invoice so your customer can pay you by bank transfer.
            </p>
          </div>

          <div className="invoice-fields-row" style={{ flexDirection: 'column', gap: 12 }}>
            <div className="invoice-field-group">
              <label className="invoice-field-label" htmlFor="bg-sort-code">Sort code</label>
              <input
                id="bg-sort-code"
                className="invoice-field-input"
                type="text"
                inputMode="numeric"
                value={bankSortCode}
                placeholder="12-34-56"
                onChange={e => setBankSortCode(formatSortCode(e.target.value))}
                autoFocus
                autoComplete="off"
                aria-label="Sort code"
              />
            </div>
            <div className="invoice-field-group">
              <label className="invoice-field-label" htmlFor="bg-account-number">Account number</label>
              <input
                id="bg-account-number"
                className="invoice-field-input"
                type="text"
                inputMode="numeric"
                value={bankAccountNumber}
                placeholder="12345678"
                onChange={e => setBankAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 8))}
                autoComplete="off"
                aria-label="Account number"
              />
            </div>
          </div>

          {bankError && (
            <p className="modal-sheet-error" role="alert">{bankError}</p>
          )}

          <button
            type="button"
            className="btn-primary modal-sheet-btn"
            onClick={handleBankSave}
            disabled={!bankCanSave}
          >
            {bankSaving ? 'Saving…' : 'Save and send invoice'}
          </button>
          <button
            type="button"
            className="btn-ghost modal-sheet-btn"
            onClick={() => setView('send')}
            disabled={bankSaving}
          >
            Skip — send without bank details
          </button>
        </div>
      </div>
    );
  }

  // ── Send view ──────────────────────────────────────────────────────────────
  return (
    <>
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">Send Invoice</h3>
          <button className="modal-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Pay-now connect prompt (Section 1.3 a) — shown when not connected and
            the trader hasn't dismissed it for this invoice session yet */}
        {!isConnected && !connectBannerDismissed && !isUnpriced && (
          <div className="invoice-connect-prompt" role="note">
            <div className="invoice-connect-prompt__body">
              <strong>Add a Pay-now button?</strong> Your customer can pay by card straight
              from the invoice. Takes 5 min.
            </div>
            <div className="invoice-connect-prompt__actions">
              {onNavigateToCardPayments && (
                <button
                  type="button"
                  className="invoice-connect-prompt__setup"
                  onClick={() => { onClose(); onNavigateToCardPayments(); }}
                >
                  Set up
                </button>
              )}
              <button
                type="button"
                className="invoice-connect-prompt__dismiss"
                onClick={() => setConnectBannerDismissed(true)}
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {/* Goodwill notice — shown once to free users; cap was removed 2026-06-03 */}
        {goodwillVisible && (
          <div className="invoice-goodwill-notice" role="note">
            <span>Good news &mdash; sending invoices is now unlimited and free, forever. We&rsquo;ve taken the cap off.</span>
            <button
              type="button"
              className="invoice-goodwill-dismiss"
              onClick={dismissGoodwill}
              aria-label="Dismiss"
            >
              &#x2715;
            </button>
          </div>
        )}

        {/* Job summary card */}
        <div className="invoice-preview-card">
          <div className="invoice-preview-name">{job.customer || job.name}</div>
          <div className="invoice-preview-summary">
            {(job.summary || '').slice(0, 60)}
          </div>
          <div className="invoice-preview-amount">
            {typeof (job.total ?? job.amount) === 'number'
              ? `£${Number(job.total ?? job.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`
              : ''}
          </div>
        </div>

        {/* £0 guard — blocking banner when the job has no price */}
        {isUnpriced && (
          <div className="invoice-no-price-banner" role="alert">
            <span>This job has no price yet — add one before sending.</span>
            {onNeedsPrice && (
              <button
                type="button"
                className="invoice-no-price-add-btn"
                onClick={onNeedsPrice}
              >
                Add price
              </button>
            )}
          </div>
        )}

        {/* Invoice number + due date row */}
        <div className="invoice-fields-row">
          <div className="invoice-field-group">
            <label className="invoice-field-label" htmlFor="inv-number">
              Invoice number
            </label>
            <input
              id="inv-number"
              className="invoice-field-input"
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
            />
          </div>
          <div className="invoice-field-group">
            <label className="invoice-field-label" htmlFor="inv-due">
              Due date
            </label>
            <input
              id="inv-due"
              type="date"
              className="invoice-field-input"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
          </div>
        </div>

        {/* Missing fields warning */}
        {missing.length > 0 && (
          <div className="invoice-missing-warning">
            Missing: {missing.join(', ')} — fix in Settings for payment instructions
          </div>
        )}

        {/* Invoice document preview toggle — lets the founder see the branded
            document before sending. Collapsed by default to keep the CTA front
            and centre on mobile (one-hand kerb use case). */}
        <button
          type="button"
          className="invoice-preview-toggle"
          onClick={() => setShowPreview(v => !v)}
          aria-expanded={showPreview}
        >
          {showPreview ? 'Hide preview' : 'Preview invoice document'}
        </button>

        {showPreview && (
          <InvoiceDocumentPreview
            job={job}
            biz={bizWithStripe}
            profile={profile}
            invoiceNumber={invoiceNumber}
            dueDate={dueDate}
            payNowUrl={payNowUrl}
          />
        )}

        {/* Pay-now link loading hint — shown only while the dynamic Stripe link
            is being generated AND there is no static fallback link available.
            When a static stripe_payment_link is already set, we allow immediate
            send (the fallback link is included) and skip the wait-spinner. */}
        {isConnected && payNowLoading && !effectivePaymentLink && (
          <div className="invoice-paynow-loading" role="status" aria-live="polite">
            Generating Pay-now link…
          </div>
        )}

        {/* Primary CTA — WhatsApp deep-link (fast, no PDF overhead).
            Label changes when connected + Pay-now URL is ready (per brief 1.4).
            Only blocked while loading if there is no static fallback payment link —
            if a fallback exists the message is already complete and the trader can
            send immediately without waiting for the dynamic link. */}
        <button
          type="button"
          className="btn-primary modal-sheet-btn invoice-send-whatsapp"
          onClick={handleWhatsApp}
          disabled={isUnpriced || (isConnected && payNowLoading && !effectivePaymentLink)}
          aria-disabled={isUnpriced}
        >
          <Icon name="send" size={16} />
          {isConnected && payNowUrl
            ? ' Send invoice with Pay-now link'
            : ' Send invoice link via WhatsApp'}
        </button>

        {/* More ways to send — secondary options, always visible */}
        <div className="invoice-secondary-actions">
          <div className="invoice-more-ways-label">More ways to send</div>
          <button
            type="button"
            className="btn-secondary modal-sheet-btn"
            onClick={handleSharePDF}
            disabled={busy || isUnpriced}
          >
            {busy ? 'Preparing PDF…' : 'Send with PDF (share sheet)'}
          </button>
          <button
            type="button"
            className="btn-ghost modal-sheet-btn"
            onClick={handleDownloadPDF}
            disabled={isUnpriced}
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>

    {/* Upgrade sheet — opened from the post-send white-label nudge */}
    <ProUpgradeSheet
      open={upgradeSheetOpen}
      trigger={UPGRADE_TRIGGERS.WHITELABEL_FOOTER}
      onClose={() => { setUpgradeSheetOpen(false); onClose(); }}
    />
    </>
  );
}
