import { useMemo } from 'react';
import { gbp } from '../lib/today';

export default function LinkReceiptModal({ receipt, jobs = [], onLink, onSkip }) {
  const recentJobs = useMemo(() => {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return jobs
      .filter(j => {
        const d = new Date(j.date || j.createdAt || 0).getTime();
        return d >= sevenDaysAgo;
      })
      .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
  }, [jobs]);

  const fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <div className="modal-backdrop" onClick={onSkip}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Link receipt to a job?</h3>
        <p className="modal-sub">
          {receipt?.label || 'Receipt'} · {gbp(receipt?.amount || 0)}
        </p>

        {recentJobs.length === 0 ? (
          <div className="link-empty">
            <p>No recent jobs to link to.</p>
            <p className="modal-help">You can link this receipt later from Manage.</p>
          </div>
        ) : (
          <ul className="link-job-list">
            {recentJobs.map(j => (
              <li key={j.id}>
                <button className="link-job-btn" onClick={() => onLink(j.id)}>
                  <div className="link-job-main">
                    <span className="link-job-name">{j.name || j.customer || 'Job'}</span>
                    <span className="link-job-amount">{gbp(j.amount || 0)}</span>
                  </div>
                  <span className="link-job-date">{fmtDate(j.date || j.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button className="btn-secondary full-width" onClick={onSkip}>
            Skip — link later
          </button>
        </div>
      </div>
    </div>
  );
}
