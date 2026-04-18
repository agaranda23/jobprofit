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
