/**
 * FinanceScreen — Money tab (slice-3 nav).
 *
 * Phase 1 — Profit insight redesign.
 * Phase 2 — Tax Set-Aside card + Pro gating.
 * JTBD: "Am I making money, and have I kept enough for tax?"
 *
 * Top-to-bottom card order:
 *   1. Hero — Profit (this month), big figure, negative state, empty state  [FREE]
 *   2. UpgradeBanner — shown ONCE for free users, just below the hero       [FREE]
 *   2b. Accountant tools — export CSV (moved up for discoverability)        [FREE]
 *   3. Tax Set-Aside card                                                    [PRO]
 *   4. True Profit (after monthly bills) card                               [PRO]
 *   5. Cashflow chart                                                        [FREE]
 *   6. Month pace two-up — Paid in (left) + Jobs done (right)               [FREE]
 *   7. Est. Profit/Hour insight card                                         [PRO]
 *   8. Margin nudge (conditional — only when |delta| >= 10%)                [PRO]
 *   9. Recent transactions — collapsed expandable timeline                  [FREE]
 *
 * Pro gating: free users see ONE consolidated "Unlock the Insight Layer" card
 * (money-insight-locked-gate) instead of four separate blurred ProGate cards.
 * Pro users see Tax Pot, Profit/Hour, Best/Worst, and Margin nudge ungated.
 * VAT card has its own independent ProGate (tied to isVatRegistered, not the
 * Insight Layer gate).
 *
 * UpgradeBanner is rendered once for non-Pro users so the upgrade CTA
 * never repeats for each insight.
 *
 * Upgrade flow: onUpgrade prop bubbles up to AppShell. Wiring to a real
 * Stripe/waitlist paywall is a separate task — today it falls back to the
 * Tally waitlist URL used by SendInvoiceModal's paywall view.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { gbp, todayKey } from '../lib/today';
import { isPro, isFoundingEligible, isFoundingMember, isTrialActive, trialDaysLeft } from '../lib/plan';
import { useCountUp } from '../lib/useCountUp';
import Icon from '../components/Icon';
import HeaderAvatar from '../components/HeaderAvatar';
import CashflowChart from '../components/CashflowChart';
import ProGate from '../components/ProGate';
import ProUpgradeSheet from '../components/ProUpgradeSheet';
import OhnarWordmark from '../components/OhnarWordmark';
import MoneyScreenSkeleton from '../components/MoneyScreenSkeleton';
import { logTelemetry, UPGRADE_TRIGGERS } from '../lib/telemetry';
import {
  getCashflowByMonth,
  getMonthSummary,
  getTaxYearSummary,
  getProfitPerHour,
  getMarginTrend,
  buildDateRange,
  monthKey,
  getOverheadTotal,
  getBestWorstJobs,
  getVatSummary,
  vatQuarterRange,
  getDataTrustHint,
  getOutstandingSummary,
} from '../lib/cashflow';

// Margin nudge fires only when the absolute delta meets or exceeds this threshold.
// One nudge max — priority: margin drop (or gain) first.
const MARGIN_NUDGE_THRESHOLD_PCT = 10;

/**
 * UpgradeBanner — rendered ONCE on the Money tab for free users, just below
 * the profit hero. Never rendered for Pro users.
 * Tapping "Start 14-day trial" opens ProUpgradeSheet (source='upgrade_banner').
 */
function UpgradeBanner({ onUpgrade }) {
  return (
    <div className="upgrade-banner">
      <div className="upgrade-banner__copy">
        <span className="upgrade-banner__headline">See what you actually kept</span>
        <span className="upgrade-banner__sub">True profit after costs, your tax pot, profit per hour &mdash; £12/mo</span>
      </div>
      <button
        type="button"
        className="upgrade-banner__btn"
        onClick={() => onUpgrade?.()}
      >
        Start 14-day trial
      </button>
    </div>
  );
}

// Margin colour — reads from the same CSS tokens used everywhere else in the app
// so the same threshold renders the same colour on every card/screen.
function marginColor(margin) {
  if (margin >= 30) return 'var(--accent)';
  if (margin >= 15) return 'var(--jp-amber)';  // #d97706 — unified warn token
  return 'var(--danger)';                       // #dc2626 — unified danger token
}

/**
 * BestWorstCard — display-only card showing highest and lowest-profit jobs
 * for the current tax year. Tap-to-navigate is a v2 follow-up.
 */
function BestWorstCard({ best, worst }) {
  return (
    <div className="money-card money-best-worst">
      <div className="money-best-worst__header">
        <span className="money-best-worst__label">Best &amp; worst jobs</span>
        <span className="money-best-worst__sub">this tax year</span>
      </div>
      <div className="money-best-worst__rows">
        {/* Best job row */}
        <div className="money-best-worst__row">
          <span className="money-best-worst__tag money-best-worst__tag--best">Best</span>
          <span className="money-best-worst__job-name pro-gate__figure">{best.label}</span>
          <span
            className="money-best-worst__figure pro-gate__figure"
            style={{ color: marginColor(best.margin) }}
          >
            {best.profit >= 0 ? '+' : ''}&pound;{Math.round(Math.abs(best.profit))}
            <span className="money-best-worst__margin">&nbsp;{best.margin}%</span>
          </span>
        </div>

        {/* Worst job row — only when a second qualifying job exists */}
        {worst && (
          <div className="money-best-worst__row money-best-worst__row--worst">
            <span className="money-best-worst__tag money-best-worst__tag--worst">Worst</span>
            <span className="money-best-worst__job-name pro-gate__figure">{worst.label}</span>
            <span
              className="money-best-worst__figure pro-gate__figure"
              style={{ color: marginColor(worst.margin) }}
            >
              {worst.profit >= 0 ? '+' : '-'}&pound;{Math.round(Math.abs(worst.profit))}
              <span className="money-best-worst__margin">&nbsp;{worst.margin}%</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tax Pot Sheet ──────────────────────────────────────────────────────────────
// Preset chips + custom field to change tax_set_aside_pct from the Money tab.
// Writes via onProfileUpdate (same Supabase path as Settings). One source of truth.
const TAX_PRESETS = [15, 20, 25, 30];

function TaxPotSheet({ open, onClose, currentPct, monthProfit, onSave }) {
  const [selected, setSelected] = useState(currentPct ?? 20);
  const [customRaw, setCustomRaw] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  // Reset state whenever sheet opens so we reflect current profile value
  useEffect(() => {
    if (open) {
      const pct = currentPct ?? 20;
      setSelected(pct);
      setCustomMode(!TAX_PRESETS.includes(pct));
      setCustomRaw(TAX_PRESETS.includes(pct) ? '' : String(pct));
    }
  }, [open, currentPct]);

  // Focus custom input when custom mode activates
  useEffect(() => {
    if (customMode && open) inputRef.current?.focus();
  }, [customMode, open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Gate the pager while this sheet is open.
  // 'overlay-open' is the shared signal checked by useDashboardPager.
  useEffect(() => {
    if (open) {
      document.body.classList.add('overlay-open');
    } else {
      document.body.classList.remove('overlay-open');
    }
    return () => { document.body.classList.remove('overlay-open'); };
  }, [open]);

  if (!open) return null;

  const effectivePct = customMode
    ? Math.min(60, Math.max(0, parseInt(customRaw, 10) || 0))
    : selected;

  const keepBack = Math.max(0, monthProfit) * effectivePct / 100;
  const showLowWarning = effectivePct < 15 && effectivePct > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(effectivePct);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="tax-pot-sheet-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="tax-pot-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Tax pot percentage"
      >
        <div className="tax-pot-sheet__header">
          <span className="tax-pot-sheet__title">Tax pot</span>
          <button
            type="button"
            className="tax-pot-sheet__close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="tax-pot-sheet__body">
          {/* Preset chips */}
          <div className="tax-pot-sheet__chips">
            {TAX_PRESETS.map(pct => (
              <button
                key={pct}
                type="button"
                className={`tax-pot-sheet__chip${selected === pct && !customMode ? ' tax-pot-sheet__chip--active' : ''}`}
                onClick={() => { setSelected(pct); setCustomMode(false); setCustomRaw(''); }}
              >
                {pct}%
              </button>
            ))}
            <button
              type="button"
              className={`tax-pot-sheet__chip${customMode ? ' tax-pot-sheet__chip--active' : ''}`}
              onClick={() => { setCustomMode(true); setCustomRaw(String(selected)); }}
            >
              Custom %
            </button>
          </div>

          {/* Custom input — shown only in custom mode */}
          {customMode && (
            <div className="tax-pot-sheet__custom-row">
              <input
                ref={inputRef}
                type="number"
                min="0"
                max="60"
                step="1"
                className="tax-pot-sheet__custom-input"
                placeholder="e.g. 22"
                value={customRaw}
                onChange={e => setCustomRaw(e.target.value)}
              />
              <span className="tax-pot-sheet__custom-pct">%</span>
            </div>
          )}

          {/* Live consequence */}
          <div className="tax-pot-sheet__consequence">
            Keep back <strong>£{keepBack.toFixed(0)}</strong> this month
          </div>

          {/* Low-% advisory — non-blocking */}
          {showLowWarning && (
            <p className="tax-pot-sheet__low-warning">
              Most sole traders keep back 20–25%. Your call.
            </p>
          )}

          {/* Reassurance */}
          <p className="tax-pot-sheet__reassurance">
            This is a guide. We don&rsquo;t touch your money.
          </p>

          <button
            type="button"
            className="tax-pot-sheet__save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * FoundingMemberCard — shown only to founding-eligible users (created before
 * FOUNDER_CUTOFF, not yet Pro, not already a Founding Member). Renders above
 * the standard UpgradeBanner so it is the first upgrade surface they see.
 *
 * Copy is confirmed by PRD + FIN — use verbatim. No emoji (mid-migration to
 * Lucide icons). No crossed-out price comparison (no £6 tier exists).
 *
 * Props:
 *   onCta     — called when the no-card CTA is tapped. MUST NEVER open a card
 *               form or Stripe checkout — see handleFoundingMemberCta in parent.
 *   confirmed — true once the user tapped the CTA this session; swaps the button
 *               for an inline confirmation so they know the trial is running.
 *   daysLeft  — days remaining in their active trial (0 when not yet started).
 */
function FoundingMemberCard({ onCta, confirmed = false, daysLeft = 0 }) {
  return (
    <div className="founding-member-card" role="region" aria-label="Founding Member offer">
      <div className="founding-member-card__badge">Founding Member</div>
      <div className="founding-member-card__headline">
        <span className="founding-member-card__price">£12</span>
        <span className="founding-member-card__period">/mo</span>
        <span className="founding-member-card__lock"> — locked for life</span>
      </div>
      <p className="founding-member-card__body">
        You&rsquo;re one of our first. This price never goes up for you. Plus a direct line to us and a say in what we build.
      </p>
      {confirmed ? (
        /* Post-CTA confirmation — no card, no Stripe, just clarity */
        <div className="founding-member-card__confirmed-trial" role="status">
          <Icon name="check-circle" size={16} variant="success" aria-hidden="true" />
          {daysLeft > 0
            ? <>You&rsquo;re on your 14-day Pro trial &mdash; no card needed &middot; {daysLeft} day{daysLeft === 1 ? '' : 's'} left</>
            : <>Your Pro trial is active &mdash; no card needed</>}
        </div>
      ) : (
        <button
          type="button"
          className="founding-member-card__cta"
          onClick={() => onCta?.()}
        >
          Start 14-day free trial — no card
        </button>
      )}
      <p className="founding-member-card__small-print">
        For our earliest users, while you&rsquo;re subscribed.
      </p>
    </div>
  );
}

export default function FinanceScreen({ jobs = [], receipts = [], session, profile, biz, onAvatarClick, onUpgrade, onGoToJobs, onGoToSettings, onNavigateToCardPayments, onProfileUpdate, onExport, entryPoint = 'nav', isActive = true }) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [trustHintDismissed, setTrustHintDismissed] = useState(false);
  // "More insights" expander — hides secondary analytics behind a single tap
  const [moreInsightsOpen, setMoreInsightsOpen] = useState(false);
  // chartRange drives which window of data getCashflowByMonth uses.
  // '6m' is the default matching the chart's defaultRange prop.
  const [chartRange, setChartRange] = useState('6m');
  // upgradeSheetOpen: controls ProUpgradeSheet visibility.
  // upgradeSheetSource: telemetry source field passed to the sheet.
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false);
  const [upgradeSheetSource, setUpgradeSheetSource] = useState('upgrade_banner');
  // foundingCtaDone: true once the user taps the "Start 14-day free trial — no card"
  // button on FoundingMemberCard. Swaps the button for an inline confirmation. Resets
  // on remount (per-session) — the card is hidden entirely once they're Pro/founding_member.
  const [foundingCtaDone, setFoundingCtaDone] = useState(false);

  const openUpgradeSheet = useCallback((trigger = UPGRADE_TRIGGERS.INSIGHT_LOCKED) => {
    setUpgradeSheetSource(trigger);
    setUpgradeSheetOpen(true);
  }, []);

  // ── Insight tab open event ───────────────────────────────────────────────────
  // Previously: fired once on mount (component was conditionally rendered, so
  // each mount = a new tab visit). Now the pager always mounts all 3 screens, so
  // we gate on `isActive` becoming true for the first time instead. The ref
  // guard ensures we still fire exactly once per "visit" (isActive true→false→true
  // would re-fire, matching the old unmount/remount behaviour).
  const hasLoggedOpen = useRef(false);
  useEffect(() => {
    if (!isActive) return;
    if (hasLoggedOpen.current) return;
    hasLoggedOpen.current = true;
    logTelemetry('insight_tab_opened', {
      entry_point: entryPoint,
      unprompted: entryPoint === 'nav',
    });
  // entryPoint is stable (passed from AppShell with a fixed string)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // ── Accountant export state ───────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  const handleMoneyExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onExport?.('records');
    } finally {
      setExporting(false);
    }
  }, [exporting, onExport]);

  // ── Tax Pot Sheet state ──────────────────────────────────────────────────────
  const [taxPotSheetOpen, setTaxPotSheetOpen] = useState(false);

  const handleTaxPotSave = useCallback(async (newPct) => {
    if (onProfileUpdate) {
      await onProfileUpdate({ tax_set_aside_pct: newPct });
    }
  }, [onProfileUpdate]);

  // ── Pay-now Money banner (Section 1.3 b) ────────────────────────────────────
  // Shown when: trader is not connected to Stripe AND has 2+ unpaid invoices.
  // Dismissible: persists 14 days via localStorage.
  // All hooks must precede any conditional return.
  const [payNowBannerDismissed, setPayNowBannerDismissed] = useState(() => {
    try {
      const ts = localStorage.getItem('pay_now_money_banner_dismissed_at');
      if (!ts) return false;
      const dismissedAt = new Date(ts);
      const fourteenDays = 14 * 24 * 60 * 60 * 1000;
      return (Date.now() - dismissedAt.getTime()) < fourteenDays;
    } catch {
      return false;
    }
  });

  const handlePayNowBannerDismiss = useCallback(() => {
    setPayNowBannerDismissed(true);
    try {
      localStorage.setItem('pay_now_money_banner_dismissed_at', new Date().toISOString());
    } catch {
      // localStorage unavailable (incognito / full) — dismiss in-memory only
    }
  }, []);

  const now = new Date();
  const currentMonth = monthKey(now);

  // ── Today's Earned / Spent / Profit (relocated from TodayScreen) ─────────────
  // Shows today's numbers as the top card on Money — same dopamine, one tab away.
  const todayEarnedSpentProfit = useMemo(() => {
    const key = todayKey(now);
    const todayJobs = jobs.filter(j => (j.date || '').slice(0, 10) === key);
    const todayReceipts = receipts.filter(r => (r.date || '').slice(0, 10) === key);
    const earned = todayJobs.filter(j => j.paid !== false).reduce((s, j) => s + Number(j.amount || 0), 0);
    const spent = todayReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    return { earned, spent, profit: earned - spent, hasToday: todayJobs.length > 0 || todayReceipts.length > 0 };
  }, [jobs, receipts]);
  // Destructure primitives so the React Compiler can track exact deps.
  const hourlyRate = Number(profile?.hourly_rate) || 0;
  const taxSetAsidePct = Number(profile?.tax_set_aside_pct ?? 20);
  const userIsPro = isPro(profile);
  const userIsFoundingEligible = isFoundingEligible(profile);
  const userIsFoundingMember = isFoundingMember(profile);
  const overheads = Array.isArray(profile?.overheads) ? profile.overheads : [];
  const overheadTotal = getOverheadTotal(overheads);
  const isCisSubcontractor = !!profile?.is_cis_subcontractor;

  // VAT registration: slice-3/new-nav stores the VAT number on profile.vat_number.
  // Legacy App.jsx uses biz.vatRegistered. Support both so the card works in all nav modes.
  const isVatRegistered = !!(profile?.vat_number) || !!(biz?.vatRegistered);

  // ── Derived data ────────────────────────────────────────────────────────────
  const {
    cashflowData,
    monthSummary,
    ytd,
    profitPerHour,
    marginTrend,
    timelineGroups,
    hasActivity,
    bestWorstJobs,
    vatSummary,
    vatQuarter,
    dataTrustHint,
    outstandingSummary,
  } = useMemo(() => {
    // ── Cashflow chart data ────────────────────────────────────────────────
    const rangeMap = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y' };
    const rangeKey = rangeMap[chartRange] || '6M';
    const { from, to } = buildDateRange(rangeKey, now);
    const cashflowData = getCashflowByMonth(jobs, receipts, from, to);

    // ── Month summary (hero + two-up stat cards) ───────────────────────────
    const monthSummary = getMonthSummary(jobs, receipts, { month: currentMonth });

    // ── Est. Profit/Hour ───────────────────────────────────────────────────
    const profitPerHour = getProfitPerHour(jobs, { hourlyRate, weeks: 1 }, now);

    // ── Margin trend (single nudge) ────────────────────────────────────────
    const marginTrend = getMarginTrend(jobs, receipts, { weeks: 1 }, now);

    // ── Timeline (collapsed at bottom) ────────────────────────────────────
    const allEntries = [
      ...jobs.map(j => ({
        id: 'j' + j.id,
        label: j.name || j.customer || 'Job',
        amount: Number(j.amount || 0),
        ts: j.createdAt || j.date,
      })),
      ...receipts.map(r => ({
        id: 'r' + r.id,
        label: r.label || 'Receipt',
        amount: -Number(r.amount || 0),
        ts: r.createdAt || r.date,
      })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    const groups = {};
    const _now = new Date();
    for (const e of allEntries) {
      const d = new Date(e.ts);
      const key = keyOfDay(d);
      if (!groups[key]) groups[key] = { label: labelOfDay(d, _now), entries: [] };
      groups[key].entries.push(e);
    }
    const timelineGroups = Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([k, v]) => ({ key: k, ...v }));

    const hasActivity = timelineGroups.length > 0;

    // ── YTD tax-year summary ───────────────────────────────────────────────
    // Pass profile so CIS deductions are resolved correctly for subbies.
    // Non-CIS users get identical numbers to before (cisDeductedYtd=0).
    const ytd = getTaxYearSummary(jobs, receipts, now, profile);

    // ── Best & worst jobs (current tax year) ──────────────────────────────
    const bestWorstJobs = getBestWorstJobs(jobs, receipts, now);

    // ── VAT summary (current calendar quarter) ────────────────────────────
    const vatSummary = getVatSummary(jobs, receipts, now);
    const vatQuarter = vatQuarterRange(now);

    // ── Data-trust nudge ──────────────────────────────────────────────────
    const dataTrustHint = getDataTrustHint(jobs, receipts, profile, now);

    // ── Outstanding / still owed (all unpaid jobs) ────────────────────────
    const outstandingSummary = getOutstandingSummary(jobs);

    return {
      cashflowData,
      monthSummary,
      ytd,
      profitPerHour,
      marginTrend,
      timelineGroups,
      hasActivity,
      bestWorstJobs,
      vatSummary,
      vatQuarter,
      dataTrustHint,
      outstandingSummary,
    };
  }, [jobs, receipts, chartRange, currentMonth, hourlyRate, profile]);


  // ── YTD-derived values ───────────────────────────────────────────────────────
  // For CIS users: set-aside base is nonCisProfit only (CIS work already taxed at source).
  // For non-CIS users: ytd.nonCisProfit === ytd.profit, so the result is identical.
  const ytdSetAsideBase = isCisSubcontractor ? ytd.nonCisProfit : ytd.profit;
  const ytdTaxPot = Math.max(0, ytdSetAsideBase) * taxSetAsidePct / 100;
  const monthTaxPot = Math.max(0, monthSummary.profit - overheadTotal) * taxSetAsidePct / 100;
  const isYtdProfitNegative = ytd.profit < 0;

  // handleUpgrade: opens the ProUpgradeSheet. The onUpgrade prop is kept for
  // backward-compatibility with any parent that may wire it, but the primary
  // path is always the sheet (which then calls startCheckout internally).
  // All callers pass an UPGRADE_TRIGGERS value as the trigger argument.
  // IMPORTANT: this MUST NOT be used for the FoundingMemberCard CTA — that
  // button has a "no card" promise. Use handleFoundingMemberCta instead.
  const handleUpgrade = useCallback((trigger = UPGRADE_TRIGGERS.INSIGHT_LOCKED) => {
    openUpgradeSheet(trigger);
    onUpgrade?.();
  }, [openUpgradeSheet, onUpgrade]);

  // handleFoundingMemberCta — handles the "Start 14-day free trial — no card" button
  // on FoundingMemberCard. This function MUST NEVER open a card form, Stripe checkout,
  // or ProUpgradeSheet. The trial auto-starts at first use (AppShell / initTrialOnFirstUse),
  // so the CTA just records founding intent and shows inline confirmation.
  //
  // Correct behaviour by profile state:
  //   plan=trial, trial_ends_at set  → trial already running; show confirmation + days left
  //   plan=trial, trial_ends_at null → trial will start on next profile refresh (auto);
  //                                    show "starting" confirmation (no card)
  //   any other state                → should not reach here (card is hidden for Pro users)
  const handleFoundingMemberCta = useCallback(() => {
    // Record intent in localStorage so we can reward the founding price at checkout
    // without requiring a DB column. A full server-side mark happens at Stripe webhook.
    try {
      const userId = session?.user?.id;
      if (userId) {
        localStorage.setItem(`jp.foundingIntent.${userId}`, new Date().toISOString());
      }
    } catch {
      // Private browsing — intent is still tracked via telemetry
    }
    logTelemetry('founding_member_cta_tapped', {
      trial_active: isTrialActive(profile),
      days_left: trialDaysLeft(profile),
    });
    // Show inline confirmation — no card form, no sheet, no redirect
    setFoundingCtaDone(true);
  }, [session, profile]);

  // ── Insight card view events (Pro users only — free users see blurred teasers) ─
  // Fired once per mount, only when the user is Pro and the card has real data.
  // A ref guards against re-fire if the component re-renders on the same mount.
  const insightEventsFiredRef = useRef(false);
  useEffect(() => {
    if (insightEventsFiredRef.current) return;
    if (!userIsPro) return;
    insightEventsFiredRef.current = true;

    // tax_pot_viewed: fire when Tax Pot card has real data.
    if (ytd.profit > 0 || ytd.cisDeductedYtd > 0) {
      const taxPotKey = 'jp.telemetry.taxPotFirstView';
      const firstViewRaw = localStorage.getItem(taxPotKey);
      const isReturnVisit = !!firstViewRaw;
      const daysSinceFirst = firstViewRaw
        ? Math.floor((Date.now() - Number(firstViewRaw)) / 86400000)
        : 0;
      if (!firstViewRaw) {
        try { localStorage.setItem(taxPotKey, String(Date.now())); } catch { /* localStorage full */ }
      }
      logTelemetry('tax_pot_viewed', { is_return_visit: isReturnVisit, days_since_first_view: daysSinceFirst });
    }

    // profit_per_hour_viewed: fire when the card has a real computed value.
    if (profitPerHour.value !== null) {
      logTelemetry('profit_per_hour_viewed');
    }
  });
  // Note: no deps array — the ref guards against re-fire within the same mount.
  // This fires after every render but exits immediately after the first Pro render.
  // An empty deps array would miss the case where userIsPro flips from false to true
  // within the same mount (e.g. plan refresh after webhook).

  // handleTrustHintCta: tap-through for the data trust nudge.
  // markPaid → Jobs tab; noCosts → Settings tab scrolled to overheads section.
  // Passes 'overheads' as the scroll target so AppShell can tell SettingsScreen
  // where to land. NOTE: section naming/structure is pending PRD's redesign.
  const handleTrustHintCta = useCallback(() => {
    if (!dataTrustHint) return;
    if (dataTrustHint.type === 'markPaid' && onGoToJobs) {
      onGoToJobs();
    } else if (dataTrustHint.type === 'noCosts' && onGoToSettings) {
      onGoToSettings('overheads');
    }
  }, [dataTrustHint, onGoToJobs, onGoToSettings]);

  // ── Margin nudge: surface only when |delta| >= threshold ────────────────────
  const showMarginNudge = Math.abs(marginTrend.deltaPct) >= MARGIN_NUDGE_THRESHOLD_PCT;
  const marginNudgeCopy = showMarginNudge
    ? marginTrend.deltaSign === 'up'
      ? `Your margin improved ${Math.round(marginTrend.deltaPct)}% vs last week`
      : `Your margin dropped ${Math.round(Math.abs(marginTrend.deltaPct))}% vs last week — see why`
    : null;

  const totalTimelineEntries = timelineGroups.reduce((s, g) => s + g.entries.length, 0);

  // ── "Money in 5 seconds" header numbers ─────────────────────────────────────
  // Kept = YTD profit minus the tax pot (what's actually yours to spend).
  // For free users we show the gross YTD profit so the number is always real —
  // the tax-pot deduction is a Pro insight but the top-line figure belongs to all.
  const keptAmount = Math.max(0, ytd.profit) - ytdTaxPot;

  // ── Hero profit copy ─────────────────────────────────────────────────────────
  const isEmptyMonth = monthSummary.paid === 0 && monthSummary.jobCount === 0;
  const isProfitNegative = monthSummary.profit < 0;

  // ── Count-up animations for the focal hero figures ───────────────────────────
  // Only the big headline numbers get the count-up treatment.
  // useCountUp returns the target immediately when prefers-reduced-motion is set.
  // enabled:false while profile===null keeps the animation held at 0 behind the
  // skeleton; flipping true once profile resolves runs a single clean 0→target
  // animation that the user actually sees. Without this, the count-up fires
  // before the skeleton drops and is invisible.
  const countUpEnabled = profile !== null;
  const animatedKept       = useCountUp(Math.round(keptAmount),                      { enabled: countUpEnabled });
  const animatedTaxPot     = useCountUp(Math.round(ytdTaxPot),                       { enabled: countUpEnabled });
  const animatedOwed       = useCountUp(Math.round(outstandingSummary.totalOwed),    { enabled: countUpEnabled });
  const animatedProfit     = useCountUp(Math.round(monthSummary.profit),             { enabled: countUpEnabled });
  const trueProfit         = monthSummary.profit - overheadTotal;
  const animatedTrueProfit = useCountUp(Math.round(trueProfit),                      { enabled: countUpEnabled });

  return (
    <div className="screen finance-screen">
      <div className="screen-header">
        <h1 className="screen-title">Money</h1>
        <span className="screen-header-lockup">
          <OhnarWordmark size="30px" />
        </span>
        {onAvatarClick && (
          <div className="screen-header-right">
            <HeaderAvatar session={session} profile={profile} onClick={onAvatarClick} />
          </div>
        )}
      </div>

      {/* ── Skeleton — shown while profile is null (brief post-Splash window).
          Replaces the strip + hero so numbers never flash as £0 while loading.
          Profile always resolves within 200–600ms; no minimum delay is added. */}
      {profile === null && <MoneyScreenSkeleton />}

      {/* ── 0a. "Money in 5 seconds" — 3-number scannable strip ─────────── */}
      {/* Always shown once there is any activity. Three numbers: what you kept
          (YTD profit after tax pot), what you've set aside for tax (YTD tax pot),
          and what you're still owed (all outstanding unpaid jobs). */}
      {profile !== null && hasActivity && (
        <div className="money-five-sec" role="region" aria-label="Your money at a glance">
          <div className="money-five-sec__cell">
            <span className="money-five-sec__value">{gbp(Math.round(animatedKept))}</span>
            <span className="money-five-sec__label">Kept</span>
          </div>
          <div className="money-five-sec__divider" aria-hidden="true" />
          <div className="money-five-sec__cell">
            <span className="money-five-sec__value money-five-sec__value--tax">{gbp(Math.round(animatedTaxPot))}</span>
            <span className="money-five-sec__label">For tax</span>
          </div>
          <div className="money-five-sec__divider" aria-hidden="true" />
          <div className="money-five-sec__cell">
            <span className={`money-five-sec__value${outstandingSummary.totalOwed > 0 ? ' money-five-sec__value--owed' : ''}`}>
              {gbp(Math.round(animatedOwed))}
            </span>
            <span className="money-five-sec__label">Still owed</span>
          </div>
        </div>
      )}

      {/* ── 0b. Today — Earned / Spent / Profit (relocated from Today tab) ─ */}
      {/* Shown whenever there is at least one job or receipt today. */}
      {profile !== null && todayEarnedSpentProfit.hasToday && (
        <div className="foreman-esp-card">
          <div className="foreman-esp-row">
            <span className="foreman-esp-label">Earned today</span>
            <span className="foreman-esp-value">{gbp(todayEarnedSpentProfit.earned)}</span>
          </div>
          <div className="foreman-esp-row">
            <span className="foreman-esp-label">Spent today</span>
            <span className="foreman-esp-value">{gbp(todayEarnedSpentProfit.spent)}</span>
          </div>
          <hr className="foreman-esp-divider" />
          <div className="foreman-esp-row">
            <span className="foreman-esp-profit-label">Profit today</span>
            <span className={`foreman-esp-profit-value${todayEarnedSpentProfit.profit < 0 ? ' foreman-esp-profit-value--negative' : ''}`}>
              {gbp(todayEarnedSpentProfit.profit)}
            </span>
          </div>
        </div>
      )}

      {/* ── 1. Hero — Profit this month ──────────────────────────────────── */}
      {profile !== null && (isEmptyMonth ? (
        <div className="money-hero money-hero--clear">
          <div className="money-hero__label">Profit this month</div>
          <span className="money-hero__caught-up">Nothing paid in yet this month</span>
          <p className="money-hero__hint">
            Mark a job as paid and it shows up here.
          </p>
          {onGoToJobs && (
            <button
              type="button"
              className="money-hero__goto-jobs-btn"
              onClick={onGoToJobs}
            >
              Go to Jobs
            </button>
          )}
        </div>
      ) : (
        <div className={`money-hero money-hero--profit${isProfitNegative ? ' money-hero--negative' : ''}`}>
          <div className="money-hero__label">Profit this month</div>
          <div className={`money-hero__figure${isProfitNegative ? ' money-twoUp__value--negative' : ''}`}>
            {gbp(Math.round(animatedProfit))}
          </div>
          <div className="money-hero__qualifier-label">
            Before monthly bills and tax
          </div>
          <div className="money-hero__meta">
            {isProfitNegative
              ? 'You spent more than came in this month'
              : 'Money in, minus what you spent'}
          </div>
          <div className={`money-hero__ytd-line${isYtdProfitNegative ? ' money-hero__ytd-line--negative' : ''}`}>
            {gbp(ytd.profit)} profit so far this tax year
          </div>

          {/* ── True Profit second tier ────────────────────────────── */}
          {/* Three states:
               1. Pro + overheads set   → show real number
               2. Free + overheads set  → blurred locked line (upgrade pitch)
               3. Anyone + no overheads → plain nudge to add costs in Settings */}
          {overheads.length === 0 ? (
            /* State 3: overheads not configured — structured nudge prompt */
            <div className="money-hero__true-profit-prompt">
              <p className="money-hero__true-profit-prompt-heading">
                This profit&rsquo;s missing your bills
              </p>
              <p className="money-hero__true-profit-prompt-body">
                It&rsquo;s only counting job costs. Add your monthly bills &mdash; van, insurance, phone &mdash; and we&rsquo;ll show what you actually keep.
              </p>
              {onGoToSettings && (
                <button
                  type="button"
                  className="money-hero__true-profit-prompt-cta"
                  onClick={() => onGoToSettings('overheads')}
                >
                  Add monthly bills &rarr;
                </button>
              )}
            </div>
          ) : userIsPro ? (
            /* State 1: Pro user — show real True Profit figure */
            (() => {
              const isTrueProfitNegative = trueProfit < 0;
              return (
                <>
                  <hr className="money-hero__true-profit-divider" />
                  <div className="money-hero__true-profit-label">After your monthly bills</div>
                  <div className={`money-hero__true-profit-figure${isTrueProfitNegative ? ' money-hero__true-profit-figure--negative' : ''}`}>
                    {gbp(Math.round(animatedTrueProfit))}
                  </div>
                  <div className="money-hero__qualifier-label">
                    After monthly bills
                  </div>
                  <div className="money-hero__true-profit-sub">
                    {gbp(overheadTotal)}/mo monthly bills deducted
                  </div>
                </>
              );
            })()
          ) : (
            /* State 2: Free user + overheads configured — blurred locked line.
               (NET) label is a sibling of the blurred amount so it stays readable.
               Tapping the row opens ProUpgradeSheet with trigger='insight_locked'. */
            <button
              type="button"
              className="money-hero__true-profit-locked"
              onClick={() => handleUpgrade(UPGRADE_TRIGGERS.INSIGHT_LOCKED)}
              aria-label="Unlock true profit — tap to upgrade to Pro"
            >
              <div className="money-hero__true-profit-locked-label">After your monthly bills</div>
              <div className="money-hero__true-profit-locked-row">
                {/* amount is blurred; Pro badge sits outside and stays visible */}
                <span className="money-hero__true-profit-locked-amount">{gbp(monthSummary.profit - overheadTotal)}</span>
                <span className="money-hero__true-profit-locked-badge">
                  <Icon name="lock" size={16} />
                  <span>Pro</span>
                </span>
              </div>
              <div className="money-hero__qualifier-label money-hero__qualifier-label--locked">
                After monthly bills
              </div>
            </button>
          )}
        </div>
      ) )}

      {/* ── 1b. Data trust nudge — shown when data is incomplete, below hero ── */}
      {dataTrustHint && !trustHintDismissed && (
        <div className="money-trust-hint" role="note">
          <Icon name="info" size={16} className="money-trust-hint__icon" />
          <div className="money-trust-hint__body">
            <span className="money-trust-hint__msg">{dataTrustHint.message}</span>
            {(dataTrustHint.type === 'markPaid' ? !!onGoToJobs : !!onGoToSettings) && (
              <button
                type="button"
                className="money-trust-hint__cta"
                onClick={handleTrustHintCta}
              >
                {dataTrustHint.cta}
              </button>
            )}
          </div>
          <button
            type="button"
            className="money-trust-hint__dismiss"
            aria-label="Dismiss"
            onClick={() => setTrustHintDismissed(true)}
          >
            &times;
          </button>
        </div>
      )}

      {/* ── 2. Upgrade surfaces — shown for non-Pro users only ────────────── */}
      {/* Priority order: Founding Member card (if eligible) > standard banner. */}
      {/* The standard banner is suppressed when the Founding Member card is shown */}
      {/* so we never stack two upgrade surfaces. */}
      {!userIsPro && userIsFoundingEligible && (
        <FoundingMemberCard
          onCta={handleFoundingMemberCta}
          confirmed={foundingCtaDone || isTrialActive(profile)}
          daysLeft={trialDaysLeft(profile)}
        />
      )}
      {!userIsPro && !userIsFoundingEligible && (
        <UpgradeBanner onUpgrade={() => handleUpgrade(UPGRADE_TRIGGERS.UPGRADE_BANNER)} />
      )}

      {/* ── 2a. Founding Member lock confirmation (Pro users with flag set) ── */}
      {/* Shown when a user has the flag AND is on Pro — confirms their lock is active. */}
      {userIsPro && userIsFoundingMember && (
        <div className="founding-member-card founding-member-card--confirmed" role="note" aria-label="Founding Member price lock active">
          <div className="founding-member-card__badge">Founding Member</div>
          <p className="founding-member-card__confirmed-copy">
            Your £12 price is locked while you&rsquo;re subscribed.
          </p>
        </div>
      )}

      {/* ── 2b. Accountant tools — FREE, ungated, surfaced high so it's visible
              on first scroll without passing all the Pro-gated insight cards.
              Privacy policy promises "your data is yours, export anytime";
              gating the only export path would contradict that live GDPR promise.
              Also available in Settings → Accountant → Export records (unchanged).

              PRO SEAM: a future "Profit & tax summary" export (CSV with overhead
              allocation column and tax_set_aside_pct column) belongs immediately
              below this button, wrapped in <ProGate>. That export will require
              profiles.overheads (JSONB, migration 20260528_add_overheads_to_profiles)
              and profiles.tax_set_aside_pct (int, migration 20260528_add_tax_set_aside_pct)
              to be live — both migrations are already applied. */}
      {onExport && (
        <div className="money-card money-accountant-tools">
          <div className="money-accountant-tools__header">
            <Icon name="file" size={16} variant="muted" className="money-accountant-tools__icon" />
            <span className="money-accountant-tools__title">Accountant tools</span>
          </div>
          <button
            type="button"
            className="money-accountant-tools__btn"
            onClick={handleMoneyExport}
            disabled={exporting}
            aria-busy={exporting}
          >
            <Icon name="download" size={16} className="money-accountant-tools__btn-icon" />
            {exporting ? 'Preparing…' : 'Export for your accountant (CSV)'}
          </button>
          <p className="money-accountant-tools__hint">
            Jobs ledger with costs and profit — opens in Excel or Google Sheets.
          </p>
        </div>
      )}

      {/* ── 4. True Profit — relocated into the hero card above.
              All three states (Pro/free/no-overheads) handled inside the hero. */}

      {/* ── Pay-now Money banner — shown when 2+ unpaid invoices ──────────── */}
      {(() => {
        const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;
        if (isConnected || payNowBannerDismissed || !onNavigateToCardPayments) return null;
        const unpaidCount = jobs.filter(j => {
          const s = j.status || '';
          return s === 'invoice_sent' || s === 'awaiting';
        }).length;
        if (unpaidCount < 2) return null;
        return (
          <div className="pay-now-money-banner" role="note">
            <span className="pay-now-money-banner__copy">
              {unpaidCount} {unpaidCount === 1 ? 'invoice' : 'invoices'} waiting. Add a Pay-now button to chase faster.
            </span>
            <button
              type="button"
              className="pay-now-money-banner__setup"
              onClick={onNavigateToCardPayments}
            >
              Set up
            </button>
            <button
              type="button"
              className="pay-now-money-banner__dismiss"
              aria-label="Dismiss"
              onClick={handlePayNowBannerDismiss}
            >
              &times;
            </button>
          </div>
        );
      })()}

      {/* ── Month pace two-up — Paid in + Jobs done (this month) ──────────── */}
      {profile !== null && (
        <div className="money-twoUp">
          <div className="money-twoUp__card">
            <div className="money-twoUp__label">Paid in</div>
            <div className="money-twoUp__value">{gbp(monthSummary.paid)}</div>
          </div>
          <div className="money-twoUp__card">
            <div className="money-twoUp__label">Jobs done</div>
            <div className="money-twoUp__value">{monthSummary.jobCount}</div>
          </div>
        </div>
      )}

      {/* ── "More insights" expander — collapsible analytics layer ────────── */}
      {/* Keeps the screen scannable at a glance. All accountant-grade and
          week-on-week detail cards live behind this single tap. */}
      {hasActivity && (
        <button
          type="button"
          className={`money-more-insights-toggle${moreInsightsOpen ? ' money-more-insights-toggle--open' : ''}`}
          aria-expanded={moreInsightsOpen}
          onClick={() => setMoreInsightsOpen(o => !o)}
        >
          <span className="money-more-insights-toggle__body">
            <span className="money-more-insights-toggle__label">
              {moreInsightsOpen ? 'Hide insights' : 'More insights'}
            </span>
            {!moreInsightsOpen && (
              <span className="money-more-insights-toggle__teaser">
                True profit &middot; Tax pot &middot; Profit/hour
              </span>
            )}
          </span>
          <Icon
            name="chevron-down"
            size={16}
            variant="muted"
            className={`money-more-insights-toggle__chevron${moreInsightsOpen ? ' money-more-insights-toggle__chevron--open' : ''}`}
          />
        </button>
      )}

      {moreInsightsOpen && (
        <>

      {/* ── Cashflow chart ────────────────────────────────────────────── */}
      <div className="money-card money-card--chart">
        <CashflowChart
          data={cashflowData}
          defaultRange="6m"
          defaultMode="profitVsCost"
          onRangeChange={(newRange) => setChartRange(newRange)}
        />
        <p className="money-chart-caption">
          <span className="money-chart-caption__swatch" style={{ background: 'var(--cf-navy, #1e3a5f)' }} aria-hidden="true" />
          What you kept
          <span className="money-chart-caption__swatch" style={{ background: 'var(--cf-amber, #f59e0b)' }} aria-hidden="true" />
          What it cost you
        </p>
      </div>

      {/* ── 3b. VAT this quarter (Pro-gated, VAT-registered users only) ───── */}
      {/* Kept outside the insight gate: VAT is tied to registration, not the
          Insight Layer. Free VAT-registered users still see the ProGate blur
          so the card teases the feature independently of the other insights. */}
      {isVatRegistered && (
        <ProGate locked={!userIsPro} hasValue={vatSummary.grossSales > 0 || vatSummary.inputVat > 0} onUpgrade={() => handleUpgrade(UPGRADE_TRIGGERS.INSIGHT_LOCKED)}>
          <div className="money-card money-vat">
            <div className="money-vat__header">
              <span className="money-vat__label">VAT this quarter</span>
              <span className="money-vat__quarter">{vatQuarter.label}</span>
            </div>
            {vatSummary.grossSales === 0 && vatSummary.inputVat === 0 ? (
              <p className="money-vat__empty">No VAT to report yet this quarter</p>
            ) : (
              <>
                <div className={`money-vat__figure pro-gate__figure${vatSummary.netVat < 0 ? ' money-vat__figure--reclaim' : ''}`}>
                  {vatSummary.netVat < 0
                    ? `VAT reclaim ${gbp(Math.abs(vatSummary.netVat))}`
                    : `Set aside ${gbp(vatSummary.netVat)} for VAT`}
                </div>
                <p className="money-vat__breakdown">
                  Sales (inc. VAT) {gbp(vatSummary.grossSales)} &middot; Net sales (ex. VAT) {gbp(vatSummary.netSales)} &middot; VAT on sales {gbp(vatSummary.outputVat)} &middot; Reclaimable {gbp(vatSummary.inputVat)}
                </p>
                <p className="money-vat__inclusive-note">
                  We treat the prices you enter as VAT-inclusive &mdash; VAT shown is the portion within that.
                </p>
              </>
            )}
            <p className="money-vat__disclaimer">
              Estimate &mdash; assumes standard 20% VAT, cash basis, calendar quarters. Confirm with your accountant before filing.
            </p>
          </div>
        </ProGate>
      )}

      {/* ── 3–9. Insight Layer — consolidated gate for free users ────────────── */}
      {/* Free users see ONE unlock card instead of four separate blurred cards.
          Pro users see all four real insight cards with no gate chrome.
          VAT card is outside this block (conditioned on isVatRegistered above). */}
      {userIsPro ? (
        <>
          {/* ── Pro: Tax Pot card ───────────────────────────────────────────── */}
          <div className="money-card money-tax-setaside">
            <div className="money-tax-setaside__label-row">
              <div className="money-tax-setaside__label">Tax Pot</div>
              {onProfileUpdate && (
                <button
                  type="button"
                  className="money-tax-setaside__edit-btn"
                  onClick={() => setTaxPotSheetOpen(true)}
                  aria-label="Edit tax pot percentage"
                >
                  {taxSetAsidePct}% &rsaquo;
                </button>
              )}
            </div>

            {isCisSubcontractor ? (
              /* ── CIS-aware two-block view ───────────────────────────────────────── */
              (() => {
                const cisAmt = ytd.cisDeductedYtd ?? 0;
                const setAsideAmt = ytdTaxPot;
                const nonCisBase = ytd.nonCisProfit ?? 0;
                const allCis = nonCisBase <= 0 && ytd.profit > 0;

                if (ytd.paid === 0 && cisAmt === 0) {
                  return (
                    <>
                      <p className="money-insight__example-label">Example — your numbers appear here on Pro</p>
                      <div className="money-tax-setaside__figure">£437</div>
                      <p className="money-tax-setaside__sub">Tax pot estimate</p>
                    </>
                  );
                }

                return (
                  <>
                    <div className="money-tax-cis-block">
                      <div className="money-tax-cis-block__label">Already deducted (CIS)</div>
                      <div className="money-tax-cis-block__figure">{gbp(cisAmt)}</div>
                      <p className="money-tax-cis-block__sub">
                        Taken by contractors this tax year. This usually comes back as a refund.
                      </p>
                    </div>
                    {allCis ? (
                      <p className="money-tax-setaside__empty money-tax-setaside__empty--cis-all">
                        Nothing extra to set aside &mdash; all your work this year was CIS.
                      </p>
                    ) : nonCisBase > 0 ? (
                      <div className="money-tax-cis-block money-tax-cis-block--setaside">
                        <div className="money-tax-cis-block__label">Set aside on the rest</div>
                        <div className="money-tax-cis-block__figure">{gbp(setAsideAmt)}</div>
                        <p className="money-tax-cis-block__sub">
                          {taxSetAsidePct}% of your non-CIS profit ({gbp(nonCisBase)}).
                          The CIS work is already covered.
                        </p>
                      </div>
                    ) : null}
                    <p className="money-tax-setaside__disclaimer">
                      Estimate only &mdash; not tax advice. Figures are based on the details
                      you enter. CIS deductions are advance payments toward your tax, reconciled
                      on your Self Assessment &mdash; you may owe more or be due a refund.
                      Check with your accountant or HMRC.
                    </p>
                  </>
                );
              })()
            ) : (
              /* ── Standard (non-CIS) view ──────────────────────────────────────────── */
              ytd.profit <= 0 ? (
                <>
                  <p className="money-insight__example-label">Example — your numbers appear here on Pro</p>
                  <div className="money-tax-setaside__figure">£437</div>
                  <p className="money-tax-setaside__sub">Tax pot estimate</p>
                </>
              ) : (
                <>
                  <div className="money-tax-setaside__figure">{gbp(animatedTaxPot)}</div>
                  <p className="money-tax-setaside__sub">
                    Put by for the taxman &middot; {taxSetAsidePct}% of profit &middot; {gbp(monthTaxPot)} this month
                  </p>
                  <p className="money-tax-setaside__keep">
                    Leaves you {gbp(Math.max(0, ytd.profit) - ytdTaxPot)} to keep
                  </p>
                </>
              )
            )}
          </div>

          {/* ── Pro: Est. Profit/Hour card ────────────────────────────────────────────── */}
          {profitPerHour.value !== null ? (
            <div className="money-card money-insight money-insight--pph">
              <div className="money-insight__row">
                <span className="money-insight__label">Est. Profit/Hour</span>
                <span className="money-insight__tooltip" title="Based on your default hourly rate. Add hours to a job to make this exact.">
                  <Icon name="info" size={16} />
                </span>
              </div>
              <div className="money-insight__value">
                {gbp(Math.round(profitPerHour.value))}
                {profitPerHour.comparisonValue !== null && (
                  <span className={`money-insight__delta money-insight__delta--${profitPerHour.deltaSign}`}>
                    {profitPerHour.deltaSign === 'up' && <Icon name="trend-up" size={13} />}
                    {profitPerHour.deltaSign === 'down' && <Icon name="trend-down" size={13} />}
                    {' '}{gbp(Math.round(Math.abs(profitPerHour.value - profitPerHour.comparisonValue)))} vs last wk
                  </span>
                )}
              </div>
              {hourlyRate > 0 && (
                <p className="money-insight__rate-compare">
                  You charge {gbp(hourlyRate)}/hr &middot; {gbp(Math.max(0, hourlyRate - Math.round(profitPerHour.value)))} goes to costs
                </p>
              )}
            </div>
          ) : (
            <div className="money-card money-insight money-insight--pph">
              <div className="money-insight__row">
                <span className="money-insight__label">Est. Profit/Hour</span>
                <span className="money-insight__tooltip" title="Based on your default hourly rate. Add hours to a job to make this exact.">
                  <Icon name="info" size={16} />
                </span>
              </div>
              <p className="money-insight__empty">
                Add your hourly rate in Settings to see this.
              </p>
            </div>
          )}

          {/* ── Pro: Best & worst jobs card ─────────────────────────────────────────────── */}
          {bestWorstJobs.best ? (
            <BestWorstCard best={bestWorstJobs.best} worst={bestWorstJobs.worst} />
          ) : (
            <div className="money-card money-best-worst">
              <div className="money-best-worst__label">Best &amp; worst jobs</div>
              <p className="money-insight__empty">Complete a job to see rankings.</p>
            </div>
          )}

          {/* ── Pro: Margin nudge (conditional — threshold-gated) ─────────────────────────── */}
          {showMarginNudge && (
            <div className={`money-card money-nudge money-nudge--${marginTrend.deltaSign}`}>
              {marginTrend.deltaSign === 'up'
                ? <Icon name="trend-up" size={20} variant="success" className="money-nudge__icon" />
                : <Icon name="trend-down" size={20} variant="danger" className="money-nudge__icon" />
              }
              <span className="money-nudge__copy">{marginNudgeCopy}</span>
              {marginTrend.deltaSign !== 'up' && (
                <span className="money-nudge__caret"> →</span>
              )}
            </div>
          )}
        </>
      ) : (
        /* ── Free user: single consolidated unlock card ────────────────────────────── */
        <div className="money-insight-locked-gate">
          <p className="money-insight-locked-gate__headline">Unlock the Insight Layer</p>
          <ul className="money-insight-locked-gate__bullets">
            <li>Tax Pot — how much to keep back for HMRC</li>
            <li>Profit/Hour — are you actually worth your rate?</li>
            <li>Best &amp; Worst jobs — know what to chase more of</li>
          </ul>
          <button
            type="button"
            className="money-insight-locked-gate__cta"
            onClick={() => handleUpgrade(UPGRADE_TRIGGERS.INSIGHT_LOCKED)}
          >
            Start 14-day free trial
          </button>
        </div>
      )}

        </> /* end moreInsightsOpen fragment */
      )} {/* end moreInsightsOpen */}

      {/* ── 10. Recent transactions (demoted — collapsed by default) ─────── */}
      {totalTimelineEntries > 0 && (
        <div className="money-card money-timeline">
          <button
            type="button"
            className="money-timeline__header"
            aria-expanded={timelineOpen}
            onClick={() => setTimelineOpen(o => !o)}
          >
            <span className="money-timeline__title">
              Recent transactions &middot; {totalTimelineEntries} {totalTimelineEntries === 1 ? 'entry' : 'entries'}
            </span>
            <Icon
              name="chevron-down"
              size={16}
              variant="muted"
              className={`money-timeline__chevron${timelineOpen ? ' money-timeline__chevron--open' : ''}`}
            />
          </button>

          {timelineOpen && (
            <div className="money-timeline__body">
              {timelineGroups.map(g => (
                <div key={g.key} className="money-timeline__group">
                  <h3 className="money-timeline__day">{g.label}</h3>
                  <ul className="money-timeline__list">
                    {g.entries.map(e => (
                      <li key={e.id} className="money-timeline__item">
                        <span className="money-timeline__item-label">{e.label}</span>
                        <span className={`money-timeline__item-amount${e.amount >= 0 ? ' pos' : ' neg'}`}>
                          {e.amount >= 0 ? '+' : ''}{gbp(Math.abs(e.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Full empty state ─────────────────────────────────────────────── */}
      {!hasActivity && (
        <div className="screen-empty">
          <Icon name="money" size={32} variant="muted" label="No money activity yet" />
          <p className="screen-empty-title">Nothing here yet.</p>
          <p className="screen-empty-hint">
            Your profit shows up once you log a job and mark it paid.
          </p>
          {onGoToJobs && (
            <button type="button" className="screen-empty-cta" onClick={onGoToJobs}>
              Log a job
            </button>
          )}
        </div>
      )}

      {/* ── ProUpgradeSheet — opened by every upgrade CTA on this screen ── */}
      <ProUpgradeSheet
        open={upgradeSheetOpen}
        source={upgradeSheetSource}
        profile={profile}
        onClose={() => setUpgradeSheetOpen(false)}
      />

      {/* ── TaxPotSheet — tapping the Tax Pot % on the Money tab (Pro only) ── */}
      <TaxPotSheet
        open={taxPotSheetOpen}
        onClose={() => setTaxPotSheetOpen(false)}
        currentPct={taxSetAsidePct}
        monthProfit={monthSummary.profit - overheadTotal}
        onSave={handleTaxPotSave}
      />

    </div>
  );
}

// ── Date helpers for timeline grouping (local-only, not exported) ────────────
function keyOfDay(date) {
  return date.toISOString().slice(0, 10);
}

function labelOfDay(date, now) {
  const key = keyOfDay(date);
  const todayKey = keyOfDay(now);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (key === todayKey) return 'Today';
  if (key === keyOfDay(yest)) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}
