import { useState, useEffect } from 'react';
import App from './App.jsx';
import TodayScreen from './screens/TodayScreen';
import HistoryScreen from './screens/HistoryScreen';
import BottomNav from './components/BottomNav';

export default function AppShell() {
  const [view, setView] = useState('today');

  const [todayJobs, setTodayJobs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jp.jobs') || '[]'); } catch { return []; }
  });
  const [todayReceipts, setTodayReceipts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jp.receipts') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem('jp.jobs', JSON.stringify(todayJobs)); } catch {}
  }, [todayJobs]);
  useEffect(() => {
    try { localStorage.setItem('jp.receipts', JSON.stringify(todayReceipts)); } catch {}
  }, [todayReceipts]);

  const handleAddJob = (job) => setTodayJobs(p => [job, ...p]);
  const handleAddReceipt = (receipt) => setTodayReceipts(p => [receipt, ...p]);
  const handleMarkPaid = (id) => {
    setTodayJobs(p => p.map(j => j.id === id ? { ...j, paid: true } : j));
  };

  return (
    <>
      {view === 'today' && (
        <TodayScreen
          onOpenDetailed={() => setView("more")}
          jobs={todayJobs}
          receipts={todayReceipts}
          onAddJob={handleAddJob}
          onAddReceipt={handleAddReceipt}
        />
      )}

      {view === 'history' && (
        <HistoryScreen
          jobs={todayJobs}
          receipts={todayReceipts}
          onMarkPaid={handleMarkPaid}
        />
      )}

      <div style={{ display: view === 'more' ? 'block' : 'none' }}>
        <App />
      </div>

      <BottomNav view={view} onChange={setView} />
    </>
  );
}
