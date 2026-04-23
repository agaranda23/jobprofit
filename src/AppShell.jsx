import { useState, useEffect, useCallback, useRef } from 'react';
import App from './App.jsx';
import TodayScreen from './screens/TodayScreen';
import HistoryScreen from './screens/HistoryScreen';
import BottomNav from './components/BottomNav';
import LinkReceiptModal from './components/LinkReceiptModal';
import { startHidingLegacyDupes, stopHidingLegacyDupes } from './lib/hideLegacyDupes';
import { startHidingLegacyWrites, stopHidingLegacyWrites } from './lib/hideLegacyWrites';
import { clickCreateDetailedJobTab } from './lib/manageDeepLink';
import { supabase } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
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

export default function AppShell() {
  const [view, setView] = useState('today');
  const [moreKey, setMoreKey] = useState(0);
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
  const [jobs, setJobs] = useState(() => getTodayJobs());
  const [receipts, setReceipts] = useState(() => getTodayReceipts());
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [pendingLink, setPendingLink] = useState(null); // receipt awaiting job link

  const manageRootRef = useRef(null);

  const refreshFromCloud = useCallback(async () => {
    try {
      const [cloudJobs, cloudReceipts] = await Promise.all([
        getJobsFromCloud(),
        getReceiptsFromCloud(),
      ]);
      setJobs(cloudJobs);
      setReceipts(cloudReceipts);
      setCloudLoaded(true);
    } catch (e) {
      console.warn('Cloud refresh failed, keeping localStorage view', e);
    }
  }, []);

  const refreshLocal = useCallback(() => {
    if (!cloudLoaded) {
      setJobs(getTodayJobs());
      setReceipts(getTodayReceipts());
    }
  }, [cloudLoaded]);

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
    if (session) refreshFromCloud();
  }, [session, refreshFromCloud]);

  useEffect(() => {
    if (view === 'today' || view === 'history') refreshLocal();
    if (view === 'manage' && manageRootRef.current) {
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
        setJobs(getTodayJobs());
        setReceipts(getTodayReceipts());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [cloudLoaded]);

  const handleAddJob = async (job) => {
    try {
      await addJobToCloud(job);
      await refreshFromCloud();
    } catch (e) {
      console.error('Add job failed', e);
      addTodayJob(job);
      setJobs(getTodayJobs());
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
      setJobs(getTodayJobs());
    }
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
      // Reset local UI state; session listener will clear session
      setJobs([]);
      setReceipts([]);
      setCloudLoaded(false);
      // Clear local mirror too
      try { localStorage.removeItem('jobprofit-app-data'); } catch {}
    } catch (e) {
      console.warn('Sign out failed', e);
    }
  };

  if (!authReady) {
    return <div className="auth-loading"><div className="ocr-spinner" /></div>;
  }
  if (!session) {
    return <AuthScreen />;
  }

  return (
    <>
      {view === 'today' && (
        <TodayScreen
          onOpenDetailed={() => { setPendingDeepLink('create-detailed-job'); setMoreKey(k => k + 1); setView('manage'); }}
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
        <App key={moreKey} />
      </div>

      <BottomNav view={view} onChange={(v) => { if (v === 'manage') setMoreKey(k => k + 1); setView(v); }} />

      {pendingLink && (
        <LinkReceiptModal
          receipt={pendingLink}
          jobs={jobs}
          onLink={handleLinkReceipt}
          onSkip={() => setPendingLink(null)}
        />
      )}
    </>
  );
}
