import { useState, useEffect, useCallback, useRef } from 'react';
import { useSnackbar, markSession1Done, isSession1Done } from './lib/snackbar.js';
import Snackbar from './components/Snackbar.jsx';
import { useKeyboardInset } from './lib/useKeyboardInset.js';
import {
  shouldShowCostPrompt,
  costPromptVariant,
  recordPromptShown,
  recordDismissal,
} from './lib/postPaidCost';
import PostPaidCostRow from './components/PostPaidCostRow';
import CardPaymentsScreen from './screens/CardPaymentsScreen.jsx';
import {
  isPushSupported,
  getSubscriptionStatus,
  subscribe as pushSubscribe,
} from './lib/pushSubscribe.js';
import TodayScreen from './screens/TodayScreen';
import FinanceScreen from './screens/FinanceScreen';
import WorkScreen from './screens/WorkScreen';
import SettingsScreen from './screens/SettingsScreen';
import OnboardingWizard from './screens/OnboardingWizard';
import BottomNav from './components/BottomNav';
import LinkReceiptModal from './components/LinkReceiptModal';
import { supabase } from './lib/supabase';
import { hydrateChaseState, isDoubleSendBlocked } from './lib/chaseLadder';
import { buildChaseList } from './lib/chaseList.js';
import AuthScreen from './components/AuthScreen';
import { parseHash, replaceHistory } from './lib/navigation';
import { writeJobMeta, extractJobMeta, applyJobMetaToJobs, clearPending } from './lib/jobMeta';
import { logComms } from './lib/commsLog';
import { subscribeToJobs } from './lib/realtime';
import { addPayment } from './lib/payments';
import {
  getTodayJobs,
  getTodayReceipts,
  addTodayJob,
  addTodayReceipt,
  getJobsFromCloud,
  getReceiptsFromCloud,
  addJobToCloud,
  addReceiptToCloud,
  linkReceiptToJob,
  deleteReceiptFromCloud,
  updateReceiptInCloud,
  updateJobMetaInCloud,
} from './lib/store';
import {
  flipExpiredTrialToFree,
  trialJustExpired,
  hasDropToFreeSeen,
  markDropToFreeSeen,
  isTrialLastDay,
  trialEndSheetDismissedToday,
  recordTrialEndSheetDismissed,
  isPro,
  initTrialOnFirstUse,
} from './lib/plan';
import { formatChargeDate, shouldShowPreChargeReminder } from './lib/trialConversion';
import { shouldShowProReveal, markProRevealSeen } from './lib/proReveal';
import { getJobProfit } from './lib/cashflow';
import { enqueueJob, wireOnlineSync, runSync } from './lib/offlineQueue';
import { logTelemetry, identifyUser, getLastUpgradeTrigger, UPGRADE_TRIGGERS } from './lib/telemetry';
import { flushTosAcceptance } from './lib/legal';
import posthog from 'posthog-js';
import SyncBadge from './components/SyncBadge';
import ConsentBanner from './components/ConsentBanner.jsx';
import Icon from './components/Icon.jsx';
import ProUpgradeSheet from './components/ProUpgradeSheet.jsx';
import DropToFreeScreen from './components/DropToFreeScreen.jsx';
import PreChargeReminderBanner from './components/PreChargeReminderBanner.jsx';
import { startCheckoutImmediate, openBillingPortal } from './lib/billing';
import {
  getMaterials,
  addMaterial,
  updateMaterial,
  archiveMaterial,
} from './lib/materials';
import MaterialsScreen from './screens/MaterialsScreen';
import AddMaterialModal from './components/AddMaterialModal';
import { buildJobsCsv, downloadOrShareCsv, downloadOrShare } from './lib/exportCsv';
import { buildJobsPdf } from './lib/exportPdf.js';
import { buildJobsXlsx } from './lib/exportXlsx.js';
import { buildAccountantExportFiles, buildAccountantExportZipBlob } from './lib/accountantExport.js';
import ExportFormatSheet from './components/ExportFormatSheet.jsx';
import AccountantExportRangeSheet from './components/AccountantExportRangeSheet.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import Splash from './components/Splash.jsx';
import DashboardPager from './components/DashboardPager.jsx';
import PaidCelebration from './components/PaidCelebration.jsx';
import PostPaidSheet from './components/PostPaidSheet.jsx';
import AddJobModal from './components/AddJobModal.jsx';
import { haptic } from './lib/haptics.js';
import { unlockAudioContext, playPaymentReceivedSound } from './lib/paymentSound.js';
import { playAcceptedEarcon } from './lib/momentEarcons.js';
import { seedSampleData, clearSampleData } from './lib/sampleData.js';
import { REFERRAL_CODE_STORAGE_KEY } from './lib/referral.js';

// ─── App-boot cleanup ─────────────────────────────────────────────────────────
// Remove localStorage keys that were used by the now-deleted newNav and
// navSlice3 feature flags so they don't linger in existing users' browsers.
// Both keys were checked at module evaluation time — running this cleanup once
// per boot is sufficient to clear them for any user who previously had them set.
['jp.newNav', 'jp.navSlice3'].forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });

const SLICE_3_VIEWS  = ['today', 'work', 'finance', 'settings'];

// The 3 views reachable via horizontal swipe. Order matches the pager page order.
const DASHBOARD_VIEWS = ['today', 'work', 'finance'];

/** Map a view name to the pager's 0-based page index. Returns -1 for non-dashboard views. */
function dashboardPageIndex(view) {
  return DASHBOARD_VIEWS.indexOf(view);
}

// SW auto-update loop guard — module-level so it survives React re-renders but
// resets on a full page load (exactly the right lifetime). Set to true BEFORE
// calling window.location.reload() in the controllerchange handler so a second
// controllerchange event (e.g. from a race between near-simultaneous deploys)
// cannot trigger a second reload.
let swReloaded = false;

// sessionStorage key set immediately before the SW-triggered reload above fires.
// Read (and cleared) by splashMinElapsed's initialiser on the very next boot so
// that reload lands on a near-instant gate instead of the full ~1.2s branded
// dwell — the user already sat through that animation once this session; a
// same-session reload they didn't ask for shouldn't make them sit through it twice.
const SW_RELOAD_SPLASH_SKIP_KEY = 'ohnar.swReload.skipSplashDwell';

function wipeLegacyDemoData() {
  try {
    if (localStorage.getItem('jp.demoCleared.v1')) return;
    const raw = localStorage.getItem('jobprofit-app-data');
    if (!raw) {
      localStorage.setItem('jp.demoCleared.v1', '1');
      return;
    }
    const data = JSON.parse(raw);
    const demoJobIds = new Set(['J-0001', 'J-0002', 'J-0003', 'J-0004']);
    const demoExpIds = new Set(['E-0001', 'E-0002', 'E-0003', 'E-0004', 'E-0005']);
    if (Array.isArray(data.jobs)) data.jobs = data.jobs.filter(j => !demoJobIds.has(j.id));
    if (Array.isArray(data.expenses)) data.expenses = data.expenses.filter(e => !demoExpIds.has(e.id));
    localStorage.setItem('jobprofit-app-data', JSON.stringify(data));
    localStorage.setItem('jp.demoCleared.v1', '1');
  } catch (e) {
    console.warn('Demo wipe failed', e);
  }
}

function migrateLegacyTodayData() {
  try {
    const legacyJobsRaw = localStorage.getItem('jp.jobs');
    const legacyReceiptsRaw = localStorage.getItem('jp.receipts');
    const migratedFlag = localStorage.getItem('jp.migrated.v1');
    if (migratedFlag) return;
    if (legacyJobsRaw) {
      const legacy = JSON.parse(legacyJobsRaw) || [];
      for (const j of legacy) addTodayJob(j);
    }
    if (legacyReceiptsRaw) {
      const legacy = JSON.parse(legacyReceiptsRaw) || [];
      for (const r of legacy) addTodayReceipt(r);
    }
    localStorage.setItem('jp.migrated.v1', '1');
  } catch (e) {
    console.warn('Migration failed', e);
  }
}

function parseViewFromHash() {
  // parseHash() resolves legacy aliases (jobs → work, money → finance, etc.)
  // and falls back to 'today' for any unrecognised segment.
  const { view } = parseHash();
  return SLICE_3_VIEWS.includes(view) ? view : 'today';
}

export default function AppShell() {
  // Write --kb-inset CSS variable whenever the on-screen keyboard opens/closes.
  // All bottom-sheet modals read this variable via padding-bottom on .modal-backdrop
  // so they float above the keypad without any per-modal code.
  useKeyboardInset();

  const [view, setView] = useState(() => parseViewFromHash());
  const [jobs, setJobs] = useState(() => getTodayJobs());
  const [receipts, setReceipts] = useState(() => getTodayReceipts());
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [pendingLink, setPendingLink] = useState(null); // receipt awaiting job link
  const [_drawerOpen, setDrawerOpen] = useState(false);
  // ── Snackbar manager (JP-LU2) ────────────────────────────────────────────────
  // Single priority-queue surface replacing the old navToast / realtimeToast /
  // costSnackbar state + their individual setTimeout calls.
  const { active: snackbarActive, enqueue: snackbarEnqueue, dismiss: snackbarDismiss } = useSnackbar();
  // costSnackbar: used only for the expanded modal path (+ Add cost tapped).
  // The collapsed snackbar itself is rendered via Snackbar.jsx.
  const [costSnackbarJob, setCostSnackbarJob] = useState(null);
  // paidCelebration: amount to show in the shared PaidCelebration overlay.
  // null = hidden; a number = overlay is active with that paid amount.
  const [paidCelebrationAmount, setPaidCelebrationAmount] = useState(null);
  // postPaidJob: the job that was just marked paid; drives PostPaidSheet.
  // null = sheet hidden; a job object = sheet is pending (shows after PaidCelebration dismisses).
  const [postPaidJob, setPostPaidJob] = useState(null);
  // addJobPrefill: pre-filled fields for the re-book AddJobModal opened from PostPaidSheet.
  // null = modal closed; { customer, phone, address } = modal open with those defaults.
  const [addJobPrefill, setAddJobPrefill] = useState(null);
  // workOverlayOpen: true while WorkScreen's JobDetailDrawer or RecordPaymentModal is on-screen.
  // Used by PostPaidSheet's active condition (Option A) so the sheet doesn't stack on the drawer.
  const [workOverlayOpen, setWorkOverlayOpen] = useState(false);
  // Debounce timer for the realtime onChange → refreshFromCloud path.
  // A burst of postgres_changes events (e.g. bulk offline sync flushes) would
  // otherwise fire one full refetch per event.  2-second trailing debounce
  // collapses the burst into a single fetch while keeping correctness: the
  // latest cloud state is always fetched once the burst settles.
  // NOT applied to initial load, onReconnect, or explicit user-triggered refreshes.
  const realtimeDebounceRef = useRef(null);
  // Ref holding the most recent jobs array so the Realtime handler can compare
  // previous acceptedSignature state without a stale closure.
  const jobsRef = useRef([]);
  // Timestamp of the last refreshFromCloud call — used by the visibility backstop
  // (Fix B) to throttle double-fetches when a realtime onReconnect fires at the
  // same moment the page becomes visible. Set inside refreshFromCloud.
  const lastRefetchAtRef = useRef(0);
  // Wizard state (new nav only).
  // wizardOpen — should the wizard overlay be showing right now?
  const [wizardOpen, setWizardOpen] = useState(false);
  // Push permission prompt: show once per device, dismiss stored in localStorage
  const [pushPromptVisible, setPushPromptVisible] = useState(false);
  // pendingJobOpen: when Today (or Settings/a deep-link/the realtime Snackbar)
  // navigates to Work with a specific job to open, store { jobId, nonce } here
  // so WorkScreen can pre-open the drawer. `nonce` is a fresh value on every
  // dispatch (same pattern as workStageOverride below) because the dashboard
  // pager keeps WorkScreen mounted across navigations — a plain jobId string
  // wouldn't re-fire WorkScreen's open-drawer effect on a second tap targeting
  // the same job. WorkScreen clears this back to null once it has consumed it
  // (via onPendingJobOpenConsumed) so a later cloud refresh of `jobs` can't
  // re-trigger the open-drawer effect and reopen a drawer the trader closed.
  const [pendingJobOpen, setPendingJobOpen] = useState(null);
  const openJob = useCallback((jobId) => {
    if (!jobId) return;
    setPendingJobOpen({ jobId, nonce: Date.now() });
  }, []);
  // workStageOverride: when a Today card/banner navigates to Jobs for a SPECIFIC
  // stage (e.g. the "waiting to collect" pulse card → Invoiced), this carries that
  // stage across the navigation. WorkScreen applies it over its persisted
  // 'jp.workscreen.filter.v1' filter for that one navigation, then normal
  // persistence resumes. `nonce` forces the override to re-apply even when
  // WorkScreen is already mounted (the dashboard pager keeps Today/Jobs/Money
  // mounted simultaneously — see DashboardPager.jsx — so a plain stage string
  // wouldn't re-fire WorkScreen's effect on a second tap with the same stage).
  const [workStageOverride, setWorkStageOverride] = useState(null);
  // JP-LU5 PR1: pendingWorkView state removed — WorkScreen calendar subview deleted.
  // workResetKey: bumped on every explicit tab-click to the work/jobs tab.
  // WorkScreen receives this as its React key, which causes a full remount and
  // therefore discards any open drawer or modal state. Programmatic navigation
  // from Today (onJobTap) does NOT bump this key — the drawer-open path must
  // survive. Only the BottomNav onChange handler bumps it.
  const [workResetKey, setWorkResetKey] = useState(0);
  // settingsResetKey: bumped when the user taps the Settings tab while already
  // on the Settings tab. SettingsScreen watches this prop in a useEffect and
  // calls navigateToHub() to pop back from any sub-screen. Counter starts at 0;
  // the effect guard `> 0` prevents a spurious hub-reset on initial mount.
  // Programmatic navigate('settings') from other tabs does NOT bump this key.
  const [settingsResetKey, setSettingsResetKey] = useState(0);

  // ── Trial-end conversion state ─────────────────────────────────────────────
  // trialEndSheetOpen: show the Moment-1 "keep Pro free another month" sheet
  //   on the last day of trial (Day-14 trigger). Suppressed if dismissed today.
  const [trialEndSheetOpen, setTrialEndSheetOpen] = useState(false);
  // dropToFreeOpen: show the Moment-2 drop-to-free full-screen on first post-
  //   expiry open. Set to true before plan is flipped (honesty fix).
  const [dropToFreeOpen, setDropToFreeOpen] = useState(false);
  const [dropToFreeUpgradeLoading, setDropToFreeUpgradeLoading] = useState(false);
  const [dropToFreeUpgradeError, setDropToFreeUpgradeError] = useState(null);
  // preChargeReminderVisible: Day-~43 in-app banner (external push/email stubbed).
  const [preChargeReminderVisible, setPreChargeReminderVisible] = useState(false);

  // ── "You've got Pro" reveal (comprehension fix) ────────────────────────────
  // proRevealOpen: shows the one-time gift-framed "You've got OHNAR Pro" sheet.
  // Fired from two places: right after OnboardingWizard.onComplete (below), and
  // as a fallback in refreshProfile for wizard-skippers (the common case since
  // zero-friction-entry lands new users straight on Today — see PR #262).
  // Gated on shouldShowProReveal (isTrialActive + a per-device localStorage
  // flag, NOT a Supabase column — see lib/proReveal.js for why).
  const [proRevealOpen, setProRevealOpen] = useState(false);

  // settingsSubView: which sub-screen within Settings is active.
  // null          → top-level SettingsScreen
  // 'card-payments' → CardPaymentsScreen (Stripe Connect)
  // Extend here as new Settings sub-screens are added.
  const [settingsSubView, setSettingsSubView] = useState(
    // If the OAuth callback redirected back with ?connected=1, open Settings
    // at the top level (the profile will already show 'connected' status once
    // refreshProfile has run). Strip the query param so it doesn't persist.
    () => {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.has('connected') || params.has('connect_error')) {
          // Clean the URL — remove query params but keep hash
          const clean = window.location.pathname + window.location.hash;
          window.history.replaceState(null, '', clean);
        }
        // upgrade_succeeded: Stripe redirects back to /#/settings?upgraded=1.
        // Fire once per device session; clear the param so Back/refresh don't re-fire.
        // subscription_active carries last_trigger so we can attribute the conversion
        // to the pillar that drove it (Insight vs white-label vs auto-chase vs settings).
        // The trigger was written to sessionStorage by ProUpgradeSheet on checkout_started
        // and survives the Stripe redirect because Stripe opens Checkout in the same tab.
        if (params.has('upgraded')) {
          const lastTrigger = getLastUpgradeTrigger();
          logTelemetry('upgrade_succeeded', { plan: 'pro' });
          logTelemetry('subscription_active', {
            last_trigger: lastTrigger,
            plan: 'pro',
          });
          const clean = window.location.pathname + window.location.hash;
          window.history.replaceState(null, '', clean);
        }
      }
      return null;
    }
  );

  // settingsScrollTarget: when FinanceScreen's "Add your costs" nudge fires,
  // navigate to Settings AND tell SettingsScreen to navigate to the target sub-screen.
  // Cleared by SettingsScreen via onScrollTargetConsumed once consumed.
  // Null = no pending target.
  // Valid values: 'overheads' | 'invoices' | null
  //   'overheads' → navigates to Settings > Costs sub-screen (legacy: used by FinanceScreen nudge).
  //   'invoices'  → navigates to Settings > Invoices & Quotes sub-screen (used by PostPaidSheet review nudge).
  const [settingsScrollTarget, setSettingsScrollTarget] = useState(null);

  // ── Materials library state ───────────────────────────────────────────────────
  // Loaded once on auth, refreshed after add/edit/archive mutations.
  // Graceful-degrades to [] if the table doesn't exist yet (migration pending).
  const [materials, setMaterials]             = useState([]);
  const [materialsOpen, setMaterialsOpen]     = useState(false);   // full MaterialsScreen
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);   // AddMaterialModal
  const [editingMaterial, setEditingMaterial] = useState(null);    // material row being edited

  // Minimum splash dwell so the full branded load sequence always completes
  // before auth unmounts the Splash screen. The choreography (see src/index.css
  // .splash__lockup): ring draw 50–750ms → lock-in beat + Success-Green sheen
  // 750–1150ms → wordmark fade/rise 850–1200ms. The floor must cover the last
  // beat (1200ms) or fast/returning users (cached session) get the wordmark cut
  // off mid-animation. Skipped under prefers-reduced-motion (no animation runs).
  // Skip the dwell above when this boot was caused by our own SW auto-update
  // reload (see the deferred-reload controllerchange handler further down)
  // rather than a genuine cold start — read-and-clear so only the one boot
  // right after that reload is fast-tracked; every other boot, including the
  // next real cold start, gets the full dwell as before.
  const [splashMinElapsed, setSplashMinElapsed] = useState(() => {
    try {
      if (sessionStorage.getItem(SW_RELOAD_SPLASH_SKIP_KEY)) {
        sessionStorage.removeItem(SW_RELOAD_SPLASH_SKIP_KEY);
        return true;
      }
    } catch { /* sessionStorage unavailable — falls back to the normal full-dwell splash */ }
    return false;
  });
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setSplashMinElapsed(true); return; }
    const t = setTimeout(() => setSplashMinElapsed(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // Splash exit — the "fly to header" magic move. Once the splash has shown its
  // full dwell AND we're entering the app (session exists), keep the splash
  // mounted briefly as an overlay so its lockup can fly up + shrink toward the
  // header while the app fades in underneath, then remove it. Skipped (instant)
  // under prefers-reduced-motion. See .splash--exiting in index.css.
  const [splashGone, setSplashGone] = useState(false);
  useEffect(() => {
    if (!(authReady && splashMinElapsed && session) || splashGone) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setSplashGone(true), reduce ? 0 : 700);
    return () => clearTimeout(t);
  }, [authReady, splashMinElapsed, session, splashGone]);

  // Hash-routed navigation: pushes history before switching view so browser
  // Back returns to the previous in-app screen instead of exiting the SPA.
  const navigate = useCallback((nextView) => {
    const hash = `#/${nextView}`;
    if (window.location.hash !== hash) {
      window.history.pushState({ view: nextView }, '', hash);
    }
    setView(nextView);
  }, []);

  // Canonicalise the URL after auth resolves. Gated on authReady so we don't
  // strip Supabase's magic-link hash fragment before detectSessionInUrl has
  // consumed it.
  useEffect(() => {
    if (!authReady) return;
    const { view: parsed } = parseHash();
    const expected = `#/${parsed}`;
    if (window.location.hash !== expected && parsed === 'today') {
      replaceHistory({ view: parsed }, expected);
    }
  }, [authReady]);

  // Chase-reminder deep-link: /?job=<jobId>#/work
  // Sent by chase-reminders.js push notification. Parses once after auth is
  // ready, sets pendingJobOpen, navigates to Work, then cleans the URL.
  useEffect(() => {
    if (!authReady) return;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job');
    if (jobId) {
      openJob(jobId);
      navigate('work');
      // Strip the ?job= param from the URL so Back/refresh doesn't re-trigger
      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', clean);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  // Single popstate listener: re-derive view from hash on Back/Forward.
  // Re-derive view from hash on Back/Forward press.
  useEffect(() => {
    const onPop = () => {
      setView(parseViewFromHash());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Wire the offline-queue sync runner on mount. Idempotent — safe to call here.
  // Runs an initial flush of any jobs queued in a previous session, then
  // listens for the 'online' event to retry on reconnect.
  useEffect(() => {
    wireOnlineSync();
  }, []);

  // Unlock the shared AudioContext (payment chime + voice-mic earcons, see
  // paymentSound.js/voiceEarcons.js) on the app's first user gesture. iOS
  // Safari refuses to play audio from a context that hasn't been resumed
  // inside a user-gesture callback — a mark-paid tap or a mic-open later in
  // the session (possibly after an await) wouldn't otherwise qualify.
  // One-time listener, removed after it fires.
  useEffect(() => {
    const onFirstGesture = () => unlockAudioContext();
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    window.addEventListener('touchstart', onFirstGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('touchstart', onFirstGesture);
    };
  }, []);

  const refreshFromCloud = useCallback(async () => {
    lastRefetchAtRef.current = Date.now();
    try {
      const [cloudJobs, cloudReceipts, cloudMaterials] = await Promise.all([
        getJobsFromCloud(),
        getReceiptsFromCloud(),
        getMaterials(),
      ]);

      // applyJobMetaToJobs includes the per-job status ratchet inside applyJobMeta:
      // if the cloud job is already quoteStatus:'accepted', localStorage is updated
      // to agree before the overlay runs, so the merged job always reflects cloud truth.
      setJobs(applyJobMetaToJobs(cloudJobs));
      setReceipts(cloudReceipts);
      setMaterials(cloudMaterials);
      setCloudLoaded(true);
    } catch (e) {
      console.warn('Cloud refresh failed, keeping localStorage view', e);
    }
  }, []);

  const refreshLocal = useCallback(() => {
    if (!cloudLoaded) {
      setJobs(applyJobMetaToJobs(getTodayJobs()));
      setReceipts(getTodayReceipts());
    }
  }, [cloudLoaded]);

  // Keep jobsRef current so the Realtime handler can read the latest job state
  // without a stale closure. Runs synchronously after every render that changes jobs.
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // Fetch user profile from Supabase (best-effort — slice 2 adds the actual columns)
  const refreshProfile = useCallback(async (userId) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (data) {
        setProfile(data);
        // Sync voice language preference to localStorage so AddJobModal can read
        // it synchronously when setting up the SpeechRecognition object.
        if (data.preferred_voice_lang) {
          localStorage.setItem('jp.voiceLang', data.preferred_voice_lang);
        }
        // ── First-use trial clock: start the 14-day window now if not yet set ─
        // initTrialOnFirstUse is idempotent — it only writes when trial_ends_at
        // is NULL, and guards against double-write with a localStorage flag per
        // user + a server-side WHERE trial_ends_at IS NULL clause.
        // The callback updates local state immediately so the banner reflects the
        // correct day count on this load without waiting for refreshProfile again.
        if (data.plan === 'trial' && !data.trial_ends_at) {
          initTrialOnFirstUse(supabase, userId, data, (endsAt) => {
            setProfile((prev) => ({ ...prev, trial_ends_at: endsAt }));
          });
        }
        // ── Honesty fix: trial expiry handling ─────────────────────────────
        // Rule: NEVER flip silently. If the trial has expired and the user
        // hasn't seen Moment 2, show DropToFreeScreen FIRST. The plan flip
        // and drop_to_free_seen mark happen AFTER the user dismisses Moment 2
        // (in handleDropToFreeDismiss). This prevents "surprise footer" on the
        // first send after expiry.
        if (trialJustExpired(data)) {
          const alreadySeen = hasDropToFreeSeen() || data?.drop_to_free_seen;
          if (!alreadySeen) {
            setDropToFreeOpen(true);
          } else {
            // User has already seen Moment 2 (cross-device or same device) —
            // flip the plan in the DB if it hasn't been flipped yet.
            flipExpiredTrialToFree(supabase, userId, data);
          }
        }

        // ── Day-14 trigger: fire Moment-1 sheet on the last trial day ───────
        // Fires once per day (localStorage gate) when trial has <= 1 day left
        // but is still active. "Not now" sets the gate; upgrade redirects to
        // Stripe so the gate is never needed in that path.
        if (isTrialLastDay(data) && !trialEndSheetDismissedToday()) {
          setTrialEndSheetOpen(true);
        }

        // ── "You've got Pro" reveal — Today-load fallback ───────────────────
        // Wizard-skippers (the common case — see the state comment above) get
        // the reveal here instead of via OnboardingWizard.onComplete. Runs once
        // per sign-in; shouldShowProReveal is false once the localStorage flag
        // is set, so this never re-fires after the trader has seen it.
        if (shouldShowProReveal(data, userId)) {
          setProRevealOpen(true);
        }

        // ── Day-~43 pre-charge reminder ──────────────────────────────────────
        // Show in-app banner within 5 days of the Moment-1 charge date.
        // External push/email is STUBBED — see PreChargeReminderBanner.jsx.
        if (shouldShowPreChargeReminder(data)) {
          setPreChargeReminderVisible(true);
        }

        // Identify the user in GA4 (PII-light: UUID + plan only, no email).
        identifyUser(userId, {
          plan: data.plan ?? 'free',
          trial_ends_at: data.trial_ends_at ?? null,
        });

        // trial_started — fires once per device when plan first observed as 'trial'.
        // The localStorage flag prevents re-firing on subsequent profile fetches.
        if (data.plan === 'trial' && !localStorage.getItem('jp.telemetry.trialStarted')) {
          localStorage.setItem('jp.telemetry.trialStarted', '1');
          logTelemetry('trial_started', { plan: 'trial' });
        }

        // ── Welcome email trigger ────────────────────────────────────────────
        // Fire-and-forget. The server function is the real idempotency guard
        // (profiles.welcome_email_sent_at); the client check here just avoids
        // a network call on every load for users who already received the email.
        // Skips phone-OTP users (no email) — the function also guards this.
        if (data.email && !data.welcome_email_sent_at) {
          supabase.auth.getSession().then(({ data: sessionData }) => {
            const token = sessionData?.session?.access_token;
            if (!token) return;
            fetch('/.netlify/functions/send-welcome-email', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
          }).catch(() => {});
        }
      }
    } catch {
      // profiles table may not have first_name/last_name yet — that's fine for slice 1
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setCloudLoaded(false);
        // Clear GA4 user_id so the next sign-in gets a clean anonymous session.
        try { window.gtag('config', import.meta.env.VITE_GA4_ID, { user_id: undefined }); } catch { /* gtag not bootstrapped — silently no-op */ }
        // Reset PostHog identity so the next sign-in gets a clean anonymous profile.
        try { posthog.reset(); } catch { /* PostHog not initialised or blocked — silently no-op */ }
        // Clear transient nav state — AppShell is one long-lived instance that
        // survives sign-out (only the render output swaps to <AuthScreen>), so
        // plain useState here would otherwise carry a Settings sub-screen (e.g.
        // stale view='settings'+settingsSubView='card-payments') or a pending
        // job-drawer open across into the NEXT sign-in on this device
        // (button-audit fix).
        navigate('today');
        setSettingsSubView(null);
        setPendingJobOpen(null);
        setWorkStageOverride(null);
        setSettingsScrollTarget(null);
      }
      // Funnel step 3: signed_in — fires on every SIGNED_IN event.
      // is_new_user = true when created_at is within the last 60 s, meaning this
      // is their first ever sign-in rather than a returning login. 60 s gives
      // enough headroom for slow email delivery + link tap without false positives.
      // sign_up is kept alongside it for backward-compat with existing dashboards.
      //
      // Referral attribution + this telemetry share the isNew computation, but
      // are gated on DIFFERENT events — see the comment below for why.
      if (newSession?.user && (_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION')) {
        const createdAt = new Date(newSession.user.created_at ?? 0).getTime();
        const isNew = Date.now() - createdAt < 60_000;

        // Telemetry only on a genuine SIGNED_IN transition — INITIAL_SESSION
        // also fires on every ordinary app reopen for an already-signed-in
        // user (session restored from storage), which would otherwise
        // double-count/inflate this funnel metric.
        if (_event === 'SIGNED_IN') {
          logTelemetry('signed_in', { is_new_user: isNew });
          if (isNew) logTelemetry('sign_up', { plan: 'free' });
        }

        // Referral attribution (JP-LU7 Phase 1; widened to INITIAL_SESSION
        // as part of the OAuth-attribution-loss fix):
        // If a ?ref= code was captured in main.jsx (persisted to sessionStorage),
        // call the record-referral function fire-and-forget.
        //
        // Checked on BOTH events because of a supabase-js race on the Google
        // OAuth *return* trip: the client starts processing the callback's
        // auth tokens as soon as it's constructed (before this effect has
        // subscribed). On a slow connection that processing can finish first,
        // in which case this listener receives INITIAL_SESSION (session
        // already populated) instead of SIGNED_IN — a check gated on
        // SIGNED_IN alone would then silently never fire for that signup.
        // We only attempt this on new sign-ups (isNew guard) to avoid re-attributing
        // existing users who click a referral link while already signed in.
        // The function itself also guards against self-referral and duplicates.
        try {
          const refCode = sessionStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
          if (refCode && isNew && newSession.access_token) {
            sessionStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
            fetch('/.netlify/functions/record-referral', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${newSession.access_token}`,
              },
              body: JSON.stringify({ referral_code: refCode }),
            }).catch(() => {
              // Fire-and-forget: attribution failure never blocks sign-in
            });
          }
        } catch {
          // sessionStorage unavailable — silently skip attribution
        }
      }
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
    // Subscribe once on mount only — navigate/setSettingsSubView/etc. are all
    // stable (useCallback/useState setters), safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    wipeLegacyDemoData();
    migrateLegacyTodayData();
    if (session) {
      refreshFromCloud();
      refreshProfile(session.user.id);
      // Hydrate chase state from cloud on every sign-in (merge-on-open, cloud wins on
      // freshness). Fire-and-forget — does not block render; falls back to localStorage
      // silently if the job_chase_states table doesn't exist yet (migration pending).
      hydrateChaseState(supabase).catch(console.warn);
      // Flush the ToS acceptance stashed by AuthScreen's clickwrap line, once,
      // to user_metadata. No-op if nothing was stashed or it's already recorded.
      flushTosAcceptance(supabase, session.user).catch(() => {});
    }
  }, [session, refreshFromCloud, refreshProfile]);

  // Register service worker for PWA (required for push and offline caching).
  // Safe to call multiple times — the browser deduplicates registrations to the same script URL.
  //
  // Auto-update: when a new SW takes over (skipWaiting + clients.claim in sw.js),
  // the browser fires 'controllerchange' on navigator.serviceWorker. We reload once
  // so the page immediately picks up the new JS/CSS/asset URLs from the new cache.
  //
  // Loop-guard: the module-level `swReloaded` flag is set BEFORE window.location.reload()
  // is called. If the page somehow triggers another controllerchange after the reload
  // (e.g. a race between two near-simultaneous deploys), the flag check prevents a
  // second reload. The flag lives in module scope so it survives React re-renders
  // but resets on a full page load — exactly the right lifetime.
  //
  // Deferred until backgrounded: reloading the INSTANT the new SW takes over would
  // yank the page out from under a trader mid-form-entry (e.g. typing an invoice)
  // any time a deploy lands while they have the app open — which reads to them as
  // "it kicked me back to the splash screen while I was using it". If the tab is
  // visible right now, wait for them to background it (visibilitychange → hidden)
  // before reloading — invisible to them either way, since the app isn't on screen.
  // If it's already hidden when the update lands, reload immediately, as before.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed', err?.message);
    });

    // swReloaded is declared at module level (below) — guards against reload loops.
    function reloadNow() {
      if (swReloaded) return;
      swReloaded = true;
      // Lets the next boot's splashMinElapsed skip its artificial dwell floor —
      // see the initialiser above. Best-effort: a full splash on the rare
      // sessionStorage-unavailable browser is a cosmetic regression, not worth
      // blocking the reload over.
      try { sessionStorage.setItem(SW_RELOAD_SPLASH_SKIP_KEY, '1'); } catch { /* ignore */ }
      window.location.reload();
    }

    // Holds the pending hidden-listener once armed (null otherwise) — doubles as
    // the "already waiting" guard and the handle cleanup needs to remove it if
    // AppShell unmounts mid-wait (dev strict-mode double-invoke, HMR).
    let onHidden = null;

    // Reload once when a new SW takes control of this page.
    function onControllerChange() {
      if (swReloaded) return;
      if (onHidden) return;
      if (document.visibilityState === 'hidden') {
        reloadNow();
        return;
      }
      onHidden = () => {
        if (document.visibilityState !== 'hidden') return;
        document.removeEventListener('visibilitychange', onHidden);
        reloadNow();
      };
      document.addEventListener('visibilitychange', onHidden);
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (onHidden) document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  // Push permission prompt: show once per device, 5 seconds after sign-in.
  // Conditions to show:
  //   - Push is supported by this browser/OS (not iOS < 16.4 in browser tabs)
  //   - User is signed in (session exists)
  //   - User has never been asked on this device (jp.pushPromptDismissed not set)
  //   - Notification.permission is 'default' (not already granted or denied)
  // If permission is 'granted' but no subscription exists (expired or cleared),
  // silently re-subscribe without showing the prompt.
  useEffect(() => {
    if (!session?.user?.id) return;
    if (!isPushSupported()) return;

    // Silently re-subscribe on every app open for granted users.
    // 'granted-unsubscribed': permission granted but no subscription (expired/cleared).
    // 'granted-subscribed': subscription exists but may be bound to a rotated VAPID key —
    //   subscribe() detects the mismatch, tears down the stale entry, and upserts a fresh
    //   one. When the key matches, subscribe() is a cheap upsert no-op (idempotent).
    // Neither path prompts the user — Notification.requestPermission() is never called here.
    getSubscriptionStatus().then((status) => {
      if (status === 'granted-unsubscribed' || status === 'granted-subscribed') {
        pushSubscribe(session.user.id).catch(() => {});
        return;
      }
      if (status !== 'default') return;
      if (localStorage.getItem('jp.pushPromptDismissed')) return;

      // Wait 5 s after sign-in before showing — give the user time to orient.
      // Session-one gate (JP-LU2): defer the prompt if an active snackbar is
      // showing during the first session (e.g. a nav orientation toast).
      // isSession1Done() returns true after first markPaid or first job save.
      const t = setTimeout(() => {
        if (!isSession1Done() && snackbarActive) return;
        setPushPromptVisible(true);
      }, 5000);
      return () => clearTimeout(t);
    }).catch(() => {});
  }, [session]);

  // ─── Realtime subscription ───────────────────────────────────────────────
  // Subscribe to jobs table changes as soon as a session is available.
  // On any INSERT/UPDATE/DELETE: refetch from cloud (idempotent, RLS-filtered).
  // On UPDATE with a freshly-set acceptedSignature from a remote source:
  //   show a toast if the trader isn't already viewing that job's drawer.
  //   The drawer auto-updates via the refetch — no separate notify needed there.
  // On reconnect after offline: immediate refetch to catch missed events.
  //
  // Local optimistic edits (offline) survive: applyJobMetaToJobs merges the
  // localStorage side-channel on top of cloud data, so a refetch after a
  // remote change does not overwrite offline-only local edits.
  useEffect(() => {
    if (!session?.user?.id) return;

    const userId = session.user.id;

    const handleJobChange = async (payload) => {
      // Detect remote decision (G-2): compare previous job quoteStatus (from ref)
      // to the incoming change. Fire a toast and pre-sync localStorage when:
      //   1. The event is an UPDATE
      //   2. incomingMeta.quoteStatus is 'accepted' or 'declined'
      //   3. The previous in-memory quoteStatus for that row was different
      //      (prevents re-notifying on subsequent cloud syncs of the same row)
      if (payload.eventType === 'UPDATE' && payload.new) {
        const incoming = payload.new;
        const incomingMeta = (incoming.meta && typeof incoming.meta === 'object') ? incoming.meta : {};
        const newQuoteStatus = incomingMeta.quoteStatus;

        if (newQuoteStatus === 'accepted' || newQuoteStatus === 'declined') {
          const prev = jobsRef.current.find(j => j.id === incoming.id);
          const prevQuoteStatus = prev?.quoteStatus || null;
          const isNewDecision = prevQuoteStatus !== newQuoteStatus;

          if (isNewDecision && incoming.id) {
            if (newQuoteStatus === 'accepted') {
              // Sync acceptance fields into localStorage BEFORE refreshFromCloud().
              // applyJobMetaToJobs overlays localStorage on top of cloud data, so
              // without this a stale quoteStatus:'sent' in localStorage would win
              // over the cloud's quoteStatus:'accepted', leaving the view stuck on
              // "Awaiting go-ahead". No acceptedSignature — G-2 does not write it.
              //
              // Gap 2 fix: write ONLY quoteStatus + acceptance fields — NOT
              // status/jobStatus. Those pipeline stage fields must stay free to
              // sync cross-device (e.g. a later Invoiced move from another device
              // must not be masked). clearPending ensures the cloud values win.
              writeJobMeta(incoming.id, {
                quoteStatus:    'accepted',
                acceptedAt:     incomingMeta.acceptedAt,
                acceptedName:   incomingMeta.acceptedName ?? null,
                acceptedSource: 'remote',
              });
              clearPending(incoming.id, ['status', 'jobStatus']);

              const customerName = incomingMeta.acceptedName || incoming.customer_name || prev?.customer || prev?.name || 'Customer';
              const amount = Number(prev?.total ?? prev?.amount ?? incomingMeta.total ?? 0) || 0;
              const amountStr = amount > 0
                ? ` · £${amount.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`
                : '';
              // This can land while the trader is anywhere in the app (or has
              // it backgrounded) — the toast alone is easy to miss. haptic()
              // is a no-op on iOS Safari/PWA, so playAcceptedEarcon() is the
              // partner that makes "a customer just said yes" actually
              // noticeable there too.
              haptic('success');
              playAcceptedEarcon();
              snackbarEnqueue({
                type: 'realtime',
                message: `${customerName} accepted your quote${amountStr}`,
                jobId: incoming.id || null,
                dwell: 8000,
                priority: 10,
              });
            } else {
              // Declined — pre-sync localStorage so the trader's job card flips
              // without waiting for the debounced refreshFromCloud.
              writeJobMeta(incoming.id, {
                quoteStatus: 'declined',
                declinedAt:  incomingMeta.declinedAt,
                declinedName: incomingMeta.declinedName ?? null,
              });

              const customerName = incomingMeta.declinedName || incoming.customer_name || prev?.customer || prev?.name || 'Customer';
              snackbarEnqueue({
                type: 'realtime',
                message: `${customerName} declined your quote`,
                jobId: incoming.id || null,
                dwell: 8000,
                priority: 10,
              });
            }
          }
        }

        // Payment landed remotely — either the customer paid a Stripe pay-link
        // (stripe-connect-webhook.js writes paid straight to the jobs row), or
        // this trader marked the job paid from a different device. Compare
        // against jobsRef.current, which already reflects THIS device's own
        // optimistic mark-paid writes (see onMarkPaidFromToday/onUpdateJob) —
        // so the echo of a payment this device itself just made does not
        // double-fire the chime; only a genuinely new not-paid→paid transition
        // does. No PaidCelebration/PostPaidSheet here — those stay tied to the
        // direct call sites; this is just the quiet "money landed" ping.
        const incomingPaid = incoming.paid === true || incoming.status === 'paid';
        if (incomingPaid && incoming.id) {
          const prevJob = jobsRef.current.find(j => j.id === incoming.id);
          const wasPaid = prevJob?.paid === true || prevJob?.status === 'paid';
          if (!wasPaid) {
            haptic('success');
            playPaymentReceivedSound();
          }
        }
      }

      // Refetch regardless of event type — keeps all state in sync.
      // Debounced: a burst of rapid changes (e.g. offline sync flush) collapses
      // into a single fetch 2 s after the last event, preventing a refetch storm
      // on flaky van connections.  The timer is cleaned up on unmount below.
      clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = setTimeout(() => { refreshFromCloud(); }, 2000);
    };

    const unsub = subscribeToJobs(
      userId,
      handleJobChange,
      // onReconnect: immediate refetch (not debounced) to catch events missed
      // during a disconnect.  We want this to fire promptly on reconnect.
      () => { refreshFromCloud(); }
    );

    return () => {
      unsub();
      clearTimeout(realtimeDebounceRef.current);
    };
  }, [session, refreshFromCloud]);

  useEffect(() => {
    if (view === 'today') refreshLocal();
  }, [view, refreshLocal]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'jobprofit-app-data' && !cloudLoaded) {
        setJobs(applyJobMetaToJobs(getTodayJobs()));
        setReceipts(getTodayReceipts());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [cloudLoaded]);

  // Fix B — visibility / focus / pageshow backstop refetch.
  //
  // When the trader picks up the READING device (the one that hasn't made any
  // edits recently), this fires refreshFromCloud so Device B immediately gets
  // the latest cloud state — regardless of whether realtime delivered the event.
  //
  // Only fires when a session exists (unauthenticated tabs skip the refetch).
  // Throttled: skip if a refetch already ran in the last 5 seconds, which
  // prevents a double-fetch when a realtime onReconnect and a visibility event
  // fire simultaneously (e.g. phone coming back online + screen unlock).
  //
  // CRITICAL: this effect is placed ABOVE the early return at line ~1260 because
  // React hooks must never be conditional. All refs (lastRefetchAtRef) used here
  // are declared above this point.
  //
  // This is intentionally SEPARATE from the WorkScreen call-pay visibilitychange
  // listener. That listener drives the call-pay prompt using in-memory jobs and
  // must not be disturbed. This listener refreshes the cloud state.
  useEffect(() => {
    if (!session?.user?.id) return;

    const THROTTLE_MS = 5000;

    function maybeRefresh() {
      const now = Date.now();
      if (now - lastRefetchAtRef.current < THROTTLE_MS) return;
      refreshFromCloud();
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') maybeRefresh();
    }

    function onFocus() {
      maybeRefresh();
    }

    function onPageShow(e) {
      // e.persisted === true means the page was restored from the bfcache
      // (back-forward cache). Always refetch in that case as the data may
      // be seconds or minutes stale. Also fires on normal page load — the
      // throttle prevents a redundant fetch on top of the session effect.
      if (e.persisted) refreshFromCloud();
      else maybeRefresh();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [session, refreshFromCloud]);

  // Nav orientation toast removed: slice-3 has been live for weeks and all
  // existing users already have jp.slice3NavToast.v2 set. New users land
  // on a clean app where the nav is self-evident. Dead key cleaned up at boot.

  // Wizard auto-open removed (feat/zero-friction-entry, 2026-06-02).
  // New users land directly on Today. The wizard is reachable on demand from
  // Settings ("Finish setting up"). Missing business/bank details are collected
  // just-in-time at the invoice-send step (SendInvoiceModal identity/bank gates).

  const handleAddJob = async (job) => {
    try {
      await addJobToCloud(job);
      await refreshFromCloud();
      // Funnel step 4a: every job save — used for funnel volume analysis.
      logTelemetry('job_logged');
      // Funnel step 4b: ACTIVATION — fires once per user on their very first job.
      // Guard: jp.telemetry.activated in localStorage prevents re-firing on
      // subsequent jobs or re-logins. This is intentionally localStorage-scoped
      // (not server-side) because we care about first-value on this device.
      // If the user clears storage they may re-fire once — acceptable for a
      // funnel signal that only affects analytics, not app behaviour.
      if (!localStorage.getItem('jp.telemetry.activated')) {
        localStorage.setItem('jp.telemetry.activated', '1');
        const userId = session?.user?.id;
        const createdAt = userId ? new Date(session.user.created_at ?? 0).getTime() : null;
        const secsSinceSignup = createdAt ? Math.round((Date.now() - createdAt) / 1000) : null;
        logTelemetry('user_activated', { secs_since_signup: secsSinceSignup });
      }
    } catch (e) {
      // F1: Log structured Supabase error fields so the root cause is visible
      // in the console and in our telemetry rather than being swallowed.
      // No PII — we emit code/message/details/hint only (no customer data).
      console.error('Add job failed — queuing for offline sync', {
        code:    e?.code,
        message: e?.message,
        details: e?.details,
        hint:    e?.hint,
        raw:     e,
      });
      // TODO(telemetry): upgrade logTelemetry calls below to PostHog when the
      // job_save_cloud_failed event is registered in the GA4 custom dimensions.
      logTelemetry('job_save_cloud_failed', {
        error_code:    e?.code    ?? null,
        error_message: e?.message ?? null,
      });
      // Write locally so the UI reflects the save immediately, then enqueue
      // for sync when the device is back online. The job.id is a UUID generated
      // client-side in addJobToCloud (or supplied by the caller), so the queue
      // can retry the exact same row without creating a duplicate.
      addTodayJob(job);
      setJobs(applyJobMetaToJobs(getTodayJobs()));
      // Enqueue requires a string UUID. If job.id is a Date.now() integer
      // (legacy path), generate a fresh UUID for the queue row.
      const queuePayload = {
        ...job,
        id: (job.id && typeof job.id === 'string') ? job.id : crypto.randomUUID(),
      };
      enqueueJob(queuePayload).catch(qErr =>
        console.error('enqueueJob failed', qErr)
      );
      // F3: Trigger one immediate retry rather than waiting for the next
      // lifecycle event (online / app-load). Self-heals transient auth blips.
      if (navigator.onLine) {
        runSync().catch(() => {});
      }
    }
  };

  const handleAddReceipt = async (arg) => {
    const payload = arg?.payload || arg;
    const photoFile = arg?.photoFile || null;
    // When jobId is already known (e.g. added from inside JobDetailDrawer),
    // skip the LinkReceiptModal — the job link is already in the payload.
    const jobIdAlreadyKnown = !!(payload?.jobId);
    try {
      const savedReceipt = await addReceiptToCloud(payload, photoFile);
      await refreshFromCloud();
      if (savedReceipt?.id && !jobIdAlreadyKnown) {
        setPendingLink(savedReceipt);
      }
    } catch (e) {
      console.error('Add receipt failed', e);
      addTodayReceipt(payload);
      setReceipts(getTodayReceipts());
    }
  };

  // "Load sample data" — see src/lib/sampleData.js for the full design note.
  // Re-throws on failure so the calling screen (TodayScreen/SettingsScreen)
  // can show its own error toast instead of this silently no-op'ing.
  const handleLoadSampleData = async () => {
    const result = await seedSampleData();
    await refreshFromCloud();
    logTelemetry('sample_data_loaded', { created: result?.created ?? 0, already_loaded: !!result?.alreadyLoaded });
    return result;
  };

  const handleClearSampleData = async () => {
    const result = await clearSampleData();
    await refreshFromCloud();
    logTelemetry('sample_data_cleared', { removed: result?.removed ?? 0 });
    return result;
  };

  // Re-throws on failure (does NOT touch receipts state) so the receipt stays
  // visible in the UI exactly when it's still in Supabase/localStorage.
  // JobDetailDrawer's delete-confirm flows already catch this and show
  // "Could not delete receipt — try again" (see JobDetailDrawer.jsx).
  //
  // Previously this caught the error and stripped the receipt from render
  // state anyway ("optimistic" removal on ANY failure). That created a
  // zombie: gone from the UI, but the cloud row + localStorage mirror were
  // untouched, so the receipt reappeared on the next refreshFromCloud() or
  // page reload. Success already updates state correctly via refreshFromCloud()
  // below, so there is nothing for a catch block to do but let it propagate.
  const handleDeleteReceipt = async (receiptId) => {
    await deleteReceiptFromCloud(receiptId);
    await refreshFromCloud();
  };

  // Writes the edited receipt to cloud and updates in-memory receipts[] state so
  // the edit reflects immediately without waiting for the next cloud refresh.
  // Returns the updated receipt object so JobDetailDrawer can close the modal
  // only after a confirmed write — never flash "saved" on a silently dropped edit.
  const handleUpdateReceipt = async (updatedReceipt) => {
    const saved = await updateReceiptInCloud(updatedReceipt);
    setReceipts(prev =>
      prev.map(r => (r.id === saved.id ? saved : r))
    );
    return saved;
  };

  // ── Materials library CRUD handlers ──────────────────────────────────────────

  const handleSaveMaterial = async (payload) => {
    if (payload.id) {
      // Edit mode — patch existing row
      const updated = await updateMaterial(payload.id, payload);
      if (updated) {
        setMaterials(prev => prev.map(m => m.id === updated.id ? updated : m));
      }
    } else {
      // Add mode — insert new row
      const saved = await addMaterial(payload);
      if (saved) {
        setMaterials(prev => [saved, ...prev]);
      }
    }
    setAddMaterialOpen(false);
    setEditingMaterial(null);
  };

  const handleArchiveMaterial = async (id) => {
    const ok = await archiveMaterial(id);
    if (ok) setMaterials(prev => prev.filter(m => m.id !== id));
  };

  // Called when a bookmark tap in AddJobModal or AddReceiptModal saves a new row.
  // The row is already written to Supabase by saveLineItemToLibrary — we only need
  // to merge it into local state.
  const handleMaterialSaved = (savedRow) => {
    if (!savedRow) return;
    setMaterials(prev => {
      const exists = prev.some(m => m.id === savedRow.id);
      if (exists) return prev.map(m => m.id === savedRow.id ? savedRow : m);
      return [savedRow, ...prev];
    });
  };

  // Fires the cloud write after every writeJobMeta call. Fire-and-forget —
  // the UI does not await this. localStorage write already succeeded by the
  // time this runs.
  //
  // Fix A (cross-device sync): on a confirmed cloud write, clearPending removes
  // the synced fields from the per-job pending set. After that, the next call
  // to applyJobMeta lets the fresh CLOUD value win for those fields rather than
  // re-applying the now-stale local snapshot. Fields that fail to sync stay
  // pending so they continue to overlay the cloud value correctly on reload.
  const syncMetaToCloud = (jobId, mergedMeta) => {
    if (!jobId || !mergedMeta) return;
    updateJobMetaInCloud(jobId, mergedMeta)
      .then((result) => {
        // result is { ok: true } on success or { ok: false, error: '...' } on failure.
        if (result?.ok) {
          // Cloud confirmed the write — the fields in mergedMeta are now in sync.
          // Clear them from the pending set so Device B's fresh cloud read wins.
          clearPending(jobId, Object.keys(mergedMeta));
        }
        // Non-ok result (offline, RLS, etc.): fields stay pending. The offline
        // queue will retry; clearPending is called from runMetaSync on success.
      })
      .catch((err) => {
        console.warn('syncMetaToCloud failed', jobId, err?.message);
        // Fields stay pending on exception — same retry behaviour as non-ok.
      });
  };

  // Mark-paid from the new Today awaiting section. Writes the new payment fields
  // into the jobMeta side-channel, then fires the cloud write async.
  const onMarkPaidFromToday = (job, method) => {
    markSession1Done();
    logTelemetry('mark_paid', { source: 'today', method: method ?? 'unknown' });
    // job_paid: compute profit props here while the full receipts array is in scope.
    const { quote: headline_price, materials: job_costs, profit: true_profit } =
      getJobProfit(job, receipts);
    logTelemetry('job_paid', { headline_price, job_costs, true_profit, source: 'today' });
    const updated = {
      ...job,
      status: 'paid',
      paidAt: new Date().toISOString(),
      paymentMethod: method,
      paymentStatus: 'paid',
      paymentDate: new Date().toISOString().slice(0, 10),
      jobStatus: 'complete',
      paid: true,
    };
    const merged = writeJobMeta(updated.id, extractJobMeta(updated));
    syncMetaToCloud(updated.id, merged);
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));

    // Fire the shared paid celebration + haptic on every mark-paid gesture.
    haptic('success');
    playPaymentReceivedSound();
    setPaidCelebrationAmount(job.total ?? job.amount ?? null);
    // PostPaidSheet will show after PaidCelebration auto-dismisses (~1.3s).
    // We pass the original job here — customer/phone/address are read-only props.
    setPostPaidJob(updated);

    // Payment recorded first (state update above). Now decide whether to show
    // the lightweight cost-capture snackbar. Auto-dismisses after 6 s if the
    // user does nothing — payment is never affected either way.
    const jobIncome = job.total ?? job.amount ?? 0;
    const jobCostTotal = Array.isArray(receipts)
      ? receipts
          .filter(r => r.jobId === job.id || r.job_id === job.id)
          .reduce((s, r) => s + Number(r.amount || 0), 0)
      : 0;
    const remindJobCosts = profile?.remind_job_costs !== false;
    const showSnackbar = shouldShowCostPrompt({
      jobId: job.id,
      jobIncome,
      jobCostTotal,
      remindJobCosts,
    });
    if (showSnackbar) {
      recordPromptShown(job.id);
      setCostSnackbarJob({ job, jobCostTotal });
      snackbarEnqueue({
        type: 'cost',
        message: 'Paid — add what this job cost you?',
        job,
        jobCostTotal,
        dwell: 6000,
        priority: 4,
      });
    }
  };

  // Partial-payment add (Phase B of partial-payments PRD). payments[] lives in
  // the jobMeta side-channel; addPayment handles validation + auto-flip rule.
  const onAddPayment = (job, payload) => {
    const updated = addPayment(job, payload);
    const merged = writeJobMeta(updated.id, extractJobMeta(updated));
    syncMetaToCloud(updated.id, merged);
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));

    // Fire the shared paid celebration when this payment clears the balance.
    // applyAutoFlip (inside addPayment) sets status='paid' on a full clearance.
    if (updated.status === 'paid') {
      haptic('success');
      playPaymentReceivedSound();
      setPaidCelebrationAmount(updated.total ?? updated.amount ?? null);
      // PostPaidSheet will show after PaidCelebration auto-dismisses.
      setPostPaidJob(updated);
    }
  };

  // Generic job field update used by JobDetailDrawer and SendInvoiceModal.
  // Writes all meta fields (photos, notes, lineItems, invoice state, etc.)
  // to localStorage then fires a cloud write async.
  // Detects a not-paid→paid transition so every mark-paid path (tile, stage-
  // advance in drawer) gets the same celebration haptic + overlay without each
  // call-site having to remember to fire it separately.
  // onMarkPaidFromToday and onAddPayment do NOT route through here (verified:
  // both call setJobs directly), so there is no double-fire risk.
  const onUpdateJob = (updated) => {
    const wasPaid = jobs.find(j => j.id === updated.id)?.paid === true ||
                    jobs.find(j => j.id === updated.id)?.status === 'paid';
    const nowPaid = updated.paid === true || updated.status === 'paid';
    const merged = writeJobMeta(updated.id, extractJobMeta(updated));
    syncMetaToCloud(updated.id, merged);
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
    if (!wasPaid && nowPaid) {
      haptic('success');
      playPaymentReceivedSound();
      setPaidCelebrationAmount(updated.total ?? updated.amount ?? null);
      // PostPaidSheet will show after PaidCelebration auto-dismisses.
      setPostPaidJob(updated);
    }
  };

  // Removes a hard-deleted job from local state. The cloud row is already gone
  // (deleteJobFromCloud fired inside WorkScreen before this callback runs).
  const onDeleteJob = (jobId) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
  };

  const handleLinkReceipt = async (jobId) => {
    if (!pendingLink) return;
    try {
      await linkReceiptToJob(pendingLink.id, jobId);
      await refreshFromCloud();
    } catch (e) {
      console.error('Link receipt failed', e);
    }
    setPendingLink(null);
  };

  const handleEnablePush = async () => {
    setPushPromptVisible(false);
    localStorage.setItem('jp.pushPromptDismissed', '1');
    // requestPermission is in pushSubscribe but we can call the browser API
    // directly here since we need to react to the result in the same gesture.
    const permission = await Notification.requestPermission();
    if (permission === 'granted' && session?.user?.id) {
      pushSubscribe(session.user.id).catch(() => {});
    }
  };

  const handleDismissPush = () => {
    setPushPromptVisible(false);
    localStorage.setItem('jp.pushPromptDismissed', '1');
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setJobs([]);
      setReceipts([]);
      setCloudLoaded(false);
      setDrawerOpen(false);
      try { localStorage.removeItem('jobprofit-app-data'); } catch {}
    } catch (e) {
      console.warn('Sign out failed', e);
    }
  };

  // Called by SyncBadge when the queue is stuck due to an auth failure.
  // Signing out clears the Supabase session, which causes AppShell to render
  // <AuthScreen /> so the user can sign back in and the queue can flush.
  const handleSyncSignIn = () => supabase.auth.signOut().catch(() => {});

  // ── Trial-end conversion handlers ──────────────────────────────────────────

  /**
   * Moment-1 "Not now" dismiss — record the per-day localStorage gate so
   * the sheet doesn't re-nag today, then close.
   */
  const handleTrialEndSheetDismiss = () => {
    recordTrialEndSheetDismissed();
    setTrialEndSheetOpen(false);
  };

  /**
   * "You've got Pro" reveal dismiss — the single "Show me" CTA (and the
   * shared × / overlay-tap close) all route here via ProUpgradeSheet's
   * onClose. Marks the per-device localStorage flag so the reveal never
   * fires again for this user on this device, then closes the sheet.
   */
  const handleProRevealDismiss = () => {
    markProRevealSeen(session?.user?.id);
    setProRevealOpen(false);
  };

  /**
   * Moment-2 "Stay on free" dismiss — this is the point where we:
   *   1. Mark drop_to_free_seen on this device (localStorage)
   *   2. Write drop_to_free_seen=true + plan='free' to Supabase (flip)
   *   3. Update local profile state optimistically
   *   4. Close the screen
   */
  const handleDropToFreeDismiss = () => {
    markDropToFreeSeen();
    setDropToFreeOpen(false);
    // Clear any stale Moment-1 trial-end sheet that may still be in memory
    // (e.g. app kept open across the day14→day15 expiry boundary). Without
    // this, dismissing the drop-to-free screen would reveal the "Keep Pro /
    // add a card" sheet underneath — contradictory UX for a user who just
    // chose to stay on free.
    setTrialEndSheetOpen(false);
    // Optimistic local update so the UI reflects free immediately
    setProfile(prev => prev ? { ...prev, plan: 'free', drop_to_free_seen: true } : prev);
    // Fire-and-forget DB write (flipExpiredTrialToFree now also writes drop_to_free_seen)
    if (session?.user?.id && profile) {
      flipExpiredTrialToFree(supabase, session.user.id, profile).catch(() => {});
    }
  };

  /**
   * Moment-2 "Go Pro — £12/month" — immediate checkout, no coupon.
   * On success Stripe redirects away; on error show inline.
   */
  const handleDropToFreeUpgrade = async () => {
    setDropToFreeUpgradeLoading(true);
    setDropToFreeUpgradeError(null);
    const { error } = await startCheckoutImmediate({ source: 'drop_to_free' });
    if (error) {
      setDropToFreeUpgradeError(error);
      setDropToFreeUpgradeLoading(false);
    }
    // On success Stripe navigates away — loading state is naturally abandoned.
  };

  /**
   * Update a subset of the user's profile.
   * Writes to Supabase first, then updates local state optimistically.
   * If the Supabase write fails, the local state is reverted so the UI
   * stays consistent with what's actually stored.
   *
   * Called by SettingsScreen via the onProfileUpdate prop.
   */
  const handleProfileUpdate = async (patch) => {
    if (!session?.user?.id) throw new Error('Not signed in');
    const previous = profile;
    // Optimistic update — row updates immediately in the UI
    setProfile(prev => ({ ...prev, ...patch }));
    try {
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', session.user.id);
      if (error) throw error;
    } catch (err) {
      // Revert optimistic update on failure
      setProfile(previous);
      throw err;
    }
  };

  // ── Money tab export ──────────────────────────────────────────────────────
  // FREE — no isPro check. Privacy policy promises "your data is yours, export
  // anytime". Gating this would contradict that live GDPR data-portability promise.
  const [moneyExportSheetOpen, setMoneyExportSheetOpen] = useState(false);
  const [moneyExporting, setMoneyExporting] = useState(false);

  // ── Accountant-ready export (Xero / QuickBooks) ─────────────────────────
  // Smarter-export-only: no OAuth, no API connection, no sync — just correctly
  // shaped CSV files zipped for a one-go accountant import. UNLIKE the plain
  // CSV/XLSX/PDF formats above (kept FREE for the GDPR data-portability
  // promise), these two are Pro-gated: they're a bookkeeping value-add, not a
  // basic data export, so they follow the same Insight Layer seam as the rest
  // of the Money tab's Pro features.
  const [accountantExportPlatform, setAccountantExportPlatform] = useState(null); // 'xero' | 'quickbooks'
  const [accountantExportSheetOpen, setAccountantExportSheetOpen] = useState(false);
  const [accountantExportUpgradeOpen, setAccountantExportUpgradeOpen] = useState(false);
  const [accountantExporting, setAccountantExporting] = useState(false);

  const handleExportFromMoney = useCallback(() => {
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    if (safeJobs.length === 0) return; // FinanceScreen disables the button in this case
    setMoneyExportSheetOpen(true);
  }, [jobs]);

  const handleMoneyExportFormatPick = useCallback(async (format) => {
    setMoneyExportSheetOpen(false);

    if (format === 'xero' || format === 'quickbooks') {
      if (!isPro(profile)) {
        setAccountantExportUpgradeOpen(true);
      } else {
        setAccountantExportPlatform(format);
        setAccountantExportSheetOpen(true);
      }
      return;
    }

    if (moneyExporting) return;
    const safeJobs     = Array.isArray(jobs)     ? jobs     : [];
    const safeReceipts = Array.isArray(receipts) ? receipts : [];
    if (safeJobs.length === 0) return;
    const stamp = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    })();
    setMoneyExporting(true);
    try {
      if (format === 'csv') {
        const csv = buildJobsCsv(safeJobs, safeReceipts);
        await downloadOrShareCsv(csv, `ohnar-export-${stamp}.csv`);
      } else if (format === 'pdf') {
        const businessName = profile?.business_name || profile?.businessName || '';
        const blob = await buildJobsPdf(safeJobs, safeReceipts, {
          title: 'Records export',
          businessName,
          isPro: isPro(profile),
        });
        await downloadOrShare(blob, `ohnar-export-${stamp}.pdf`, 'application/pdf');
      } else if (format === 'xlsx') {
        await buildJobsXlsx(safeJobs, safeReceipts, `ohnar-export-${stamp}.xlsx`);
      }
    } catch {
      // Non-critical: the user can try again — no visible toast wired here
      // to avoid adding a toast system dependency to AppShell.
      console.warn('Money tab export failed');
    } finally {
      setMoneyExporting(false);
    }
  }, [jobs, receipts, profile, moneyExporting]);

  const handleAccountantExportGenerate = useCallback(async (period, customStart, customEnd) => {
    if (accountantExporting || !accountantExportPlatform) return;
    const safeJobs     = Array.isArray(jobs)     ? jobs     : [];
    const safeReceipts = Array.isArray(receipts) ? receipts : [];
    // Canonical VAT-registered check — mirrors FinanceScreen's isVatRegistered
    // (biz is always null in AppShell; profile.vat_number/.vat_registered are
    // the live fields since the slice-3 nav migration).
    const isVatRegisteredForExport = !!(profile?.vat_number) || !!(profile?.vat_registered);

    setAccountantExporting(true);
    try {
      const { files, zipFilename } = buildAccountantExportFiles({
        platform: accountantExportPlatform,
        jobs: safeJobs,
        receipts: safeReceipts,
        profile,
        isVatRegistered: isVatRegisteredForExport,
        period,
        customStart,
        customEnd,
      });
      const blob = await buildAccountantExportZipBlob(files);
      await downloadOrShare(blob, zipFilename, 'application/zip');
      setAccountantExportSheetOpen(false);
      setAccountantExportPlatform(null);
    } catch {
      // Non-critical: the user can try again — mirrors the Money-export pattern above.
      console.warn('Accountant export (Xero/QuickBooks) failed');
    } finally {
      setAccountantExporting(false);
    }
  }, [jobs, receipts, profile, accountantExportPlatform, accountantExporting]);

  const openDetailed = () => {
    // Profile-completeness gate removed (feat/zero-friction-entry, 2026-06-02).
    // Users can create jobs immediately after sign-in. Missing business/bank
    // details are collected just-in-time at the invoice-send step.
    navigate('work');
  };

  /**
   * Hard-reset all transient UI state for any tab that has in-tab surfaces
   * (drawers, modals, pickers). Called exclusively from the BottomNav onChange
   * handler so that every deliberate tab tap lands on a clean list/screen.
   *
   * The Today → Send invoice → pick customer → opens drawer path is NOT affected
   * because that path calls navigate() directly, bypassing handleTabChange.
   *
   * Defined before conditional early returns to keep hook order stable (Rules of Hooks).
   */
  const resetTransientUI = useCallback((nextView) => {
    // Clear the account drawer (new-nav)
    setDrawerOpen(false);
    // If the user taps the work tab directly, bump the reset key so
    // WorkScreen remounts and discards any open JobDetailDrawer. When navigating
    // programmatically (e.g. from Today's job-tap), workResetKey stays the same
    // so the intended drawer-open still fires.
    if (nextView === 'work') {
      setWorkResetKey(k => k + 1);
      // Also clear the pending job so a remounted WorkScreen has no pendingJobOpen.
      // JP-LU5 PR1: setPendingWorkView removed — calendar subview deleted.
      setPendingJobOpen(null);
      // A deliberate tab tap always shows the last-used/persisted stage filter —
      // never a stale stage override left over from an earlier Today card tap.
      setWorkStageOverride(null);
    }
  }, []);

  /** Handles every explicit BottomNav tab press. Resets transient UI, then navigates.
   *  Defined before conditional early returns to keep hook order stable (Rules of Hooks). */
  const handleTabChange = useCallback((nextView) => {
    resetTransientUI(nextView);
    // Settings same-tab re-tap: pop any sub-screen back to the Settings hub.
    // navigate() would no-op here (hash is already #/settings), so we signal
    // SettingsScreen via settingsResetKey instead of relying on a navigation event.
    if (nextView === 'settings' && view === 'settings') {
      setSettingsSubView(null);
      setSettingsResetKey(k => k + 1);
      return;
    }
    // Reset settings sub-view when navigating away from the settings tab so
    // CardPaymentsScreen doesn't persist on the next visit to Settings.
    if (nextView !== 'settings') setSettingsSubView(null);
    navigate(nextView);
  }, [resetTransientUI, navigate, view]);

  /**
   * "See the week" — navigates to the Jobs tab (card view only since JP-LU5 PR1).
   * JP-LU5 PR1: pendingWorkView / calendar forced-view removed; now a plain navigate.
   * `stage` is optional — when a Today card/banner knows exactly which stage
   * it's pointing at (e.g. "£X overdue" → Overdue), pass it so WorkScreen lands
   * on that stage instead of restoring whatever was last persisted. Omit it
   * for generic "go to Jobs" taps (e.g. the all-clear card).
   * Defined before conditional early returns (Rules of Hooks).
   */
  const handleSeeTheWeek = useCallback((stage) => {
    if (stage) {
      setWorkStageOverride({ stage, nonce: Date.now() });
    }
    navigate('work');
  }, [navigate]);

  if (!authReady || !splashMinElapsed) {
    return <Splash />;
  }
  if (!session) {
    // No <ConsentBanner/> is mounted here (it's mounted later, post-auth, below).
    // That's lawful ONLY because analytics stay consent-gated/off by default —
    // anyone enabling analytics or marketing scripts on this landing page must
    // mount ConsentBanner in front of this gate first.
    return <AuthScreen />;
  }

  const avatarProps = { session, profile, onClick: () => setDrawerOpen(true) };

  // Wizard open handler — shared across all nav modes that support it
  const openWizardFromSettings = () => {
    sessionStorage.setItem('jp.wizardActive', '1');
    setWizardOpen(true);
  };

  // Any overlay being open must disable BOTH the horizontal swipe pager AND
  // pull-to-refresh, so a mis-gesture behind a modal never navigates away or
  // triggers a background refresh mid-interaction. The swipe pager ALSO checks
  // body.overlay-open at gesture-start (useDashboardPager) as a backstop, but
  // pull-to-refresh does NOT read the body class at all — so every drawer/modal
  // flag must be represented here or PTR stays armed on the page behind it.
  // Includes workOverlayOpen (JobDetailDrawer / RecordPaymentModal). (A shared,
  // refcounted body-overlay lock across all sheets is a tracked follow-up; this
  // covers the AppShell-state flags at the React layer.)
  const anyOverlayOpen = !!(
    wizardOpen ||
    materialsOpen ||
    addMaterialOpen ||
    pendingLink ||
    costSnackbarJob ||
    trialEndSheetOpen ||
    dropToFreeOpen ||
    proRevealOpen ||
    moneyExportSheetOpen ||
    pushPromptVisible ||
    paidCelebrationAmount !== null ||
    // QA must-fix #1: postPaidJob is tracked unconditionally (not ANDed with
    // paidCelebrationAmount === null) so the pager stays locked during the full
    // PaidCelebration → PostPaidSheet sequence.
    postPaidJob !== null ||
    addJobPrefill !== null ||
    // JobDetailDrawer / RecordPaymentModal on-screen. Previously omitted (the
    // pager's body.overlay-open backstop covered the drawer for swipe), which
    // left pull-to-refresh armed behind the open drawer.
    workOverlayOpen
  );

  // Page index for the pager. -1 when view is 'settings' (pager not rendered).
  const pageIdx = dashboardPageIndex(view);

  return (
    <AppErrorBoundary variant="app">
      {/* Splash exit overlay — flies the lockup into the header, then unmounts. */}
      {!splashGone && <Splash exiting />}
      <ConsentBanner />

      {/* ── 3-page horizontal swipe pager (Today / Jobs / Money) ──────────── */}
      {/* Rendered whenever we are on a dashboard view (pageIdx >= 0).         */}
      {/* Settings unmounts the pager entirely — no layering complexity.       */}
      {pageIdx >= 0 && (
        <DashboardPager
          pageIndex={pageIdx}
          onSwipe={(nextIdx) => navigate(DASHBOARD_VIEWS[nextIdx])}
          overlayOpen={anyOverlayOpen}
          // Pull-to-refresh re-fires the same cloud sync as the realtime/
          // visibilitychange paths above — no new sync logic, just a manual
          // trigger. Omitted (PTR disabled) when signed out — there's no
          // cloud to pull from, only the local view.
          onPullToRefresh={session ? refreshFromCloud : undefined}
        >
          {/* Page 0 — Today */}
          <AppErrorBoundary variant="screen" screen="today">
            <TodayScreen
              onChase={() => navigate('finance')}
              onMarkPaid={onMarkPaidFromToday}
              onJobTap={(job) => { openJob(job?.id); navigate('work'); }}
              jobs={jobs}
              receipts={receipts}
              onAddJob={handleAddJob}
              onUpdateJob={onUpdateJob}
              onAddReceipt={handleAddReceipt}
              avatarProps={avatarProps}
              profile={profile}
              onProfileUpdate={handleProfileUpdate}
              onNavigateToMoney={() => navigate('finance')}
              onSeeTheWeek={handleSeeTheWeek}
              onNavigateToCardPayments={() => { navigate('settings'); setSettingsSubView('card-payments'); }}
              materials={materials}
              defaultMarkup={profile?.default_markup ?? 20}
              onBrowseMaterials={() => setMaterialsOpen(true)}
              onMaterialSaved={handleMaterialSaved}
              onSnackbar={snackbarEnqueue}
              onSnackbarDismiss={snackbarDismiss}
              onLoadSampleData={handleLoadSampleData}
            />
          </AppErrorBoundary>

          {/* Page 1 — Jobs/Work */}
          <AppErrorBoundary variant="screen" screen="jobs">
            <WorkScreen
              key={workResetKey}
              jobs={jobs}
              receipts={receipts}
              onNewJob={openDetailed}
              onAddJob={handleAddJob}
              onAddPayment={onAddPayment}
              onUpdateJob={onUpdateJob}
              onDeleteJob={onDeleteJob}
              onAddReceipt={handleAddReceipt}
              onDeleteReceipt={handleDeleteReceipt}
              onUpdateReceipt={handleUpdateReceipt}
              biz={null}
              profile={profile}
              pendingJobOpen={pendingJobOpen}
              onPendingJobOpenConsumed={() => setPendingJobOpen(null)}
              stageOverride={workStageOverride}
              onNavigateToCardPayments={() => { navigate('settings'); setSettingsSubView('card-payments'); }}
              onProfileUpdate={handleProfileUpdate}
              materials={materials}
              defaultMarkup={profile?.default_markup ?? 20}
              onBrowseMaterials={() => setMaterialsOpen(true)}
              onMaterialSaved={handleMaterialSaved}
              onOverlayChange={setWorkOverlayOpen}
              onClearSampleData={handleClearSampleData}
            />
          </AppErrorBoundary>

          {/* Page 2 — Money/Finance */}
          <AppErrorBoundary variant="screen" screen="finance">
            <FinanceScreen
              jobs={jobs}
              receipts={receipts}
              session={session}
              profile={profile}
              onGoToJobs={(stage) => {
                if (stage) setWorkStageOverride({ stage, nonce: Date.now() });
                navigate('work');
              }}
              onGoToSettings={(target) => {
                navigate('settings');
                if (target === 'overheads') setSettingsScrollTarget('overheads');
              }}
              onNavigateToCardPayments={() => { navigate('settings'); setSettingsSubView('card-payments'); }}
              onProfileUpdate={handleProfileUpdate}
              onExport={handleExportFromMoney}
              isActive={view === 'finance'}
            />
          </AppErrorBoundary>
        </DashboardPager>
      )}

      {/* ── Settings (outside the pager — no swipe navigation within Settings) */}
      {view === 'settings' && settingsSubView === 'card-payments' && (
        <CardPaymentsScreen
          profile={profile}
          onBack={() => {
            // Lands one level up (Settings → Get paid), not two (the hub) —
            // SettingsScreen genuinely remounts on 'hub' here since
            // CardPaymentsScreen is an AppShell-level sibling, not nested
            // inside SettingsScreen's own back-stack (button-audit fix).
            setSettingsSubView(null);
            setSettingsScrollTarget('getpaid');
          }}
          onProfileUpdate={(patch) => {
            // Optimistically update local profile state so the screen flips
            // immediately; the authoritative update comes from the next
            // refreshProfile call (which happens automatically on next sign-in
            // or can be triggered by the parent).
            setProfile(prev => prev ? { ...prev, ...patch } : prev);
          }}
        />
      )}

      {view === 'settings' && settingsSubView !== 'card-payments' && (
        <SettingsScreen
          session={session}
          profile={profile}
          jobs={jobs}
          receipts={receipts}
          onSignOut={handleSignOut}
          onOpenWizard={openWizardFromSettings}
          onProfileUpdate={handleProfileUpdate}
          onNavigateToCardPayments={() => setSettingsSubView('card-payments')}
          onBrowseMaterials={() => setMaterialsOpen(true)}
          onOpenJob={(jobId) => {
            openJob(jobId);
            navigate('work');
          }}
          scrollTarget={settingsScrollTarget}
          onScrollTargetConsumed={() => setSettingsScrollTarget(null)}
          settingsResetKey={settingsResetKey}
          onLoadSampleData={handleLoadSampleData}
          onClearSampleData={handleClearSampleData}
        />
      )}

      <BottomNav
        view={view}
        onChange={handleTabChange}
        workBadge={buildChaseList(Array.isArray(jobs) ? jobs : []).filter(row => !isDoubleSendBlocked(row.id)).length}
        financeBadge={buildChaseList(Array.isArray(jobs) ? jobs : []).filter(row => !isDoubleSendBlocked(row.id)).length}
      />


      {/* ── Push permission prompt (shown once per device, 5 s after sign-in) ── */}
      {/* Non-blocking: sits at the bottom above the nav, never blocks content.  */}
      {/* iOS: only shown when app is installed to Home Screen (Safari 16.4+).   */}
      {pushPromptVisible && (
        <div className="push-prompt" role="dialog" aria-label="Enable notifications">
          <p className="push-prompt-text">
            Get a buzz when a customer signs your quote?
          </p>
          <div className="push-prompt-actions">
            <button
              className="push-prompt-enable"
              onClick={handleEnablePush}
              type="button"
            >
              Enable notifications
            </button>
            <button
              className="push-prompt-dismiss"
              onClick={handleDismissPush}
              type="button"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* ── Offline sync badge — shown when IndexedDB queue has pending rows ── */}
      <SyncBadge onSignIn={handleSyncSignIn} />

      {/* ── Unified snackbar manager (JP-LU2) ─────────────────────────── */}
      {/* Single renderer for nav/toast/realtime/cost/nudge/got-paid.     */}
      {/* The old navToast, realtimeToast, costSnackbar surfaces are gone; */}
      {/* TodayScreen's toast/gotPaid/payNowNudge are now here too.        */}
      <Snackbar
        active={snackbarActive}
        onDismiss={(id) => snackbarDismiss(id)}
        onTap={(descriptor) => {
          if (descriptor.jobId) {
            openJob(descriptor.jobId);
            navigate('work');
          }
        }}
        onExpandCost={(descriptor) => {
          snackbarDismiss(descriptor.id);
          setCostSnackbarJob(prev => prev ?? { job: descriptor.job, jobCostTotal: descriptor.jobCostTotal ?? 0 });
        }}
        onCostDismiss={() => {
          const { shouldAutoMute } = recordDismissal();
          if (shouldAutoMute) handleProfileUpdate({ remind_job_costs: false });
          setCostSnackbarJob(null);
        }}
        onSetupPayNow={() => { navigate('settings'); setSettingsSubView('card-payments'); }}
        onGotPaidChip={(job, method) => {
          if (job) onMarkPaidFromToday(job, method);
        }}
      />

      {/* ── Expanded cost-capture modal (from Snackbar "+ Add cost" tap) ── */}
      {/* Payment is already recorded; this is a secondary, skippable modal. */}
      {costSnackbarJob && (
        <div className="modal-backdrop" onClick={() => setCostSnackbarJob(null)}>
          <div className="modal modal--paid-success" onClick={e => e.stopPropagation()}>
            <div className="modal-paid-badge">
              <Icon name="paid" size={24} variant="success" className="modal-paid-check" />
              <span className="modal-paid-label">Paid</span>
            </div>
            <PostPaidCostRow
              job={costSnackbarJob.job}
              jobCostTotal={costSnackbarJob.jobCostTotal ?? 0}
              variant={costPromptVariant(costSnackbarJob.jobCostTotal ?? 0)}
              onSave={handleAddReceipt}
              onSkip={() => setCostSnackbarJob(null)}
              onAutoMute={() => {
                setCostSnackbarJob(null);
                handleProfileUpdate({ remind_job_costs: false });
              }}
            />
          </div>
        </div>
      )}

      {pendingLink && (
        <LinkReceiptModal
          receipt={pendingLink}
          jobs={jobs}
          onLink={handleLinkReceipt}
          onSkip={() => setPendingLink(null)}
        />
      )}

      {/* ── Day-14 trial-end sheet (Moment 1) ─────────────────────────── */}
      {/* Shown once on first app-open when trial has <= 24h left.        */}
      {/* "Not now" gates per-day; upgrade redirects to Stripe.           */}
      <ProUpgradeSheet
        open={trialEndSheetOpen}
        variant="trial_end"
        trigger="trial_end"
        profile={profile}
        jobs={jobs}
        onClose={handleTrialEndSheetDismiss}
      />

      {/* ── "You've got Pro" reveal (comprehension fix) ───────────────── */}
      {/* Shown once, ever, per device: right after onboarding completes  */}
      {/* (wired via OnboardingWizard.onComplete below) or on first Today  */}
      {/* load for wizard-skippers (refreshProfile). Single "Show me" CTA  */}
      {/* — dismissing IS the acknowledgement, so it always marks seen.    */}
      <ProUpgradeSheet
        open={proRevealOpen}
        variant="pro_reveal"
        trigger="pro_reveal"
        onClose={handleProRevealDismiss}
      />

      {/* ── Drop-to-free screen (Moment 2) — honesty fix ──────────────── */}
      {/* Shown BEFORE plan is flipped on first post-expiry open.         */}
      {/* Closing this screen triggers the plan flip + mark-seen.         */}
      {dropToFreeOpen && (
        <DropToFreeScreen
          onDismiss={handleDropToFreeDismiss}
          onUpgrade={handleDropToFreeUpgrade}
          upgradeLoading={dropToFreeUpgradeLoading}
          upgradeError={dropToFreeUpgradeError}
        />
      )}

      {/* ── Day-~43 pre-charge reminder banner ─────────────────────────── */}
      {/* Shown in-app within 5 days of the Moment-1 charge date.          */}
      {/* Push/email delivery is STUBBED — see PreChargeReminderBanner.jsx  */}
      {preChargeReminderVisible && profile && (
        <PreChargeReminderBanner
          chargeDate={formatChargeDate(profile.trial_ends_at)}
          onKeep={async () => {
            setPreChargeReminderVisible(false);
            const { error } = await openBillingPortal();
            if (error) console.warn('billing portal error', error);
          }}
          onCancel={async () => {
            setPreChargeReminderVisible(false);
            const { error } = await openBillingPortal();
            if (error) console.warn('billing portal error', error);
          }}
          onDismiss={() => setPreChargeReminderVisible(false)}
        />
      )}

      {/* ── Onboarding wizard (opened on demand from Settings) ─────────── */}
      {wizardOpen && (
        <OnboardingWizard
          session={session}
          profile={profile}
          onComplete={(savedProfile) => {
            setProfile(savedProfile);
            setWizardOpen(false);
            sessionStorage.removeItem('jp.wizardActive');
            // "You've got Pro" reveal — fires immediately here (before Today
            // paints) when the wizard path completes on an active trial that
            // hasn't seen it yet. The refreshProfile fallback below covers
            // wizard-skippers; this covers the (less common) explicit-wizard path.
            if (shouldShowProReveal(savedProfile, session?.user?.id)) {
              setProRevealOpen(true);
            }
          }}
        />
      )}

      {/* ── Materials library full-screen overlay ────────────────────────── */}
      {/* Sits above all other content; opened from type-ahead "Browse all".  */}
      {materialsOpen && (
        <MaterialsScreen
          materials={materials}
          defaultMarkup={profile?.default_markup ?? 20}
          onClose={() => setMaterialsOpen(false)}
          onAdd={() => { setEditingMaterial(null); setAddMaterialOpen(true); }}
          onArchive={handleArchiveMaterial}
          onEdit={(m) => { setEditingMaterial(m); setAddMaterialOpen(true); }}
        />
      )}

      {/* ── Add / edit material modal ─────────────────────────────────────── */}
      {addMaterialOpen && (
        <AddMaterialModal
          onClose={() => { setAddMaterialOpen(false); setEditingMaterial(null); }}
          onSave={handleSaveMaterial}
          existingMaterial={editingMaterial}
          defaultMarkup={profile?.default_markup ?? 20}
        />
      )}

      {/* ── Money tab — export format sheet ──────────────────────────────────── */}
      <ExportFormatSheet
        open={moneyExportSheetOpen}
        title="Export for your accountant"
        subtitle="Pick a format. All three download straight to your phone."
        options={[
          {
            id: 'csv',
            icon: 'bar-chart',
            label: 'Spreadsheet (CSV)',
            sublabel: 'For your accountant or Excel',
          },
          {
            id: 'xlsx',
            icon: 'file-spreadsheet',
            label: 'Excel (.xlsx)',
            sublabel: 'Opens in Excel or Google Sheets',
          },
          {
            id: 'pdf',
            icon: 'pdf',
            label: 'PDF summary',
            sublabel: 'A clean sheet you can send',
          },
          {
            id: 'xero',
            icon: 'external-link',
            label: 'Xero-ready file',
            sublabel: 'Sales invoices + bills, ready to import',
            locked: !isPro(profile),
          },
          {
            id: 'quickbooks',
            icon: 'external-link',
            label: 'QuickBooks-ready file',
            sublabel: 'Invoices + expenses, ready to import',
            locked: !isPro(profile),
          },
        ]}
        onPick={handleMoneyExportFormatPick}
        onClose={() => setMoneyExportSheetOpen(false)}
      />

      {/* ── Money tab — Xero/QuickBooks period picker (Pro only) ─────────────── */}
      <AccountantExportRangeSheet
        open={accountantExportSheetOpen}
        platform={accountantExportPlatform}
        generating={accountantExporting}
        onGenerate={handleAccountantExportGenerate}
        onClose={() => { setAccountantExportSheetOpen(false); setAccountantExportPlatform(null); }}
      />

      {/* ── Locked Xero/QuickBooks tile tapped by a non-Pro user ─────────────── */}
      <ProUpgradeSheet
        open={accountantExportUpgradeOpen}
        trigger={UPGRADE_TRIGGERS.ACCOUNTANT_EXPORT}
        profile={profile}
        jobs={jobs}
        onClose={() => setAccountantExportUpgradeOpen(false)}
      />

      {/* ── Paid celebration overlay (shared across all mark-paid entry points) ── */}
      {/* Triggered by onMarkPaidFromToday and onAddPayment when balance clears.   */}
      {/* Haptic('success') fires alongside it in each trigger site.               */}
      <PaidCelebration
        active={paidCelebrationAmount !== null}
        amount={paidCelebrationAmount}
        onDone={() => setPaidCelebrationAmount(null)}
      />

      {/* ── Post-paid "What's next?" sheet ────────────────────────────────────── */}
      {/* Shows after PaidCelebration auto-dismisses (~1.3s). Suppressed while the */}
      {/* JobDetailDrawer / RecordPaymentModal is still on-screen (Option A).      */}
      <PostPaidSheet
        active={postPaidJob !== null && paidCelebrationAmount === null && !workOverlayOpen}
        job={postPaidJob}
        profile={profile}
        onClose={() => setPostPaidJob(null)}
        onBookAgain={(p) => { setPostPaidJob(null); setAddJobPrefill(p); }}
        onGoToReviewSettings={() => {
          setPostPaidJob(null);
          navigate('settings');
          setSettingsScrollTarget('invoices');
        }}
        onReviewSent={() => postPaidJob && logComms(postPaidJob, 'review', onUpdateJob)}
      />

      {/* ── Re-book AddJobModal (opened from PostPaidSheet "Book again" CTA) ───── */}
      {/* Pre-fills customer/phone/address from the just-paid job.                  */}
      {/* Date and amount are intentionally blank — re-books start fresh.           */}
      {addJobPrefill && (
        <AddJobModal
          onClose={() => setAddJobPrefill(null)}
          onSave={async (j) => { await handleAddJob(j); setAddJobPrefill(null); }}
          onSaveAndSend={async (payload) => {
            // Save the job, close this modal, then land the trader on the new
            // job's drawer (same pendingJobOpen mechanism as onJobTap/onOpenJob
            // elsewhere in AppShell) — a real Send Invoice/quote entry point
            // lives there. Previously this saved silently with zero signal
            // that "send" hadn't actually happened (button-audit fix).
            await handleAddJob(payload);
            setAddJobPrefill(null);
            openJob(payload?.id);
            navigate('work');
          }}
          defaultMode="details-manual"
          initialCustomer={addJobPrefill.customer || ''}
          initialPhone={addJobPrefill.phone || ''}
          initialAddress={addJobPrefill.address || ''}
          // The re-book flow is short (pre-filled, no voice) and shares no UI
          // with the "Resume your quote?" banner on Today — scoping autosave
          // out here avoids two independent AddJobModal instances contending
          // for the single draft slot. Fast-follow if re-books turn out to
          // need the same crash-safety net.
          enableAutosave={false}
          tradePrimary={profile?.trade_primary ?? null}
          materials={materials}
          defaultMarkup={profile?.default_markup ?? 20}
          onBrowseMaterials={() => setMaterialsOpen(true)}
          onMaterialSaved={handleMaterialSaved}
        />
      )}
    </AppErrorBoundary>
  );
}
