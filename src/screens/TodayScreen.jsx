/**
 * TodayScreen — "The Foreman" (PRD 2026-05-30, updated 2026-05-31)
 *
 * One screen, one prompt. Ranking algorithm (deterministic, top-wins):
 *   Tier 1 — Overdue chase (invoice sent, due_date < today, unpaid, not snoozed)
 *   Tier 2 — Finished-but-not-invoiced (job complete >48h, no invoice sent)
 *   Tier 3 — Stale sent quote (status quoted, quoteSentAt ≥3 days ago, not accepted)
 *   Tier 4 — Accepted-not-started: SKIPPED — the accepted-quote banner handles this.
 *   Tier 5 — All-clear (nothing actionable)
 *
 * Tie-break across peers within the same tier: largest £ → oldest date → lowest ID.
 *
 * IA migration (components removed from Today, promoted to FinanceScreen/Money):
 *   - Earned/Spent/Profit card  → top of FinanceScreen
 *   - Average per Job card      → FinanceScreen
 *   - 30-Day Outlook card       → FinanceScreen
 *   - Add Receipt button        → FinanceScreen (already present)
 *   - Pro upsell row            → removed entirely
 *   - Recent Today feed         → removed
 *   - Next Up card              → removed
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCountUp } from '../lib/useCountUp';
import AddJobModal from '../components/AddJobModal';
import Icon from '../components/Icon';
import { loadDraft, clearDraft } from '../lib/draftAutosave';
import ReviewSheet from '../components/ReviewSheet';
import GetProPill from '../components/GetProPill';
import ProUpgradeSheet from '../components/ProUpgradeSheet';
import { gbp, formatToday } from '../lib/today';
import { isAwaitingPayment, deriveStatus } from '../lib/jobStatus';
import { daysPastDue, recordChase, recordChaseCloud, buildChaseMessage, computeTier, buildPaymentDetails, chaseCustomerFirstName } from '../lib/chaseLadder';
import { writeJobMeta } from '../lib/jobMeta';
import { getNewlyAcceptedJobs, buildAcceptedLabel, formatAcceptedDate } from '../lib/acceptedNotification';
import {
  rankNextBestAction,
  readSnoozeStore,
  writeSnoozeStore,
  nbaLabel,
  nbaHeadline,
  nbaMeta,
  nbaCta,
  jobAmount,
} from '../lib/nextBestAction';
import { isPro, isTrialActive, trialDaysLeft } from '../lib/plan';
import { shouldOfferSampleData } from '../lib/sampleData';
import OhnarWordmark from '../components/OhnarWordmark';
import { UPGRADE_TRIGGERS } from '../lib/telemetry';
import { supabase } from '../lib/supabase';
import { getMonthSummary, getOverheadTotal, monthKey } from '../lib/cashflow';
import { haptic } from '../lib/haptics.js';
import { playSendEarcon } from '../lib/momentEarcons.js';
import { waitingToCollectTotal, jobsOn, oldestOnJob, daysOnCount, daysOnLabel, weekOverWeek } from '../lib/todayPulse';
import { shouldCelebrateFirstQuote, markFirstQuoteCelebrationSeen } from '../lib/firstQuoteCelebration';

// ── Snooze helpers (delegate to nextBestAction.js store, keep SNOOZE_MS local) ──
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function snoozeJob(jobId) {
  const store = readSnoozeStore();
  store[jobId] = new Date(Date.now() + SNOOZE_MS).toISOString();
  writeSnoozeStore(store);
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TodayScreen({
  jobs = [],
  receipts = [],
  onAddJob,
  onUpdateJob,
  onOpenDetailed,
  onMarkPaid,
  onJobTap,
  onNavigateToMoney,
  onSeeTheWeek,
  onLoadSampleData,
  onNavigateToCardPayments,
  profile,
  onProfileUpdate,
  materials,
  defaultMarkup,
  onBrowseMaterials,
  onMaterialSaved,
  // Snackbar manager (JP-LU2): floats up to AppShell so one renderer handles all surfaces.
  // AppShell also passes onSnackbarDismiss, but nothing in this component reads
  // it any more (the one call site, handleGotPaidChip, was dead code — removed).
  onSnackbar,
}) {
  const [jobOpen, setJobOpen] = useState(false);
  // jobOpenMode: 'normal' | 'quote' — controls defaultMode prop on AddJobModal.
  // 'quote' opens the create-quote surface (voice-first, both voice and type supported).
  // 'normal' opens the micro-log keypad.
  const [jobOpenMode, setJobOpenMode] = useState('normal');
  // reviewQuoteJob: when set, opens ReviewSheet in quote mode immediately after
  // a voice "Save & send quote" action. Cleared when the sheet closes.
  const [reviewQuoteJob, setReviewQuoteJob] = useState(null);

  // ── Draft autosave — "Resume your quote?" ─────────────────────────────────
  // resumeDraftBanner: the unsent AddJobModal draft found on mount (localStorage,
  // see src/lib/draftAutosave.js), or null. Re-checked whenever AddJobModal
  // closes without saving, so an explicit-close-without-sending still offers
  // Resume later in THIS session, not just after a reload.
  // resumeDraftPayload: the draft actually being resumed into AddJobModal right
  // now (only set once the trader taps "Continue").
  const [resumeDraftBanner, setResumeDraftBanner] = useState(() => loadDraft());
  const [resumeDraftPayload, setResumeDraftPayload] = useState(null);

  const handleResumeDraftContinue = useCallback(() => {
    setJobOpenMode(resumeDraftBanner?.view === 'quote' ? 'quote' : 'normal');
    setResumeDraftPayload(resumeDraftBanner);
    setJobOpen(true);
  }, [resumeDraftBanner]);

  const handleResumeDraftDiscard = useCallback(() => {
    clearDraft();
    setResumeDraftBanner(null);
  }, []);
  // toast/gotPaidToastQueue/payNowNudge removed (JP-LU2) — managed by snackbar in AppShell.
  // showToast shim: keeps all existing call-sites unchanged; delegates to onSnackbar.
  const showToast = useCallback((msg, action = null) => {
    onSnackbar?.({ type: 'toast', message: msg, action, dwell: 2400, priority: 8 });
  }, [onSnackbar]);
  // loadingSample: guards the empty-state "Load a sample day" CTA against a
  // double-tap while the seed (several sequential cloud writes) is in flight.
  const [loadingSample, setLoadingSample] = useState(false);
  const handleLoadSampleData = useCallback(async () => {
    if (loadingSample || !onLoadSampleData) return;
    setLoadingSample(true);
    try {
      await onLoadSampleData();
      showToast('Sample day loaded — explore, then clear it anytime in Settings');
    } catch {
      showToast('Could not load sample data — try again');
    } finally {
      setLoadingSample(false);
    }
  }, [loadingSample, onLoadSampleData, showToast]);
  // rankVersion bumps after Mark paid / Snooze to force re-rank without a full re-fetch
  const [rankVersion, setRankVersion] = useState(0);
  // invoicePickerOpen: "Send an invoice" pivot button opened the job picker
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  // Gate the pager + hide the bottom nav while the invoice job-picker is open.
  // The portal stops the visual drag-along, but React synthetic touch events still
  // bubble from the portalled overlay up to .dp-viewport's swipe handlers, so a hard
  // horizontal swipe could still page away and strand the picker. 'overlay-open' is
  // the shared signal useDashboardPager bails on, and it hides .bottom-nav via CSS.
  // Guard on the open flag before touching the shared (non-refcounted) class.
  useEffect(() => {
    if (!invoicePickerOpen) return;
    document.body.classList.add('overlay-open');
    return () => document.body.classList.remove('overlay-open');
  }, [invoicePickerOpen]);
  // markPaidPickerJob: which job's payment-method picker is open (null = closed)
  const [markPaidPickerJob, setMarkPaidPickerJob] = useState(null);
  // dismissedAcceptedIds: set of job IDs whose accepted banner the trader has dismissed
  // this session. Kept in component state so it is lost on reload — the real persistence
  // is acceptedSeenAt written to the jobMeta side-channel.
  const [dismissedAcceptedIds, setDismissedAcceptedIds] = useState(() => new Set());
  // payNowNudge removed (JP-LU2): now enqueued via onSnackbar({ type: 'nudge' }) in handleJobSave.
  // upgradeSheetOpen: controls ProUpgradeSheet visibility on Today.
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false);

  // paidFlash (item 4): true for ~600ms after a mark-paid gesture on Today.
  // Drives off the GESTURE (mark-paid tap), not job.paid at mount, so it never
  // silently no-ops when the job was already paid before the component rendered.
  const [paidFlash, setPaidFlash] = useState(false);
  const paidFlashTimerRef = useRef(null);

  // gotPaidDeferTimers removed (JP-LU2): snackbar manager handles dwell/sequencing.

  // Cleanup paidFlash timer on unmount to prevent setState-after-unmount.
  useEffect(() => () => clearTimeout(paidFlashTimerRef.current), []);

  const now = new Date();

  // ── First-quote celebration (item 2) ─────────────────────────────────────────
  // One-time, per-user-per-device (see src/lib/firstQuoteCelebration.js) —
  // fires the moment the trader's FIRST-EVER quote lands, from whichever of
  // the three quote-save paths triggered it (draft / save-and-send / voice
  // confirm). `jobs` here is always the pre-save snapshot — these handlers
  // call it before (or independently of) the cloud round-trip, so "no prior
  // quote" reflects real history, not a fabricated flag.
  const celebrateFirstQuote = useCallback((sentImmediately) => {
    if (!shouldCelebrateFirstQuote(jobs, profile?.id)) return;
    markFirstQuoteCelebrationSeen(profile?.id);
    const message = sentImmediately
      ? "🎉 Nice — your first quote's on its way to your customer."
      : "🎉 Nice — your first quote's ready. Now send it to your customer.";
    onSnackbar?.({ id: 'first-quote-celebration', type: 'toast', message, dwell: 4200, priority: 8 });
  }, [jobs, profile, onSnackbar]);

  const handleJobSave = async (payload) => {
    setJobOpen(false);
    setJobOpenMode('normal');
    // Tactile confirm on every save gesture. No matching earcon here on
    // purpose — this is the single most frequent action in the app, and one
    // of the toast messages below always fires alongside it (the visual
    // partner), so a sound on every save would get old fast. See
    // src/lib/haptics.js's call-site guide.
    haptic('light');
    // The job was actually saved — AddJobModal already cleared the autosaved
    // draft (see clearDraftNow() in saveMicro/saveDetails/saveQuote); drop our
    // local copy too so a stale banner can't reappear for completed work.
    setResumeDraftBanner(null);
    setResumeDraftPayload(null);

    const isDraftQuote = payload?.quoteStatus === 'draft';
    const isFastPath   = payload?.via === 'fast';
    const isDetailedPath = payload?.via === 'details';

    if (isDraftQuote) {
      showToast('Quote saved as draft');
      celebrateFirstQuote(false);
    } else if (isFastPath) {
      // Fast-save path: stay on Today, show "Saved · £380" toast with a View link.
      // The View link calls onJobTap which opens JobDetailDrawer on the Work tab.
      // Undo is deferred — there is no existing clean optimistic-delete path that is
      // safe to wire here under time pressure. See follow-up: feat/fast-save-undo.
      const amtLabel = payload?.amount != null ? ` · £${payload.amount}` : '';
      showToast(`Added to Leads${amtLabel}`, {
        label: 'View',
        onClick: () => onJobTap?.(payload),
      });

      // Speed-mode saves also enqueue the "Got paid?" chip (JP-LU2: via snackbar manager).
      // The toast dwell (2400ms) runs in the snackbar queue; the got-paid chip is lower
      // priority (6 vs 8) so it naturally follows once the toast expires.
      if (payload?.speedMode) {
        onSnackbar?.({ type: 'got-paid', job: payload, dwell: 5000, priority: 6 });
      }
    } else if (isDetailedPath) {
      // Detailed-save path: navigate to the new job's detail view (Jobs tab, drawer open).
      // Optimistic — open immediately with the just-saved payload, don't wait on cloud.
      // JobDetailDrawer is where Send Invoice lives, so arriving there is a free get-paid assist.
      onJobTap?.(payload);
    } else {
      showToast('Job saved');
    }

    // Pay-now soft prompt (Section 1.3 c, JP-LU2): enqueue as a snackbar nudge.
    // The snackbar manager enforces priority — it won't show while a higher-priority
    // item is active. Session-persistence: nudge type has dwell:0 (dismissal only),
    // so it stays until dismissed. onSnackbar is idempotent for same-id descriptors.
    const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;
    const isCompleted = payload?.status === 'completed' || payload?.status === 'active';
    if (!isConnected && isCompleted && onNavigateToCardPayments) {
      // dwell: 30s — nudge lingers for 30 seconds then auto-hides.
      // User can also dismiss explicitly via the snackbar × button.
      onSnackbar?.({ id: 'pay-now-nudge', type: 'nudge', message: 'Pay-now button available', dwell: 30000, priority: 2 });
    }

    try { await onAddJob?.(payload); } catch {
      // If the detailed-save path already navigated away, show the sync toast there.
      // For fast-save, replace the View toast with the sync message.
      if (!isDetailedPath) showToast('Saved offline — will sync');
    }
  };

  // "Save & send quote" — saves the job then opens ReviewSheet in quote mode.
  // Covers the details-view voice-confirm path and the manual/typed create-quote
  // path — both still get a ReviewSheet review step before sending.
  // onUpdateJob is used by ReviewSheet to persist quoteSentAt/quoteStatus/publicAccessToken
  // patches back to the cloud after the WhatsApp send.
  const handleSaveAndSend = async (payload) => {
    setJobOpen(false);
    setJobOpenMode('normal');
    setResumeDraftBanner(null);
    setResumeDraftPayload(null);
    celebrateFirstQuote(true);
    try { await onAddJob?.(payload); } catch {}
    setReviewQuoteJob(payload);
  };

  // Voice-quote confirm card (AddJobModal 'quote' view, quoteVoiceStatus
  // 'confirm'): persists the job the same way handleSaveAndSend does, but does
  // NOT open ReviewSheet — the confirm card's own Send button calls
  // sendQuote() directly once the row exists, collapsing the double-review
  // surface for the voice path only (see src/lib/sendQuote.js).
  const handleVoiceQuoteSave = async (payload) => {
    setJobOpen(false);
    setJobOpenMode('normal');
    setResumeDraftBanner(null);
    setResumeDraftPayload(null);
    celebrateFirstQuote(true);
    try { await onAddJob?.(payload); } catch {}
  };

  // ── Ranking (re-runs on jobs or rankVersion change) ──────────────────────────
  // Delegates to the pure rankNextBestAction helper in src/lib/nextBestAction.js.
  // Real function refs are passed so the helper stays free of React imports.
  const { tier, job: promptJob, poolSize: _poolSize } = useMemo(() => {
    const snoozeStore = readSnoozeStore();
    return rankNextBestAction(
      jobs,
      new Date(),
      snoozeStore,
      isAwaitingPayment,
      daysPastDue,
      deriveStatus,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, rankVersion]);

  // ── Weekly momentum line (used in all-clear card + below pivot row) ───────────
  const { weekProfit, weekCount } = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const weekJobs = jobs.filter(j => new Date(j.date || j.createdAt || 0).getTime() >= sevenDaysAgo && j.paid !== false);
    const weekReceipts = receipts.filter(r => new Date(r.date || r.createdAt || 0).getTime() >= sevenDaysAgo);
    const weekEarned = weekJobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const weekSpent = weekReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    return { weekProfit: weekEarned - weekSpent, weekCount: weekJobs.length };
  }, [jobs, receipts]);

  // ── Tax-pot tease (item 1) ───────────────────────────────────────────────────
  // Reuses the same formula as FinanceScreen: month profit × tax_set_aside_pct.
  // overheadTotal is deducted from month profit before applying the percentage
  // (mirrors the FinanceScreen monthTaxPot calculation exactly).
  const taxPotData = useMemo(() => {
    const taxSetAsidePct = Number(profile?.tax_set_aside_pct ?? 20);
    const overheads = Array.isArray(profile?.overheads) ? profile.overheads : [];
    const overheadTotal = getOverheadTotal(overheads);
    const monthSummary = getMonthSummary(jobs, receipts, { month: monthKey(now) });
    const monthTaxPot = Math.max(0, monthSummary.profit - overheadTotal) * taxSetAsidePct / 100;
    return { monthTaxPot: Math.round(monthTaxPot), taxSetAsidePct, hasProfit: monthSummary.profit > 0 };
  }, [jobs, receipts, profile]);

  // Count-up for the Today tax-pot hero line (Pro users only).
  // useCountUp is always called (Rules of Hooks) — isPro check guards rendering.
  const animatedTodayTaxPot = useCountUp(taxPotData.monthTaxPot);

  // ── Today "pulse" dopamine cards (item 1) ────────────────────────────────────
  // Real computed values only — see src/lib/todayPulse.js. Each figure is
  // dropped from the row entirely (not shown as a fake/zero stat) when there
  // isn't genuine, meaningful data behind it yet.
  const pulseWaitingToCollect = useMemo(() => waitingToCollectTotal(jobs), [jobs]);
  const onJobs = useMemo(() => jobsOn(jobs), [jobs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pulseWeekOverWeek = useMemo(() => weekOverWeek(jobs, now), [jobs]);

  const animatedPulseWaitingToCollect = useCountUp(pulseWaitingToCollect);
  // Only used by the N>1 "on" pulse card, but useCountUp must run every
  // render regardless (Rules of Hooks) — see project memory on the hooks-
  // before-early-returns incident.
  const animatedOnCount = useCountUp(onJobs.length);
  const pulseAheadAmount = pulseWeekOverWeek.hasComparison && pulseWeekOverWeek.delta > 0
    ? pulseWeekOverWeek.delta
    : 0;
  const animatedPulseAhead = useCountUp(pulseAheadAmount);

  const pulseCards = [];
  if (pulseWaitingToCollect > 0) {
    pulseCards.push({
      key: 'collect',
      icon: 'money',
      value: gbp(Math.round(animatedPulseWaitingToCollect)),
      label: 'waiting to collect',
      ariaLabel: `${gbp(pulseWaitingToCollect)} waiting to collect — tap to see who owes you`,
      onTap: () => onSeeTheWeek?.(),
    });
  }
  // "On" card — names the actual job when there's exactly one (deep-links
  // straight to it); falls back to a count + "on longest" subline when
  // there's more than one (ambiguous which job to deep-link, so this one
  // opens the Jobs list instead). See src/lib/todayPulse.js for jobsOn /
  // oldestOnJob / daysOnLabel.
  if (onJobs.length === 1) {
    const theOnJob = onJobs[0];
    const rawTitle = theOnJob?.name || theOnJob?.summary || '';
    const customerName = theOnJob?.customer || theOnJob?.customerName || '';
    // Never invent a name: fall back to the customer, then to a literal
    // "Active job" only when both the work title and customer are blank.
    const title = rawTitle || customerName || 'Active job';
    // If the title itself had to fall back to the customer name, don't
    // repeat it on the row below.
    const titleUsedCustomerFallback = !rawTitle && !!customerName;
    const customerText = customerName && !titleUsedCustomerFallback ? customerName : '';
    // On sits outside MONEY_STAGES — an On job may legitimately carry no
    // price yet. Show the value only when it's genuinely > 0; never "£0".
    const amount = jobAmount(theOnJob);
    const amountText = amount > 0 ? gbp(amount) : '';
    const daysOnText = daysOnLabel(theOnJob, now);
    const ariaLead = customerText ? `${title} for ${customerText}` : title;
    const ariaAmount = amountText ? `, ${amountText}` : '';
    pulseCards.push({
      key: 'on',
      variant: 'strip',
      daysOnText,
      title,
      customerText,
      amountText,
      ariaLabel: `${ariaLead}, ${daysOnText}${ariaAmount}. Tap to open the job.`,
      onTap: () => onJobTap?.(theOnJob),
    });
  } else if (onJobs.length > 1) {
    const onCount = onJobs.length;
    const oldest = oldestOnJob(onJobs);
    const oldestName = oldest?.customer || oldest?.customerName || oldest?.name || oldest?.summary || 'Active job';
    const oldestDays = daysOnCount(oldest, now);
    const oldestDaysText = oldestDays <= 0 ? 'started today' : oldestDays === 1 ? '1 day' : `${oldestDays} days`;
    // "+N" names how many OTHER On jobs exist beyond the one shown in the
    // subline; omitted at N=2 total (the subline already implies "and one
    // more" without a redundant "+1").
    const extra = onCount - 1;
    const extraText = extra >= 2 ? ` +${extra}` : '';
    pulseCards.push({
      key: 'on',
      variant: 'count',
      value: String(Math.round(animatedOnCount)),
      label: 'jobs on',
      subline: `on longest: ${oldestName} · ${oldestDaysText}${extraText}`,
      ariaLabel: `${onCount} jobs on right now. On longest: ${oldestName}, ${oldestDaysText}. Tap to see them all.`,
      onTap: () => onSeeTheWeek?.(),
    });
  }
  if (pulseAheadAmount > 0) {
    pulseCards.push({
      key: 'trend',
      icon: 'trend-up',
      value: gbp(Math.round(animatedPulseAhead)),
      label: 'ahead of last week',
      ariaLabel: `${gbp(pulseAheadAmount)} ahead of last week — tap to see your money`,
      onTap: () => onNavigateToMoney?.(),
    });
  }

  // ── Overdue-money push (item 2) ──────────────────────────────────────────────
  // All Tier-1 jobs (overdue + awaiting payment, not snoozed) — used for the
  // "£X overdue across N jobs" banner shown in addition to the hero prompt card.
  // We compute this independently of rankNextBestAction so we can show the total
  // across ALL overdue jobs, not just the highest-ranked one.
  const overduePool = useMemo(() => {
    const snoozeStore = readSnoozeStore();
    return jobs.filter(j =>
      j?.id &&
      isAwaitingPayment(j) &&
      !snoozeStore[j.id] &&
      daysPastDue(j, now) >= 0
    );
  }, [jobs, rankVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const overdueTotal = useMemo(
    () => overduePool.reduce((s, j) => s + jobAmount(j), 0),
    [overduePool]
  );

  // ── Newly accepted quotes — unseen on this device (persistent banner) ──────────
  // Filtered to exclude any jobs the trader has already dismissed this session
  // (dismissedAcceptedIds is the in-memory fast-path; acceptedSeenAt is the durable path).
  const newlyAcceptedJobs = useMemo(() => {
    return getNewlyAcceptedJobs(jobs).filter(j => !dismissedAcceptedIds.has(j.id));
  }, [jobs, dismissedAcceptedIds]);

  // ── Unsent-invoice eligible jobs (for Send Invoice pivot picker) ──────────────
  const uninvoicedJobs = useMemo(() => {
    return jobs.filter(j => {
      const s = deriveStatus(j);
      return (s === 'completed' || s === 'active') && !j.invoiceSentAt;
    });
  }, [jobs]);

  // ── CTA handlers ──────────────────────────────────────────────────────────────

  const handlePrimaryCta = useCallback((ctaAction) => {
    if (!promptJob) return;

    if (ctaAction === 'whatsapp') {
      const phone = promptJob.customerPhone || promptJob.phone || '';
      const name = chaseCustomerFirstName(promptJob);
      const amount = gbp(jobAmount(promptJob));
      const jobSummary = promptJob.name || promptJob.summary || '';
      const dpd = daysPastDue(promptJob, new Date());
      const chaseTier = computeTier(promptJob, new Date());
      const bizName = profile?.business_name || '';
      const payDetails = buildPaymentDetails(profile?.bank_details ? { bankDetails: profile.bank_details } : {
        accountName: profile?.business_name,
        sortCode: profile?.sort_code,
        accountNumber: profile?.account_number,
      });
      const msg = buildChaseMessage({
        customerName: name,
        amount,
        jobSummary,
        invoiceNumber: promptJob.invoiceNumber || '',
        daysOverdue: dpd,
        tier: chaseTier,
        paymentDetails: payDetails,
        businessName: bizName,
        isB2B: !!promptJob.isBusinessCustomer,
      });
      const clean = phone.replace(/\s/g, '').replace(/^0/, '44').replace(/^\+/, '');
      window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      haptic('light');
      // iOS-safe partner: haptic('light') is a no-op on iOS Safari/PWA (see
      // haptics.js), and window.open backgrounds the app to WhatsApp before
      // the trader necessarily notices anything happened in OHNAR itself —
      // the earcon + toast confirm the reminder was actually logged.
      playSendEarcon();
      showToast('Reminder sent');
      recordChase(promptJob.id);
      // Cloud sync is fire-and-forget — localStorage tap is already recorded above.
      recordChaseCloud(promptJob.id, supabase).catch(console.warn);
      setRankVersion(v => v + 1);
      return;
    }

    if (ctaAction === 'email') {
      const email = promptJob.customerEmail || promptJob.email || '';
      // Regression guard: this used to fall back to promptJob.name (the JOB
      // TITLE, e.g. "New doors") when customer/customerName were both blank,
      // which could bleed a job title into the customer greeting. Use the
      // shared first-name-only resolver instead — never the job title.
      const name = chaseCustomerFirstName(promptJob);
      const amount = gbp(jobAmount(promptJob));
      const jobSummary = promptJob.name || promptJob.summary || '';
      const chaseTier = computeTier(promptJob, new Date());
      const dpd = daysPastDue(promptJob, new Date());
      const msg = buildChaseMessage({
        customerName: name,
        amount,
        jobSummary,
        invoiceNumber: promptJob.invoiceNumber || '',
        daysOverdue: dpd,
        tier: chaseTier,
        isB2B: !!promptJob.isBusinessCustomer,
      });
      window.open(`mailto:${email}?subject=Invoice reminder&body=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      haptic('light');
      // iOS-safe partner — see the whatsapp branch above for why.
      playSendEarcon();
      showToast('Reminder sent');
      recordChase(promptJob.id);
      // Cloud sync is fire-and-forget — localStorage tap is already recorded above.
      recordChaseCloud(promptJob.id, supabase).catch(console.warn);
      setRankVersion(v => v + 1);
      return;
    }

    if (ctaAction === 'open') {
      onJobTap?.(promptJob);
      return;
    }

    if (ctaAction === 'send_invoice') {
      // Tier 2: open JobDetailDrawer for this job (the drawer has the Send Invoice action)
      onJobTap?.(promptJob);
      return;
    }

    if (ctaAction === 'log_job') {
      setJobOpen(true);
    }
  }, [promptJob, profile, onJobTap]);

  const handleMarkPaid = useCallback((job, method) => {
    setMarkPaidPickerJob(null);
    onMarkPaid?.(job, method);
    showToast(`${gbp(jobAmount(job))} marked paid`);
    // Item 4: fire paidFlash on the GESTURE (this callback), not at mount.
    // Clear any previous timer so rapid double-taps extend the window cleanly.
    clearTimeout(paidFlashTimerRef.current);
    setPaidFlash(true);
    // setRankVersion deferred until the flash clears (700ms) so the paid card
    // doesn't jump to a new rank position while the green flash is still visible.
    paidFlashTimerRef.current = setTimeout(() => {
      setPaidFlash(false);
      setRankVersion(v => v + 1);
    }, 700);
  }, [onMarkPaid]);

  const handleSnooze = useCallback((job) => {
    snoozeJob(job.id);
    // Snooze state is persisted in the snooze store (readSnoozeStore/writeSnoozeStore),
    // not in the jobMeta side-channel. `snoozedUntil` is intentionally absent from
    // META_FIELDS so it never reaches Supabase. The previous writeJobMeta call here
    // was passing extractJobMeta({ ...job, snoozedUntil }) which silently spread the
    // ENTIRE job snapshot into the pending set (marking status/customer/total/etc.
    // pending with no cloud-clear path) — a regression of the cross-device bug.
    // Removed: snooze is local-only UX; no meta write needed.
    showToast('Snoozed for 24 hours');
    setRankVersion(v => v + 1);
  }, []);

  const handleCardBodyTap = useCallback((job) => {
    if (job) onJobTap?.(job);
  }, [onJobTap]);

  // ── Accepted-quote banner handlers ────────────────────────────────────────────
  const handleAcceptedDismiss = useCallback((job) => {
    const seenAt = new Date().toISOString();
    // Write ONLY acceptedSeenAt — a device-local UI flag that is intentionally
    // never synced to the cloud. The previous extractJobMeta({ ...job, acceptedSeenAt })
    // spread the entire job snapshot into the pending set, marking status/customer/total
    // etc. pending with no cloud-clear path — a regression of the cross-device bug.
    // acceptedSeenAt IS in META_FIELDS so it survives reload; it just doesn't travel
    // between devices (acceptable: each device tracks its own "seen" state).
    writeJobMeta(job.id, { acceptedSeenAt: seenAt });
    setDismissedAcceptedIds(prev => {
      const next = new Set(prev);
      next.add(job.id);
      return next;
    });
  }, []);

  const handleAcceptedTap = useCallback((job) => {
    handleAcceptedDismiss(job);
    if (job) onJobTap?.(job);
  }, [handleAcceptedDismiss, onJobTap]);

  // ── Send Invoice pivot: open picker or toast ──────────────────────────────────
  const handleSendInvoicePivot = () => {
    if (uninvoicedJobs.length === 0) {
      showToast('No jobs to invoice yet — finish a quote or log a job first.');
      return;
    }
    setInvoicePickerOpen(true);
  };

  // ── Prompt card rendering ──────────────────────────────────────────────────────
  const headline = tier < 5 && promptJob ? nbaHeadline(tier, promptJob) : null;
  const meta     = tier < 5 && promptJob ? nbaMeta(tier, promptJob, now)  : null;
  const cta      = tier < 5 && promptJob ? nbaCta(tier, promptJob, profile) : null;
  const label    = tier < 5 && promptJob ? nbaLabel(tier) : null;

  // Override meta.suffix for Tier 1 to include real days-past-due copy
  const resolvedMeta = useMemo(() => {
    if (tier !== 1 || !promptJob || !meta) return meta;
    const dpd = daysPastDue(promptJob, now);
    const overdueTxt = dpd === 0 ? 'due today' : dpd === 1 ? '1 day overdue' : `${dpd} days overdue`;
    return { ...meta, suffix: overdueTxt, negative: true };
  }, [tier, promptJob, meta, now]);

  return (
    <div className="screen today-screen foreman-screen">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="foreman-header screen-header">
        <h1 className="screen-title">{formatToday()}</h1>
        <span className="screen-header-lockup">
          <OhnarWordmark size="30px" />
        </span>
      </header>

      {/* ── Today "pulse" cards (item 1) — real computed data only ─────── */}
      {pulseCards.length > 0 && (
        <div className="today-pulse-row" role="list" aria-label="Today at a glance">
          {pulseCards.map(card => (
            <button
              key={card.key}
              type="button"
              className={`today-pulse-card today-pulse-card--${card.key}${card.variant ? ` today-pulse-card--${card.variant}` : ''}`}
              role="listitem"
              onClick={card.onTap}
              aria-label={card.ariaLabel}
            >
              {card.variant === 'strip' ? (
                <>
                  {/* Row 1 — stage chip + days-on, chevron pinned right */}
                  <span className="today-pulse-strip__row1">
                    <span className="today-pulse-strip__row1-left">
                      <span className="jt-stage-name jt-stage-name--on">On</span>
                      <span className="today-pulse-strip__days">{card.daysOnText}</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="today-pulse-strip__chevron" />
                  </span>
                  {/* Row 2 — work title, primary */}
                  <span className="today-pulse-strip__title">{card.title}</span>
                  {/* Row 3 — customer · value, dim (either half may be absent) */}
                  {(card.customerText || card.amountText) && (
                    <span className="today-pulse-strip__meta">
                      {card.customerText}
                      {card.customerText && card.amountText && ' · '}
                      {card.amountText && (
                        <span className="today-pulse-strip__amount">{card.amountText}</span>
                      )}
                    </span>
                  )}
                </>
              ) : card.variant === 'count' ? (
                <>
                  {/* Row 1 — stage chip + "N jobs on", chevron pinned right */}
                  <span className="today-pulse-strip__row1">
                    <span className="today-pulse-strip__row1-left">
                      <span className="jt-stage-name jt-stage-name--on">On</span>
                      <span className="today-pulse-card__value">{card.value}</span>
                      <span className="today-pulse-card__label">{card.label}</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="today-pulse-strip__chevron" />
                  </span>
                  {/* Row 2 — names the longest-running On job */}
                  <span className="today-pulse-strip__meta">{card.subline}</span>
                </>
              ) : (
                <>
                  <Icon name={card.icon} size={18} className="today-pulse-card__icon" />
                  <span className="today-pulse-card__value">{card.value}</span>
                  <span className="today-pulse-card__label">{card.label}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Get Pro upsell pill (free users + active trials; not paid Pro) ── */}
      {/* Repointed 2026-07-05 (item 5): active trials now see the pill too — */}
      {/* GetProPill itself decides sell (free) vs "use it" (trial) copy.     */}
      {profile?.plan !== 'pro' && (
        <GetProPill
          profile={profile}
          onOpen={() => setUpgradeSheetOpen(true)}
          onNavigateToMoney={onNavigateToMoney}
        />
      )}

      {/* ── Resume-your-quote banner (unsent AddJobModal draft found) ─────── */}
      {/* Protects the "call comes in mid-quote" moment — see src/lib/draftAutosave.js. */}
      {!jobOpen && resumeDraftBanner && (
        <section className="today-resume-draft-banner" aria-label="Resume unsent quote">
          <div className="today-resume-draft-banner__text">
            <Icon name="file" size={16} className="today-resume-draft-banner__icon" />
            <span>
              {resumeDraftBanner.summary || resumeDraftBanner.name
                ? `Resume your ${resumeDraftBanner.summary || resumeDraftBanner.name} quote?`
                : 'Resume your unsent quote?'}
            </span>
          </div>
          <div className="today-resume-draft-banner__actions">
            <button type="button" className="link-btn" onClick={handleResumeDraftDiscard}>
              Discard
            </button>
            <button type="button" className="btn-secondary" onClick={handleResumeDraftContinue}>
              Continue
            </button>
          </div>
        </section>
      )}

      {/* ── Accepted-quote banner (persistent until acknowledged) ─────────── */}
      {newlyAcceptedJobs.length > 0 && (
        <section className="accepted-banner" aria-label="Accepted quotes">
          {newlyAcceptedJobs.map((job) => (
            <div key={job.id} className="accepted-banner__row">
              <button
                type="button"
                className="accepted-banner__body"
                onClick={() => handleAcceptedTap(job)}
                aria-label={`${buildAcceptedLabel(job)} — tap to open job`}
              >
                <Icon name="complete" size={16} variant="success" />
                <span className="accepted-banner__text">
                  <span className="accepted-banner__label">{buildAcceptedLabel(job)}</span>
                  {job.acceptedAt && (
                    <span className="accepted-banner__date">{formatAcceptedDate(job.acceptedAt)}</span>
                  )}
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
              <button
                type="button"
                className="accepted-banner__dismiss"
                onClick={(e) => { e.stopPropagation(); handleAcceptedDismiss(job); }}
                aria-label="Dismiss notification"
              >
                Got it
              </button>
            </div>
          ))}
        </section>
      )}

      {/* ── One Prompt card (or all-clear) ────────────────────────────────── */}
      {tier < 5 && promptJob ? (
        <section
          className={`foreman-prompt-card${paidFlash ? ' foreman-prompt-card--paid-flash' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`${headline} — tap to open job`}
          onClick={(e) => {
            if (!e.target.closest('.foreman-cta-primary') &&
                !e.target.closest('.foreman-secondary-actions') &&
                !e.target.closest('.foreman-mark-paid-picker')) {
              handleCardBodyTap(promptJob);
            }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardBodyTap(promptJob); }}
        >
          <div className="foreman-tier-label">{label}</div>
          <div className="foreman-headline">{headline}</div>
          {resolvedMeta && (
            <div className={`foreman-meta ${resolvedMeta.negative ? 'foreman-meta--overdue' : ''}`}>
              {resolvedMeta.amount != null && (
                <span className={resolvedMeta.negative ? 'foreman-amount--overdue' : 'foreman-amount--neutral'}>
                  {gbp(resolvedMeta.amount)}
                </span>
              )}
              {resolvedMeta.amount != null && resolvedMeta.suffix && <span className="foreman-meta-sep"> — </span>}
              {resolvedMeta.suffix && <span>{resolvedMeta.suffix}</span>}
            </div>
          )}

          {/* Primary CTA */}
          {markPaidPickerJob?.id === promptJob.id ? (
            <div className="foreman-mark-paid-picker" onClick={e => e.stopPropagation()}>
              <div className="foreman-picker-label">How were you paid?</div>
              <div className="foreman-picker-grid">
                <button type="button" className="foreman-picker-btn" onClick={() => handleMarkPaid(promptJob, 'bank transfer')}>Bank</button>
                <button type="button" className="foreman-picker-btn" onClick={() => handleMarkPaid(promptJob, 'cash')}>Cash</button>
                <button type="button" className="foreman-picker-btn" onClick={() => handleMarkPaid(promptJob, 'card')}>Card</button>
              </div>
              <button type="button" className="foreman-picker-cancel" onClick={(e) => { e.stopPropagation(); setMarkPaidPickerJob(null); }}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="foreman-cta-primary"
                onClick={(e) => { e.stopPropagation(); handlePrimaryCta(cta.action); }}
              >
                {cta.label}
              </button>

              {/* Secondary actions */}
              <div
                className="foreman-secondary-actions"
                onClick={e => e.stopPropagation()}
              >
                {tier === 1 && (
                  <>
                    <button
                      type="button"
                      className="foreman-secondary-btn"
                      onClick={() => setMarkPaidPickerJob(promptJob)}
                    >
                      Mark paid
                    </button>
                    <span className="foreman-secondary-sep">·</span>
                    <button
                      type="button"
                      className="foreman-secondary-btn"
                      onClick={() => handleSnooze(promptJob)}
                    >
                      Snooze
                    </button>
                  </>
                )}
                {tier === 2 && (
                  <button
                    type="button"
                    className="foreman-secondary-btn"
                    onClick={() => handleCardBodyTap(promptJob)}
                  >
                    Open job
                  </button>
                )}
                {tier === 3 && (
                  <button
                    type="button"
                    className="foreman-secondary-btn"
                    onClick={() => handleCardBodyTap(promptJob)}
                  >
                    Open quote
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      ) : jobs.length === 0 ? (
        /* ── First-time activation nudge (zero jobs, brand-new user) ─────── */
        <section className="empty-welcome-card" aria-label="Get started">
          <div className="empty-welcome-icon" aria-hidden="true">
            <Icon name="active-job" size={40} variant="brand" />
          </div>
          <div className="empty-welcome-text">
            <p className="empty-welcome-headline">What&rsquo;s today&rsquo;s job?</p>
            <p className="empty-welcome-sub">Log it and see exactly what you made.</p>
          </div>
          <button
            type="button"
            className="btn-primary empty-welcome-cta"
            onClick={() => setJobOpen(true)}
            data-testid="activation-nudge-cta"
          >
            Log your first job
          </button>
          <p className="empty-welcome-reassure">Takes 60 seconds — just the price and what materials cost.</p>
          {isTrialActive(profile) && (
            <p className="empty-welcome-trial">
              You&rsquo;re on a 14-day Pro trial
              {trialDaysLeft(profile) > 0 ? ` — ${trialDaysLeft(profile)} day${trialDaysLeft(profile) === 1 ? '' : 's'} left` : ''}.
            </p>
          )}
          {/* shouldOfferSampleData is redundant with the enclosing jobs.length === 0
              branch today, but makes the "zero REAL jobs" rule explicit and self-
              documenting rather than implicit in the outer condition — and keeps
              this call-site correct if that outer condition ever changes. */}
          {onLoadSampleData && shouldOfferSampleData(jobs) && (
            <button
              type="button"
              className="empty-welcome-sample-cta"
              onClick={handleLoadSampleData}
              disabled={loadingSample}
              data-testid="load-sample-data-cta"
            >
              {loadingSample ? 'Loading sample day…' : 'New here? Load a sample day to see how OHNAR works'}
            </button>
          )}
        </section>
      ) : (
        /* ── All-clear state (slim, no duplicate Log a job) ─────────────── */
        <section className="foreman-empty-card foreman-empty-card--slim">
          <div className="foreman-empty-check" aria-hidden="true">
            <Icon name="complete" size={32} variant="success" />
          </div>
          <div className="foreman-empty-headline">
            {/* Warm the headline only when there's real activity to be warm
                about (item 3) — never praise a week that didn't happen. */}
            <p>{weekCount > 0 ? 'All clear — nice work.' : 'All clear.'}</p>
          </div>
          {weekCount > 0 ? (
            <p className="foreman-empty-meta">
              <span className="foreman-empty-meta__earned">{gbp(weekProfit)}</span> in the last 7 days
            </p>
          ) : (
            <p className="foreman-empty-meta">Nothing overdue. Nothing waiting.</p>
          )}
          <button
            type="button"
            className="foreman-empty-secondary"
            onClick={() => onSeeTheWeek?.()}
          >
            Go to Jobs
          </button>
        </section>
      )}

      {/* ── Pivot buttons (quick-action grid) ────────────────────────────── */}
      <div className="foreman-pivot-row foreman-pivot-row--three">
        <button
          type="button"
          className="foreman-pivot-btn"
          onClick={() => setJobOpen(true)}
        >
          <Icon name="active-job" size={24} className="foreman-pivot-icon" />
          Log a job
        </button>
        <button
          type="button"
          className="foreman-pivot-btn foreman-pivot-btn--voice"
          onClick={() => { setJobOpenMode('quote'); setJobOpen(true); }}
          aria-label="Quote it — speak your quote, or type it"
        >
          {/* Item 4: mic (not a generic file icon) + a subtle pulsing ring so
              the wedge feature — voice-to-quote — reads as "speak it" at a
              glance, without adding a second line of text to the button. */}
          <span className="foreman-pivot-mic-badge">
            <Icon name="mic" size={24} className="foreman-pivot-icon" />
          </span>
          Quote it
        </button>
        <button
          type="button"
          className="foreman-pivot-btn"
          onClick={handleSendInvoicePivot}
        >
          <Icon name="send" size={24} className="foreman-pivot-icon" />
          Send invoice
        </button>
      </div>

      {/* ── Overdue-money push (item 2) — shown when ≥2 overdue jobs exist ─── */}
      {/* The hero prompt card already features the top-ranked one; this banner  */}
      {/* surfaces the full pool so the trader knows the total at stake.          */}
      {overduePool.length >= 2 && (
        <button
          type="button"
          className="today-overdue-push"
          onClick={() => onSeeTheWeek?.()}
          aria-label={`${gbp(overdueTotal)} overdue across ${overduePool.length} jobs — tap to see all`}
        >
          <Icon name="alert" size={16} className="today-overdue-push__icon" />
          <span className="today-overdue-push__text">
            <span className="today-overdue-push__amount">{gbp(overdueTotal)}</span>
            {' '}overdue across {overduePool.length} jobs
          </span>
          <Icon name="chevron-right" size={16} className="today-overdue-push__chevron" />
        </button>
      )}

      {/* ── Weekly check-in line (shown when there's activity) ───────────── */}
      {weekCount > 0 && (
        <button
          type="button"
          className="foreman-week-line"
          onClick={() => onNavigateToMoney?.()}
        >
          {weekCount === 1
            ? <>Your week so far: <span className="foreman-week-profit">{gbp(weekProfit)}</span> from 1 job</>
            : <>This week: <span className="foreman-week-profit">{gbp(weekProfit)}</span> &middot; {weekCount} jobs</>
          }
        </button>
      )}

      {/* ── Tax-pot tease (item 1) ────────────────────────────────────────── */}
      {/* Pro users with profit see their real set-aside figure. Free users    */}
      {/* with profit see a locked tease that opens the upgrade sheet.         */}
      {taxPotData.hasProfit && (
        isPro(profile) ? (
          <button
            type="button"
            className="today-tax-pot-line"
            onClick={() => onNavigateToMoney?.()}
            aria-label={`Tax pot: set aside £${taxPotData.monthTaxPot} this month — tap to open Money`}
          >
            <Icon name="tip" size={14} />
            {' '}Set aside{' '}
            <strong>{gbp(Math.round(animatedTodayTaxPot))}</strong>{' '}
            for tax this month
          </button>
        ) : (
          <button
            type="button"
            className="today-tax-pot-line today-tax-pot-line--locked"
            onClick={() => setUpgradeSheetOpen(true)}
            aria-label="Tax pot locked — get Pro to see your monthly set-aside"
          >
            <Icon name="lock" size={14} />
            {' '}Tax pot this month{' '}
            <span className="today-tax-pot-line__pro-badge">Pro</span>
          </button>
        )
      )}

      {/* ── Send Invoice job picker (pivot fallback) ───────────────────────── */}
      {/* Rendered in a portal so it escapes the .dp-viewport stacking context
          (otherwise the bottom-nav sibling paints over it) and the pager's
          touch subtree (otherwise tap-hold-drag bubbles into the swipe
          handler) — same fix as WorkScreen's confirmDeleteJob/confirmBookJob. */}
      {invoicePickerOpen && createPortal(
        <div
          className="foreman-invoice-picker-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Pick a job to invoice"
        >
          <div className="foreman-invoice-picker">
            <div className="foreman-invoice-picker-header">
              <h2 className="foreman-invoice-picker-title">Which job to invoice?</h2>
              <button
                type="button"
                className="foreman-invoice-picker-close"
                aria-label="Close"
                onClick={() => setInvoicePickerOpen(false)}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <ul className="foreman-invoice-picker-list">
              {uninvoicedJobs.map(j => (
                <li key={j.id}>
                  <button
                    type="button"
                    className="foreman-invoice-picker-item"
                    onClick={() => { setInvoicePickerOpen(false); onJobTap?.(j); }}
                  >
                    <span className="foreman-invoice-picker-name">
                      {j.customer || j.customerName || j.name || 'Job'}
                    </span>
                    {jobAmount(j) > 0 && (
                      <span className="foreman-invoice-picker-amount">{gbp(jobAmount(j))}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {jobOpen && (
        <AddJobModal
          onClose={() => {
            setJobOpen(false);
            setJobOpenMode('normal');
            setResumeDraftPayload(null);
            // Re-check storage: closing WITHOUT saving leaves the autosaved
            // draft in place, so the banner should offer to resume it again
            // later in this same session (not just after a reload).
            setResumeDraftBanner(loadDraft());
          }}
          onSave={handleJobSave}
          onOpenDetailed={onOpenDetailed}
          defaultMode={jobOpenMode === 'quote' ? 'quote' : undefined}
          resumeDraft={resumeDraftPayload}
          onSaveAndSend={handleSaveAndSend}
          onVoiceQuoteSave={handleVoiceQuoteSave}
          profile={profile}
          onUpdateJob={onUpdateJob}
          flash={showToast}
          tradePrimary={profile?.trade_primary ?? null}
          materials={materials}
          defaultMarkup={defaultMarkup ?? profile?.default_markup ?? 20}
          onBrowseMaterials={onBrowseMaterials}
          onMaterialSaved={onMaterialSaved}
        />
      )}

      {reviewQuoteJob && (
        <ReviewSheet
          mode="quote"
          job={reviewQuoteJob}
          biz={{ name: profile?.business_name || '' }}
          profile={profile}
          jobs={jobs}
          receipts={receipts}
          onUpdate={(updatedJob) => { onUpdateJob?.(updatedJob); setReviewQuoteJob(null); }}
          onClose={() => setReviewQuoteJob(null)}
          onDismiss={() => setReviewQuoteJob(null)}
          onProfileUpdate={onProfileUpdate}
          flash={showToast}
        />
      )}

      {/* toast / got-paid chips / pay-now nudge removed (JP-LU2) — rendered by
          <Snackbar /> in AppShell.jsx via onSnackbar / onSnackbarDismiss props. */}


      {/* ── ProUpgradeSheet — opened by GetProPill on Today ──────────────── */}
      {/* profile is threaded through so cardFreeEligible (see ProUpgradeSheet.jsx)
          can route expired/free profiles to the honest card-required "Get Pro —
          £12/mo" CTA instead of the card-free trial promise (fix/today-pill-honest-cta,
          same bug class as feat/pro-billing-tidy #600 — this call site was missed). */}
      <ProUpgradeSheet
        open={upgradeSheetOpen}
        trigger={UPGRADE_TRIGGERS.TODAY_PILL}
        profile={profile}
        onClose={() => setUpgradeSheetOpen(false)}
      />
    </div>
  );
}
