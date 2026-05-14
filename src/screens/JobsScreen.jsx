/**
 * JobsScreen — Tab 2 in the new nav.
 * Slice 1: surfaces the existing Business/Jobs sub-tab at top level,
 * wrapped in a clean header with avatar + status filter chips.
 * Full pipeline UI (status filters, Send Invoice CTA) lands in slice 3.
 */
import { useState } from 'react';
import HeaderAvatar from '../components/HeaderAvatar';

const STATUS_FILTERS = ['All', 'Quoted', 'Active', 'Done', 'Paid'];

export default function JobsScreen({ jobs = [], session, profile, onAvatarClick, onNewJob }) {
  const [filter, setFilter] = useState('All');

  const filtered = jobs.filter(j => {
    if (filter === 'All') return true;
    const s = deriveDisplayStatus(j);
    return s === filter;
  });

  return (
    <div className="screen jobs-screen">
      <div className="screen-header">
        <h1 className="screen-title">Jobs</h1>
        <div className="screen-header-right">
          <button className="new-btn" onClick={onNewJob}>+ New</button>
          <HeaderAvatar session={session} profile={profile} onClick={onAvatarClick} />
        </div>
      </div>

      {/* Status filter chips */}
      <div className="filter-chips" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map(f => (
          <button
            key={f}
            className={`filter-chip ${filter === f ? 'filter-chip--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
            {f !== 'All' && (
              <span className="filter-chip-count">
                {jobs.filter(j => deriveDisplayStatus(j) === f).length || ''}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Job list */}
      {filtered.length === 0 ? (
        <div className="screen-empty">
          <p className="screen-empty-title">No {filter !== 'All' ? filter.toLowerCase() : ''} jobs yet</p>
          <p className="screen-empty-hint">Tap <strong>+ New</strong> to add your first job.</p>
        </div>
      ) : (
        <ul className="job-list">
          {filtered.map(j => (
            <JobCard key={j.id || j.cloudId} job={j} />
          ))}
        </ul>
      )}
    </div>
  );
}

function JobCard({ job }) {
  const status = deriveDisplayStatus(job);
  const statusClass = {
    Quoted:   'status--quoted',
    Active:   'status--active',
    Done:     'status--done',
    Invoiced: 'status--invoiced',
    Paid:     'status--paid',
  }[status] || '';

  const doneNotInvoiced = status === 'Done';

  return (
    <li className={`job-card ${doneNotInvoiced ? 'job-card--warn' : ''}`}>
      <div className="job-card-top">
        <span className={`job-status-pill ${statusClass}`}>{status[0]}</span>
        <span className="job-card-customer">{job.customer || job.name || 'Unnamed job'}</span>
      </div>
      {job.summary && (
        <div className="job-card-summary">{job.summary.slice(0, 60)}{job.summary.length > 60 ? '…' : ''}</div>
      )}
      <div className="job-card-footer">
        <span className="job-card-amount">
          {typeof (job.total ?? job.amount) === 'number'
            ? '£' + Number(job.total ?? job.amount).toLocaleString('en-GB', { minimumFractionDigits: 0 })
            : ''}
        </span>
        {doneNotInvoiced && (
          <span className="job-card-warn">Done — not invoiced ⚠</span>
        )}
      </div>
    </li>
  );
}

/**
 * Map the various status fields used across the app to one of the five
 * display statuses: Quoted | Active | Done | Invoiced | Paid.
 */
function deriveDisplayStatus(job) {
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  if (job.invoiceStatus === 'invoiced' || job.status === 'invoice_sent') return 'Invoiced';
  if (job.jobStatus === 'complete' || job.status === 'complete') return 'Done';
  if (job.jobStatus === 'active' || job.status === 'active') return 'Active';
  return 'Quoted';
}
