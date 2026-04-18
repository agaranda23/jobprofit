import { useState, useEffect } from 'react';
import App from './App.jsx';
import TodayScreen from './screens/TodayScreen';
import BottomNav from './components/BottomNav';

export default function AppShell() {
  const [view, setView] = useState('today');
  const [todayJobs, setTodayJobs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jp.jobs') || '[]'); } catch { return []; }
  });
  const [todayReceipts, setTodayReceipts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jp.receipts') || '[]'); } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('jp.jobs', JSON.stringify(todayJobs)); } catch {} }, [todayJobs]);
  useEffect(() => { try { localStorage.setItem('jp.receipts', JSON.stringify(todayReceipts)); } catch {} }, [todayReceipts]);
  const handleAddJob = (j) => setTodayJobs(p => [j, ...p]);
  const handleAddReceipt = (r) => setTodayReceipts(p => [r, ...p]);
  return (
    <>
      {view === 'today' && (
        <TodayScreen jobs={todayJobs} receipts={todayReceipts} onAddJob={handleAddJob} onAddReceipt={handleAddReceipt} />
      )}
      <div style={{ display: view === 'history' ? 'block' : 'none' }}>
        <App />
      </div>
      <div style={{ display: view === 'more' ? 'block' : 'none', padding: '24px 20px 96px' }}>
        <h1 style={{ fontSize: 32, marginTop: 16, marginBottom: 8 }}>More</h1>
        <p style={{ color: 'var(--text-dim)' }}>Reports, analytics, exports and settings will move here.</p>
      </div>
      <BottomNav view={view} onChange={setView} />
    </>
  );
}
