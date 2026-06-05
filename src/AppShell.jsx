import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useKeyboardInset } from './lib/useKeyboardInset.js';
import {
  shouldShowCostPrompt,
  costPromptVariant,
  recordPromptShown,
  recordDismissal,
} from './lib/postPaidCost';
import PostPaidCostRow from './components/PostPaidCostRow';
// Lazy-loaded: App.jsx is only reachable via the debug escape-hatch
// (localStorage.jp.navSlice3='0'). Keeping it out of the critical-path bundle
// prevents App.jsx + its xlsx dependency from loading for every user.
const App = lazy(() => import('./App.jsx'));
import CardPaymentsScreen from './screens/CardPaymentsScreen.jsx';
import {
  isPushSupported,
  getSubscriptionStatus,
  subscribe as pushSubscribe,
} from './lib/pushSubscribe.js';
import TodayScreen from './screens/TodayScreen';
import HistoryScreen from './screens/HistoryScreen';
import ScheduleScreen from './screens/ScheduleScreen';
import FinanceScreen from './screens/FinanceScreen';
import WorkScreen from './screens/WorkScreen';
import SettingsScreen from './screens/SettingsScreen';
import OnboardingWizard from './screens/OnboardingWizard';
import BottomNav from './components/BottomNav';
import HeaderAvatar from './components/HeaderAvatar';
import AccountDrawer from './components/AccountDrawer';
import LinkReceiptModal from './components/LinkReceiptModal';
import { startHidingLegacyDupes, stopHidingLegacyDupes } from './lib/hideLegacyDupes';
import { startHidingLegacyWrites, stopHidingLegacyWrites } from './lib/hideLegacyWrites';
import { clickCreateDetailedJobTab } from './lib/manageDeepLink';
import { supabase } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
import { parseHash, navigateToView, replaceHistory, TOP_VIEWS } from './lib/navigation';
import { writeJobMeta, extractJobMeta, applyJobMetaToJobs } from './lib/jobMeta';
import { subscribeToJobs } from './lib/realtime';
import { addPayment } from './lib/payments';
import {
  getTodayJobs,
  getTodayReceipts,
  addTodayJob,
  addTodayReceipt,
  markJobPaid,
  getJobsFromCloud,
  getReceiptsFromCloud,
  addJobToCloud,
  addReceiptToCloud,
  markJobPaidCloud,
  linkReceiptToJob,
  deleteReceiptFromCloud,
  updateJobMetaInCloud,
} from './lib/store';
import { flipExpiredTrialToFree } from './lib/plan';
import { enqueueJob, wireOnlineSync } from './lib/offlineQueue';
import { logTelemetry, identifyUser } from './lib/telemetry';
import posthog from 'posthog-js';
import SyncBadge from './components/SyncBadge';
import ConsentBanner from './components/ConsentBanner.jsx';
import Icon from './components/Icon.jsx';

// ─── Feature flags ───────────────────────────────────────────────────────────
// Slice-3 nav (Today / Jobs / Money / Settings) is the default for all users.
// Escape hatch to fall back to legacy nav (debugging only):
//   localStorage.setItem('jp.navSlice3', '0'); location.reload();
// Legacy 4-tab newNav remains opt-in:
//   localStorage.setItem('jp.newNav', '1'); location.reload();
const NEW_NAV        = localStorage.getItem('jp.newNav')        === '1';
const NAV_SLICE_3    = localStorage.getItem('jp.navSlice3')    !== '0';

// View IDs recognised by each nav mode.
// SLICE_3_VIEWS mirrors NEW_NAV_VIEWS but uses 'work'/'finance'/'settings'.
const NEW_NAV_VIEWS  = ['today', 'jobs', 'schedule', 'money'];
const SLICE_3_VIEWS  = ['today', 'work', 'finance', 'settings'];

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
  if (NAV_SLICE_3) {
    // Read the hash directly so slice-3 view names ('work', 'finance', 'settings')
    // are not filtered out by parseHash(), which only knows legacy TOP_VIEWS.
    const raw = window.location.hash.replace(/^#\/?/, '').split('/')[0];
    // Map legacy deep-link aliases that may still appear in the wild
    if (raw === 'jobs' || raw === 'schedule') return 'work';
    if (raw === 'money') return 'finance';
    return SLICE_3_VIEWS.includes(raw) ? raw : 'today';
  }
  const { view } = parseHash();
  if (NEW_NAV) {
    // Accept new-nav view names; map unknown ones to 'today'
    return NEW_NAV_VIEWS.includes(view) ? view : 'today';
  }
  return view;
}

export default function AppShell() {
  // Write --kb-inset CSS variable whenever the on-screen keyboard opens/closes.
  // All bottom-sheet modals read this variable via padding-bottom on .modal-backdrop
  // so they float above the keypad without any per-modal code.
  useKeyboardInset();

  const [view, setView] = useState(() => parseViewFromHash());
  const [moreKey, setMoreKey] = useState(0);
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
  const [jobs, setJobs] = useState(() => getTodayJobs());
  const [receipts, setReceipts] = useState(() => getTodayReceipts());
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [pendingLink, setPendingLink] = useState(null); // receipt awaiting job link
  const [drawerOpen, setDrawerOpen] = useState(false);
  // First-open toast for users seeing the new nav for the first time
  const [navToast, setNavToast] = useState(null);
  // Realtime event toast — shape: { message: string, jobId: string|null } | null
  // jobId lets the trader tap the toast to jump straight to that job.
  const [realtimeToast, setRealtimeToast] = useState(null);
  // Post-paid cost snackbar — shown after Today quick mark-paid.
  // null = hidden; { job } = visible for that job.
  const [costSnackbar, setCostSnackbar] = useState(null);
  const costSnackbarTimerRef = useRef(null);
  // Ref holding the most recent jobs array so the Realtime handler can compare
  // previous acceptedSignature state without a stale closure.
  const jobsRef = useRef([]);
  // Wizard state (new nav only).
  // wizardOpen — should the wizard overlay be showing right now?
  // postWizardNav — view to navigate to after the wizard completes (e.g. 'jobs').
  const [wizardOpen, setWizardOpen] = useState(false);
  const [postWizardNav, setPostWizardNav] = useState(null);
  // Push permission prompt: show once per device, dismiss stored in localStorage
  const [pushPromptVisible, setPushPromptVisible] = useState(false);
  // pendingJobId: when Today navigates to Work with a specific job to open, store
  // the job ID here so WorkScreen can pre-open the drawer on mount.
  const [pendingJobId, setPendingJobId] = useState(null);
  // workResetKey: bumped on every explicit tab-click to the work/jobs tab.
  // WorkScreen receives this as its React key, which causes a full remount and
  // therefore discards any open drawer or modal state. Programmatic navigation
  // from Today (onJobTap) does NOT bump this key — the drawer-open path must
  // survive. Only the BottomNav onChange handler bumps it.
  const [workResetKey, setWorkResetKey] = useState(0);

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
        if (params.has('upgraded')) {
          logTelemetry('upgrade_succeeded', { plan: 'pro' });
          const clean = window.location.pathname + window.location.hash;
          window.history.replaceState(null, '', clean);
        }
      }
      return null;
    }
  );

  const manageRootRef = useRef(null);

  // settingsScrollTarget: when FinanceScreen's "Add your costs" nudge fires,
  // navigate to Settings AND tell SettingsScreen to scroll to the overheads
  // section. Cleared by SettingsScreen via onScrollTargetConsumed once it has
  // scrolled. Null = no pending scroll.
  // NOTE: the section naming/structure is pending PRD's overheads redesign —
  // do not rename 'overheads' here until that spec lands.
  const [settingsScrollTarget, setSettingsScrollTarget] = useState(null);

  // Hash-routed navigation: pushes history before switching view so browser
  // Back returns to the previous in-app screen instead of exiting the SPA.
  const navigate = useCallback((nextView) => {
    // navigateToView only knows legacy TOP_VIEWS; for new-nav / slice-3 tabs
    // we push the hash directly so Back still works.
    if (NEW_NAV || NAV_SLICE_3) {
      const hash = `#/${nextView}`;
      if (window.location.hash !== hash) {
        window.history.pushState({ view: nextView }, '', hash);
      }
    } else {
      navigateToView(nextView);
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
  // ready, sets pendingJobId, navigates to Work, then cleans the URL.
  useEffect(() => {
    if (!authReady) return;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job');
    if (jobId) {
      setPendingJobId(jobId);
      navigate('work');
      // Strip the ?job= param from the URL so Back/refresh doesn't re-trigger
      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', clean);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  // Single popstate listener: re-derive view from hash on Back/Forward.
  // Do NOT bump moreKey here — App.jsx state must survive a Back navigation.
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

  const refreshFromCloud = useCallback(async () => {
    try {
      const [cloudJobs, cloudReceipts] = await Promise.all([
        getJobsFromCloud(),
        getReceiptsFromCloud(),
      ]);
      setJobs(applyJobMetaToJobs(cloudJobs));
      setReceipts(cloudReceipts);
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
        // If the trial has expired, flip plan to 'free' in the DB so the row
        // stays clean. Fire-and-forget — never blocks render, never throws.
        flipExpiredTrialToFree(supabase, userId, data);

        // Identify the user in PostHog (PII-light: UUID + plan only, no email).
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
        // Reset PostHog identity so the next sign-in gets a clean anonymous profile.
        try { posthog.reset(); } catch { /* PostHog not initialised or blocked — silently no-op */ }
      }
      // Funnel step 3: signed_in — fires on every SIGNED_IN event.
      // is_new_user = true when created_at is within the last 60 s, meaning this
      // is their first ever sign-in rather than a returning login. 60 s gives
      // enough headroom for slow email delivery + link tap without false positives.
      // sign_up is kept alongside it for backward-compat with existing dashboards.
      if (_event === 'SIGNED_IN' && newSession?.user) {
        const createdAt = new Date(newSession.user.created_at ?? 0).getTime();
        const isNew = Date.now() - createdAt < 60_000;
        logTelemetry('signed_in', { is_new_user: isNew });
        if (isNew) logTelemetry('sign_up', { plan: 'free' });
      }
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    wipeLegacyDemoData();
    migrateLegacyTodayData();
    if (session) {
      refreshFromCloud();
      refreshProfile(session.user.id);
    }
  }, [session, refreshFromCloud, refreshProfile]);

  // Register service worker for PWA (required for push and offline caching).
  // Located here (AppShell) so it fires on every authenticated session, not just
  // inside the legacy App.jsx monolith. Safe to call multiple times — the browser
  // deduplicates registrations to the same script URL.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('SW registration failed', err?.message);
      });
    }
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

      // Wait 5 s after sign-in before showing — give the user time to orient
      const t = setTimeout(() => {
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
      // Detect remote signature: compare previous job state (from ref) to the
      // incoming change. Only fire a toast when:
      //   1. The event is an UPDATE
      //   2. The changed row has acceptedSignature set
      //   3. The previous in-memory version for that row had no acceptedSignature
      //   4. acceptedSource is 'remote' (written by the Phase G-2 Netlify function)
      if (payload.eventType === 'UPDATE' && payload.new) {
        const incoming = payload.new;
        const incomingMeta = (incoming.meta && typeof incoming.meta === 'object') ? incoming.meta : {};
        const hasRemoteSig = incomingMeta.acceptedSignature && incomingMeta.acceptedSource === 'remote';

        if (hasRemoteSig) {
          const prev = jobsRef.current.find(j => j.id === incoming.id);
          const prevHadSig = !!(prev?.acceptedSignature);
          if (!prevHadSig) {
            const customerName = incomingMeta.acceptedName || incoming.customer_name || prev?.customer || prev?.name || 'Customer';
            const amount = Number(prev?.total ?? prev?.amount ?? incomingMeta.total ?? 0) || 0;
            const amountStr = amount > 0
              ? ` · £${amount.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`
              : '';
            setRealtimeToast({
              message: `${customerName} accepted your quote${amountStr}`,
              jobId: incoming.id || null,
            });
            const t = setTimeout(() => setRealtimeToast(null), 8000);
            void t;
          }
        }
      }

      // Refetch regardless of event type — keeps all state in sync.
      await refreshFromCloud();
    };

    const unsub = subscribeToJobs(
      userId,
      handleJobChange,
      // onReconnect: immediate refetch to catch events missed during disconnect.
      () => { refreshFromCloud(); }
    );

    return () => { unsub(); };
  }, [session, refreshFromCloud]);

  useEffect(() => {
    const legacyRefreshViews = (NEW_NAV || NAV_SLICE_3) ? ['today'] : ['today', 'history'];
    if (legacyRefreshViews.includes(view)) refreshLocal();

    if (!NEW_NAV && view === 'manage' && manageRootRef.current) {
      startHidingLegacyDupes(manageRootRef.current);
      startHidingLegacyWrites(manageRootRef.current);
      if (pendingDeepLink === 'create-detailed-job') {
        setTimeout(() => clickCreateDetailedJobTab(manageRootRef.current), 100);
        setPendingDeepLink(null);
      }
    } else {
      stopHidingLegacyDupes();
      stopHidingLegacyWrites();
    }
  }, [view, refreshLocal, pendingDeepLink]);

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

  // Show a one-time orientation toast when a nav mode first activates
  useEffect(() => {
    if (NAV_SLICE_3) {
      const toastKey = 'jp.slice3NavToast.v2';
      if (localStorage.getItem(toastKey)) return;
      setNavToast("Your new nav: Jobs for your work, Money for your finances, Settings for your account.");
      localStorage.setItem(toastKey, '1');
      const t = setTimeout(() => setNavToast(null), 6000);
      return () => clearTimeout(t);
    }
    if (NEW_NAV) {
      const toastKey = 'jp.newNavToast.v1';
      if (localStorage.getItem(toastKey)) return;
      setNavToast("Business is now Jobs, Schedule, and Money. Settings is top-right.");
      localStorage.setItem(toastKey, '1');
      const t = setTimeout(() => setNavToast(null), 6000);
      return () => clearTimeout(t);
    }
  }, []);

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
      console.error('Add job failed — queuing for offline sync', e);
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

  const handleDeleteReceipt = async (receiptId) => {
    try {
      await deleteReceiptFromCloud(receiptId);
      await refreshFromCloud();
    } catch (e) {
      console.error('Delete receipt failed', e);
      // Optimistic local removal so the UI updates even if cloud fails
      setReceipts(prev => prev.filter(r => r.id !== receiptId && r.cloudId !== receiptId));
    }
  };

  const handleMarkPaid = async (id) => {
    logTelemetry('mark_paid', { source: 'history' });
    try {
      await markJobPaidCloud(id);
      await refreshFromCloud();
    } catch (e) {
      console.error('Mark paid failed', e);
      markJobPaid(id);
      setJobs(applyJobMetaToJobs(getTodayJobs()));
    }
  };

  // Fires the cloud write after every writeJobMeta call. Fire-and-forget —
  // the UI does not await this. localStorage write already succeeded by the
  // time this runs. Errors are logged; they do not surface to the user because
  // the local state is already correct.
  const syncMetaToCloud = (jobId, mergedMeta) => {
    if (!jobId || !mergedMeta) return;
    updateJobMetaInCloud(jobId, mergedMeta).catch((err) => {
      console.warn('syncMetaToCloud failed', jobId, err?.message);
    });
  };

  // Mark-paid from the new Today awaiting section. Writes the new payment fields
  // into the jobMeta side-channel, then fires the cloud write async.
  const onMarkPaidFromToday = (job, method) => {
    logTelemetry('mark_paid', { source: 'today', method: method ?? 'unknown' });
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
      if (costSnackbarTimerRef.current) clearTimeout(costSnackbarTimerRef.current);
      setCostSnackbar({ job, jobCostTotal });
      costSnackbarTimerRef.current = setTimeout(() => setCostSnackbar(null), 6000);
    }
  };

  // Partial-payment add (Phase B of partial-payments PRD). payments[] lives in
  // the jobMeta side-channel; addPayment handles validation + auto-flip rule.
  const onAddPayment = (job, payload) => {
    const updated = addPayment(job, payload);
    const merged = writeJobMeta(updated.id, extractJobMeta(updated));
    syncMetaToCloud(updated.id, merged);
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
  };

  // Generic job field update used by JobDetailDrawer and SendInvoiceModal.
  // Writes all meta fields (photos, notes, lineItems, invoice state, etc.)
  // to localStorage then fires a cloud write async.
  const onUpdateJob = (updated) => {
    const merged = writeJobMeta(updated.id, extractJobMeta(updated));
    syncMetaToCloud(updated.id, merged);
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
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

  const openDetailed = () => {
    // Profile-completeness gate removed (feat/zero-friction-entry, 2026-06-02).
    // Users can create jobs immediately after sign-in. Missing business/bank
    // details are collected just-in-time at the invoice-send step.
    setPendingDeepLink('create-detailed-job');
    setMoreKey(k => k + 1);
    // Slice 3: route to 'work'; New nav: 'jobs'; Legacy: 'manage'
    navigate(NAV_SLICE_3 ? 'work' : NEW_NAV ? 'jobs' : 'manage');
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
    // If the user taps the work/jobs tab directly, bump the reset key so
    // WorkScreen remounts and discards any open JobDetailDrawer. When navigating
    // programmatically (e.g. from Today's job-tap), workResetKey stays the same
    // so the intended drawer-open still fires.
    const workView = NAV_SLICE_3 ? 'work' : 'jobs';
    if (nextView === workView) {
      setWorkResetKey(k => k + 1);
      // Also clear the pending job so a remounted WorkScreen has no initialJobId.
      setPendingJobId(null);
    }
  }, []);

  /** Handles every explicit BottomNav tab press. Resets transient UI, then navigates.
   *  Defined before conditional early returns to keep hook order stable (Rules of Hooks). */
  const handleTabChange = useCallback((nextView) => {
    resetTransientUI(nextView);
    // Legacy manage tab still needs its moreKey bump.
    if (!NAV_SLICE_3 && !NEW_NAV && nextView === 'manage') setMoreKey(k => k + 1);
    // Reset settings sub-view when navigating away from the settings tab so
    // CardPaymentsScreen doesn't persist on the next visit to Settings.
    if (nextView !== 'settings') setSettingsSubView(null);
    navigate(nextView);
  }, [resetTransientUI, navigate]);

  if (!authReady) {
    return <div className="auth-loading"><div className="ocr-spinner" /></div>;
  }
  if (!session) {
    return <AuthScreen />;
  }

  const avatarProps = { session, profile, onClick: () => setDrawerOpen(true) };

  // Wizard open handler — shared across all nav modes that support it
  const openWizardFromSettings = () => {
    sessionStorage.setItem('jp.wizardActive', '1');
    setWizardOpen(true);
  };

  return (
    <>
      <ConsentBanner />
      {/* ── SLICE-3 NAV (Today / Jobs / Money / Settings) ───────────── */}
      {NAV_SLICE_3 && (
        <>
          {view === 'today' && (
            <TodayScreen
              onOpenDetailed={openDetailed}
              onChase={() => navigate('finance')}
              onMarkPaid={onMarkPaidFromToday}
              onJobTap={(job) => { if (job?.id) setPendingJobId(job.id); navigate('work'); }}
              jobs={jobs}
              receipts={receipts}
              onAddJob={handleAddJob}
              onUpdateJob={onUpdateJob}
              onAddReceipt={handleAddReceipt}
              avatarProps={avatarProps}
              profile={profile}
              onNavigateToMoney={() => navigate('finance')}
              onNavigateToCardPayments={() => setSettingsSubView('card-payments')}
            />
          )}

          {view === 'work' && (
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
              biz={null}
              profile={profile}
              initialJobId={pendingJobId}
              onNavigateToCardPayments={() => setSettingsSubView('card-payments')}
              onProfileUpdate={handleProfileUpdate}
            />
          )}

          {view === 'finance' && (
            <FinanceScreen
              jobs={jobs}
              receipts={receipts}
              session={session}
              profile={profile}
              // No avatar — Settings tab replaces the drawer in slice 3
              // onMarkPaid removed: chase block deleted in Phase 1 Money redesign
              onGoToJobs={() => navigate('work')}
              onGoToSettings={(target) => {
                navigate('settings');
                if (target === 'overheads') setSettingsScrollTarget('overheads');
              }}
              onNavigateToCardPayments={() => { navigate('settings'); setSettingsSubView('card-payments'); }}
              onProfileUpdate={handleProfileUpdate}
            />
          )}

          {view === 'settings' && settingsSubView === 'card-payments' && (
            <CardPaymentsScreen
              profile={profile}
              onBack={() => setSettingsSubView(null)}
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
              onOpenJob={(jobId) => {
                if (jobId) setPendingJobId(jobId);
                navigate('work');
              }}
              scrollTarget={settingsScrollTarget}
              onScrollTargetConsumed={() => setSettingsScrollTarget(null)}
            />
          )}

          {/* HeaderAvatar and AccountDrawer are NOT rendered when slice 3 is active.
              The Settings tab is the single account entry point. */}

          <BottomNav
            view={view}
            onChange={handleTabChange}
            slice3={true}
          />
        </>
      )}

      {/* ── NEW NAV (Today / Jobs / Schedule / Money) ────────────────── */}
      {!NAV_SLICE_3 && NEW_NAV && (
        <>
          {view === 'today' && (
            <TodayScreen
              onOpenDetailed={openDetailed}
              onChase={() => navigate('money')}
              onMarkPaid={onMarkPaidFromToday}
              onJobTap={(job) => { if (job?.id) setPendingJobId(job.id); navigate('jobs'); }}
              jobs={jobs}
              receipts={receipts}
              onAddJob={handleAddJob}
              onUpdateJob={onUpdateJob}
              onAddReceipt={handleAddReceipt}
              avatarProps={avatarProps}
              profile={profile}
              onNavigateToMoney={() => navigate('money')}
              onNavigateToCardPayments={() => setSettingsSubView('card-payments')}
            />
          )}

          {view === 'jobs' && (
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
              biz={null}
              profile={profile}
              initialJobId={pendingJobId}
              onNavigateToCardPayments={() => setSettingsSubView('card-payments')}
              onProfileUpdate={handleProfileUpdate}
            />
          )}

          {view === 'schedule' && (
            <ScheduleScreen
              jobs={jobs}
              session={session}
              profile={profile}
              onAvatarClick={() => setDrawerOpen(true)}
              onAddJob={openDetailed}
              onJobTap={(job) => {
                if (job?.id) setPendingJobId(job.id);
                navigate('work');
              }}
            />
          )}

          {view === 'money' && (
            <FinanceScreen
              jobs={jobs}
              receipts={receipts}
              session={session}
              profile={profile}
              onAvatarClick={() => setDrawerOpen(true)}
              // onMarkPaid removed: chase block deleted in Phase 1 Money redesign
              onGoToJobs={() => navigate('jobs')}
              // onGoToSettings omitted: new-nav has no dedicated settings tab
              onProfileUpdate={handleProfileUpdate}
            />
          )}

          <BottomNav
            view={view}
            onChange={handleTabChange}
            newNav={true}
          />
        </>
      )}

      {/* ── LEGACY NAV (unchanged) ────────────────────────────────────── */}
      {!NAV_SLICE_3 && !NEW_NAV && (
        <>
          {view === 'today' && (
            <TodayScreen
              onOpenDetailed={() => { setPendingDeepLink('create-detailed-job'); setMoreKey(k => k + 1); navigate('manage'); }}
              onChase={() => { setMoreKey(k => k + 1); navigate('manage'); }}
              onMarkPaid={onMarkPaidFromToday}
              onJobTap={() => navigate('manage')}
              jobs={jobs}
              receipts={receipts}
              onAddJob={handleAddJob}
              onUpdateJob={onUpdateJob}
              onAddReceipt={handleAddReceipt}
              profile={profile}
              onNavigateToMoney={() => { setMoreKey(k => k + 1); navigate('manage'); }}
              onNavigateToCardPayments={() => setSettingsSubView('card-payments')}
            />
          )}

          {view === 'history' && (
            <HistoryScreen
              jobs={jobs}
              receipts={receipts}
              onMarkPaid={handleMarkPaid}
            />
          )}

          <div ref={manageRootRef} className="legacy-manage-root" style={{ display: view === 'manage' ? 'block' : 'none' }}>
            <div className="manage-header">
              <div className="manage-header-top">
                <h1>Business</h1>
                <button className="signout-btn" onClick={handleSignOut} title="Sign out">
                  <span>{session?.user?.email || 'Account'}</span>
                  <span className="signout-btn-label">Sign out</span>
                </button>
              </div>
              <p>Quotes, jobs, customers & insights</p>
            </div>
            <Suspense fallback={<div className="auth-loading"><div className="ocr-spinner" /></div>}>
              <App key={moreKey} cloudJobs={applyJobMetaToJobs(jobs)} profile={profile} onAddPayment={onAddPayment} />
            </Suspense>
          </div>

          <BottomNav
            view={view}
            onChange={handleTabChange}
          />
        </>
      )}

      {/* ── Account drawer (new nav only — slice 3 uses Settings tab instead) ─ */}
      {!NAV_SLICE_3 && NEW_NAV && (
        <AccountDrawer
          open={drawerOpen}
          session={session}
          profile={profile}
          onClose={() => setDrawerOpen(false)}
          onSignOut={handleSignOut}
          onOpenWizard={() => {
            setDrawerOpen(false);
            sessionStorage.setItem('jp.wizardActive', '1');
            setWizardOpen(true);
          }}
        />
      )}

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
      <SyncBadge />

      {/* ── One-time orientation toast ──────────────────────────────────── */}
      {navToast && (
        <div className="nav-toast" role="status">
          {navToast}
          <button className="nav-toast-close" onClick={() => setNavToast(null)} aria-label="Dismiss"><Icon name="close" size={16} /></button>
        </div>
      )}

      {/* ── Realtime event toast — quote accepted (app open when customer signed) ── */}
      {/* Tapping navigates to the job in the Jobs tab. ✕ dismisses without nav. */}
      {realtimeToast && (
        <div
          className="nav-toast nav-toast--realtime nav-toast--accepted"
          role="status"
          aria-live="polite"
        >
          <button
            type="button"
            className="nav-toast-body"
            onClick={() => {
              setRealtimeToast(null);
              if (realtimeToast.jobId) {
                setPendingJobId(realtimeToast.jobId);
                navigate(NAV_SLICE_3 ? 'work' : NEW_NAV ? 'jobs' : 'today');
              }
            }}
            aria-label={`${realtimeToast.message} — tap to view job`}
          >
            <Icon name="complete" size={16} variant="success" className="nav-toast-check" />
            {realtimeToast.message}
          </button>
          <button
            type="button"
            className="nav-toast-close"
            onClick={() => setRealtimeToast(null)}
            aria-label="Dismiss"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {/* ── Post-paid cost snackbar — fires after Today quick mark-paid ── */}
      {/* Payment is already recorded. This is a secondary, skippable nudge.  */}
      {/* Auto-dismisses after 6 s if the user does nothing.                  */}
      {costSnackbar && !costSnackbar.expanded && (
        <div className="nav-toast nav-toast--cost-capture" role="status" aria-live="polite">
          <span className="nav-toast-cost-msg">
            Paid &#10003; &mdash; add what this job cost you?
          </span>
          <button
            type="button"
            className="nav-toast-add-cost"
            onClick={() => {
              if (costSnackbarTimerRef.current) clearTimeout(costSnackbarTimerRef.current);
              setCostSnackbar(prev => prev ? { ...prev, expanded: true } : null);
            }}
            aria-label="Add job cost"
          >
            + Add cost
          </button>
          <button
            type="button"
            className="nav-toast-close"
            onClick={() => {
              if (costSnackbarTimerRef.current) clearTimeout(costSnackbarTimerRef.current);
              const { shouldAutoMute } = recordDismissal();
              if (shouldAutoMute) handleProfileUpdate({ remind_job_costs: false });
              setCostSnackbar(null);
            }}
            aria-label="Dismiss"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {/* ── Expanded cost-capture modal (from Today snackbar "+ Add cost" tap) ── */}
      {costSnackbar?.expanded && (
        <div className="modal-backdrop" onClick={() => setCostSnackbar(null)}>
          <div className="modal modal--paid-success" onClick={e => e.stopPropagation()}>
            <div className="modal-paid-badge">
              <Icon name="paid" size={24} variant="success" className="modal-paid-check" />
              <span className="modal-paid-label">Paid</span>
            </div>
            <PostPaidCostRow
              job={costSnackbar.job}
              jobCostTotal={costSnackbar.jobCostTotal ?? 0}
              variant={costPromptVariant(costSnackbar.jobCostTotal ?? 0)}
              onSave={handleAddReceipt}
              onSkip={() => setCostSnackbar(null)}
              onAutoMute={() => {
                setCostSnackbar(null);
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

      {/* ── Onboarding wizard (new nav + slice-3) ──────────────────────── */}
      {(NEW_NAV || NAV_SLICE_3) && wizardOpen && (
        <OnboardingWizard
          session={session}
          profile={profile}
          onComplete={(savedProfile) => {
            setProfile(savedProfile);
            setWizardOpen(false);
            sessionStorage.removeItem('jp.wizardActive');
            if (postWizardNav) {
              navigate(postWizardNav);
              setPostWizardNav(null);
              // If user was trying to create a job, open the detailed form now
              if (postWizardNav === 'jobs' || postWizardNav === 'work') {
                setPendingDeepLink('create-detailed-job');
                setMoreKey(k => k + 1);
              }
            }
          }}
        />
      )}
    </>
  );
}

/**
 * Returns true when the minimum required profile fields are present for
 * job/quote creation (name fields only — bank is deferred to invoice-send time).
 *
 * Bank details were removed from this gate in 2026-06-02 so that a brand-new
 * trader can create and send their first quote without completing bank setup.
 * The bank requirement now lives on the invoice-send path (SendInvoiceModal).
 *
 * Old-nav callers never reach this — gate is always inside NEW_NAV/slice-3 blocks.
 */
function isProfileComplete(profile, session) {
  if (!profile) return false;
  const hasName = !!(profile.business_name);
  const hasFirst = !!(profile.first_name);
  const hasLast = !!(profile.last_name);
  const hasEmail = !!(session?.user?.email);
  return hasName && hasFirst && hasLast && hasEmail;
}

/**
 * Returns true when the profile has bank details saved.
 * Used by the just-in-time bank gate on the invoice-send path (SendInvoiceModal).
 */
export function profileHasBank(profile) {
  return !!(profile?.sort_code && profile?.account_number);
}
