import { useState, useEffect, useCallback, useRef } from 'react';
import App from './App.jsx';
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
import CashflowChart from './components/CashflowChart';
import { SAMPLE_DATA } from './components/CashflowChart.helpers.js';
import { parseHash, navigateToView, replaceHistory, TOP_VIEWS } from './lib/navigation';
import { writeJobMeta, extractJobMeta, applyJobMetaToJobs } from './lib/jobMeta';
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
} from './lib/store';

// ─── Feature flags ───────────────────────────────────────────────────────────
// Enable the new 4-tab nav:
//   localStorage.setItem('jp.newNav', '1'); location.reload();
// Enable slice-3 nav (Today / Work / Finance / Settings):
//   localStorage.setItem('jp.navSlice3', '1'); location.reload();
const NEW_NAV        = localStorage.getItem('jp.newNav')        === '1';
const NAV_SLICE_3    = localStorage.getItem('jp.navSlice3')    === '1';
// M2 dev-flag: renders CashflowChart on the finance view so founders can eyeball
// it on the deploy preview. No-op in production (flag is never set by the app).
// Remove this flag check after M3 wires the chart into FinanceScreen.
// To enable: localStorage.setItem('jp.chartPreview', '1'); location.reload();
const CHART_PREVIEW  = NAV_SLICE_3 && localStorage.getItem('jp.chartPreview') === '1';

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
  const { view } = parseHash();
  if (NAV_SLICE_3) {
    // Slice-3 view set; also map legacy job/schedule routes to 'work'
    if (view === 'jobs' || view === 'schedule') return 'work';
    if (view === 'money') return 'finance';
    return SLICE_3_VIEWS.includes(view) ? view : 'today';
  }
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
  // Wizard state (new nav only).
  // wizardOpen — should the wizard overlay be showing right now?
  // postWizardNav — view to navigate to after the wizard completes (e.g. 'jobs').
  const [wizardOpen, setWizardOpen] = useState(false);
  const [postWizardNav, setPostWizardNav] = useState(null);

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

  // Fetch user profile from Supabase (best-effort — slice 2 adds the actual columns)
  const refreshProfile = useCallback(async (userId) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (data) setProfile(data);
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
    try {
      const savedReceipt = await addReceiptToCloud(payload, photoFile);
      await refreshFromCloud();
      // Only show link modal if there are jobs to potentially link to
      if (savedReceipt?.id) {
        setPendingLink(savedReceipt);
      }
    } catch (e) {
      console.error('Add receipt failed', e);
      addTodayReceipt(payload);
      setReceipts(getTodayReceipts());
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

  // Mark-paid from the new Today awaiting section. Single-device per PRD #3
  // architecture: writes the new payment fields into the jobMeta side-channel
  // and updates React state. No cloud write — that's a future PRD.
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
    writeJobMeta(updated.id, extractJobMeta(updated));
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
  };

  // Partial-payment add (Phase B of partial-payments PRD). Single-device per
  // PRD #3/#4 architecture: payments[] lives in the jobMeta side-channel,
  // never round-trips through the cloud schema. addPayment helper in
  // payments.js handles validation + auto-flip rule; this handler persists
  // to the side-channel and updates React state. Symmetric with
  // onMarkPaidFromToday above.
  const onAddPayment = (job, payload) => {
    const updated = addPayment(job, payload);
    writeJobMeta(updated.id, extractJobMeta(updated));
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
              onNewJob={openDetailed}
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
            />
          )}

          {/* HeaderAvatar and AccountDrawer are NOT rendered when slice 3 is active.
              The Settings tab is the single account entry point. */}

          {/* ── M2 chart dev-flag preview (remove after M3 ships) ───── */}
          {CHART_PREVIEW && (
            <div className="screen" style={{ padding: '16px', boxSizing: 'border-box' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '1rem' }}>
                CashflowChart preview (M2 sample data)
              </h2>
              <CashflowChart data={SAMPLE_DATA} />
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '12px' }}>
                Dev only — disable: <code>localStorage.removeItem(&apos;jp.chartPreview&apos;); location.reload()</code>
              </p>
            </div>
          )}

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

      {/* ── One-time orientation toast ──────────────────────────────────── */}
      {navToast && (
        <div className="nav-toast" role="status">
          {navToast}
          <button className="nav-toast-close" onClick={() => setNavToast(null)} aria-label="Dismiss">✕</button>
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
