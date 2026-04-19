import { useState, useEffect, useCallback, useRef } from 'react';
import App from './App.jsx';
import TodayScreen from './screens/TodayScreen';
import HistoryScreen from './screens/HistoryScreen';
import BottomNav from './components/BottomNav';
import { startHidingLegacyDupes, stopHidingLegacyDupes } from './lib/hideLegacyDupes';
import { clickCreateDetailedJobTab } from './lib/manageDeepLink';
import {
  getTodayJobs,
  getTodayReceipts,
  addTodayJob,
  addTodayReceipt,
  markJobPaid,
} from './lib/store';


// One-time wipe of seeded demo data (J-0001 to J-0004 and E-0001 to E-0005).
// Real user-added entries are preserved.
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
    if (Array.isArray(data.jobs)) {
      data.jobs = data.jobs.filter(j => !demoJobIds.has(j.id));
    }
    if (Array.isArray(data.expenses)) {
      data.expenses = data.expenses.filter(e => !demoExpIds.has(e.id));
    }
    localStorage.setItem('jobprofit-app-data', JSON.stringify(data));
    localStorage.setItem('jp.demoCleared.v1', '1');
  } catch (e) {
    console.warn('Demo wipe failed', e);
  }
}

// One-time migration: pull any pre-existing jp.jobs / jp.receipts into the unified store
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
    // Keep the old keys as backup; don't delete in case something went wrong
  } catch (e) {
    console.warn('Migration failed', e);
  }
}

export default function AppShell() {
  const [view, setView] = useState('today');
  const [moreKey, setMoreKey] = useState(0);
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [receipts, setReceipts] = useState([]);

  const manageRootRef = useRef(null);

  const refresh = useCallback(() => {
    setJobs(getTodayJobs());
    setReceipts(getTodayReceipts());
  }, []);

  useEffect(() => {
    wipeLegacyDemoData();
    migrateLegacyTodayData();
    refresh();
  }, [refresh]);

  // Re-read when switching back to today or history, in case the legacy App mutated storage
  useEffect(() => {
    if (view === 'today' || view === 'history') refresh();
    if (view === 'manage' && manageRootRef.current) {
      startHidingLegacyDupes(manageRootRef.current);
      if (pendingDeepLink === 'create-detailed-job') {
        setTimeout(() => clickCreateDetailedJobTab(manageRootRef.current), 100);
        setPendingDeepLink(null);
      }
    } else {
      stopHidingLegacyDupes();
    }
  }, [view, refresh]);

  // Also listen for storage events from other tabs
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'jobprofit-app-data') refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  const handleAddJob = (job) => {
    addTodayJob(job);
    refresh();
  };
  const handleAddReceipt = (receipt) => {
    addTodayReceipt(receipt);
    refresh();
  };
  const handleMarkPaid = (id) => {
    markJobPaid(id);
    refresh();
  };

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
          <h1>Manage</h1>
          <p>Customers, quotes, materials & invoices</p>
        </div>
        <App key={moreKey} />
      </div>

      <BottomNav view={view} onChange={(v) => { if (v === 'manage') setMoreKey(k => k + 1); setView(v); }} />
    </>
  );
}
