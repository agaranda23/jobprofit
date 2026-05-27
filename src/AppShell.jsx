import { useState, useEffect, useCallback, useRef } from 'react';
import App from './App.jsx';
import {
  isPushSupported,
  getSubscriptionStatus,
  subscribe as pushSubscribe,
} from './lib/pushSubscribe.js';
import TodayScreen from './screens/TodayScreen';
import HistoryScreen from './screens/HistoryScreen';
import JobsScreen from './screens/JobsScreen';
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
  // Realtime event toast — e.g. "Customer signed quote — <name>"
  const [realtimeToast, setRealtimeToast] = useState(null);
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

  const manageRootRef = useRef(null);

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

  // Single popstate listener: re-derive view from hash on Back/Forward.
  // Do NOT bump moreKey here — App.jsx state must survive a Back navigation.
  useEffect(() => {
    const onPop = () => {
      setView(parseViewFromHash());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
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
      if (!newSession) setCloudLoaded(false);
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

    // Silently re-subscribe if previously granted but subscription expired
    getSubscriptionStatus().then((status) => {
      if (status === 'granted-unsubscribed') {
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
            const customerName = incoming.customer_name || prev?.name || 'Customer';
            setRealtimeToast(`Customer signed quote — ${customerName}`);
            const t = setTimeout(() => setRealtimeToast(null), 6000);
            // Cleanup is handled via the outer effect's return; the timeout id
            // is intentionally not tracked here because the toast message itself
            // is short-lived and a stale clear is harmless.
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

  // Wizard trigger: when new-nav or slice-3 profile loads and required fields
  // are missing, open the wizard once per session.
  // The sessionStorage flag prevents looping the user on every reload.
  useEffect(() => {
    if (!NEW_NAV && !NAV_SLICE_3) return;
    if (!profile) return; // wait for profile to resolve
    if (sessionStorage.getItem('jp.wizardActive')) return; // already in wizard this session
    if (isProfileComplete(profile, session)) return; // already done
    sessionStorage.setItem('jp.wizardActive', '1');
    setWizardOpen(true);
  }, [profile, session]);

  const handleAddJob = async (job) => {
    try {
      await addJobToCloud(job);
      await refreshFromCloud();
    } catch (e) {
      console.error('Add job failed', e);
      addTodayJob(job);
      setJobs(applyJobMetaToJobs(getTodayJobs()));
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
    // New-nav / slice-3: gate job create on wizard completion.
    // Old-nav: no gate — existing behaviour unchanged.
    if ((NEW_NAV || NAV_SLICE_3) && !isProfileComplete(profile, session)) {
      sessionStorage.setItem('jp.wizardActive', '1');
      // After wizard, route to 'work' (slice 3) or 'jobs' (new nav)
      setPostWizardNav(NAV_SLICE_3 ? 'work' : 'jobs');
      setWizardOpen(true);
      return;
    }
    setPendingDeepLink('create-detailed-job');
    setMoreKey(k => k + 1);
    // Slice 3: route to 'work'; New nav: 'jobs'; Legacy: 'manage'
    navigate(NAV_SLICE_3 ? 'work' : NEW_NAV ? 'jobs' : 'manage');
  };

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
      {/* ── SLICE-3 NAV (Today / Jobs / Money / Settings) ───────────── */}
      {NAV_SLICE_3 && (
        <>
          {view === 'today' && (
            <TodayScreen
              onOpenDetailed={openDetailed}
              onChase={() => navigate('finance')}
              onMarkPaid={onMarkPaidFromToday}
              onJobTap={() => navigate('work')}
              jobs={jobs}
              receipts={receipts}
              onAddJob={handleAddJob}
              onAddReceipt={handleAddReceipt}
              avatarProps={avatarProps}
            />
          )}

          {view === 'work' && (
            <WorkScreen
              jobs={jobs}
              receipts={receipts}
              onNewJob={openDetailed}
              onAddPayment={onAddPayment}
              onUpdateJob={onUpdateJob}
              onAddReceipt={handleAddReceipt}
              onDeleteReceipt={handleDeleteReceipt}
              biz={null}
              profile={profile}
            />
          )}

          {view === 'finance' && (
            <FinanceScreen
              jobs={jobs}
              receipts={receipts}
              session={session}
              profile={profile}
              onMarkPaid={handleMarkPaid}
              // No avatar — Settings tab replaces the drawer in slice 3
            />
          )}

          {view === 'settings' && (
            <SettingsScreen
              session={session}
              profile={profile}
              onSignOut={handleSignOut}
              onOpenWizard={openWizardFromSettings}
              onProfileUpdate={handleProfileUpdate}
            />
          )}

          {/* HeaderAvatar and AccountDrawer are NOT rendered when slice 3 is active.
              The Settings tab is the single account entry point. */}

          <BottomNav
            view={view}
            onChange={navigate}
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
              onJobTap={() => navigate('jobs')}
              jobs={jobs}
              receipts={receipts}
              onAddJob={handleAddJob}
              onAddReceipt={handleAddReceipt}
              avatarProps={avatarProps}
            />
          )}

          {view === 'jobs' && (
            <JobsScreen
              jobs={jobs}
              session={session}
              profile={profile}
              onAvatarClick={() => setDrawerOpen(true)}
              onNewJob={openDetailed}
              onUpdateJob={onUpdateJob}
            />
          )}

          {view === 'schedule' && (
            <ScheduleScreen
              jobs={jobs}
              session={session}
              profile={profile}
              onAvatarClick={() => setDrawerOpen(true)}
              onAddJob={openDetailed}
            />
          )}

          {view === 'money' && (
            <FinanceScreen
              jobs={jobs}
              receipts={receipts}
              session={session}
              profile={profile}
              onAvatarClick={() => setDrawerOpen(true)}
              onMarkPaid={handleMarkPaid}
            />
          )}

          <BottomNav
            view={view}
            onChange={navigate}
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
              onAddReceipt={handleAddReceipt}
            />
          )}

          {view === 'history' && (
            <HistoryScreen
              jobs={jobs}
              receipts={receipts}
              onMarkPaid={handleMarkPaid}
            />
          )}

          <div ref={manageRootRef} style={{ display: view === 'manage' ? 'block' : 'none' }}>
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
            <App key={moreKey} cloudJobs={applyJobMetaToJobs(jobs)} profile={profile} onAddPayment={onAddPayment} />
          </div>

          <BottomNav
            view={view}
            onChange={(v) => { if (v === 'manage') setMoreKey(k => k + 1); navigate(v); }}
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

      {/* ── One-time orientation toast ──────────────────────────────────── */}
      {navToast && (
        <div className="nav-toast" role="status">
          {navToast}
          <button className="nav-toast-close" onClick={() => setNavToast(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* ── Realtime event toast (e.g. remote signature) ─────────────────── */}
      {realtimeToast && (
        <div className="nav-toast nav-toast--realtime" role="status" aria-live="polite">
          {realtimeToast}
          <button className="nav-toast-close" onClick={() => setRealtimeToast(null)} aria-label="Dismiss">✕</button>
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
 * Returns true when all 5 required profile fields are present.
 * Used by both the wizard trigger and the job-create gate.
 * Old-nav callers never reach this — gate is always inside NEW_NAV blocks.
 */
function isProfileComplete(profile, session) {
  if (!profile) return false;
  const hasName = !!(profile.business_name);
  const hasFirst = !!(profile.first_name);
  const hasLast = !!(profile.last_name);
  const hasBank = !!(profile.sort_code && profile.account_number);
  const hasEmail = !!(session?.user?.email);
  return hasName && hasFirst && hasLast && hasBank && hasEmail;
}
