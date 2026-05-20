/**
 * WorkScreen — Jobs tab in slice-3 nav.
 *
 * Merges Job list and calendar into one tab with a segmented control at the top.
 * Last-used subview persists in localStorage under 'jp.workView'.
 *
 * Props mirror what AppShell was passing to JobsScreen + ScheduleScreen.
 */
import { useState, useCallback } from 'react';
import WorkCalendar from './WorkCalendar';

const STORAGE_KEY = 'jp.workView';

function getPersistedView() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'calendar') return 'calendar';
  } catch {
    // localStorage unavailable — default to list
  }
  return 'list';
}

function persistView(v) {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // ignore
  }
}

// ── Status helpers (shared between List and Calendar subviews) ────────────────

const STATUS_FILTERS = ['All', 'Quoted', 'Active', 'Done', 'Paid'];

function deriveDisplayStatus(job) {
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  if (job.invoiceStatus === 'invoiced' || job.status === 'invoice_sent') return 'Invoiced';
  if (job.jobStatus === 'complete' || job.status === 'complete') return 'Done';
  if (job.jobStatus === 'active' || job.status === 'active') return 'Active';
  return 'Quoted';
}

// ── JobCard (inline — extracted from JobsScreen to avoid circular dep) ────────

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
        <div className="job-card-summary">
          {job.summary.slice(0, 60)}{job.summary.length > 60 ? '…' : ''}
        </div>
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

// ── JobsList subview ──────────────────────────────────────────────────────────

function JobsList({ jobs, onNewJob }) {
  const [filter, setFilter] = useState('All');

  const filtered = jobs.filter(j => {
    if (filter === 'All') return true;
    return deriveDisplayStatus(j) === filter;
  });

  return (
    <>
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
          <p className="screen-empty-title">
            No {filter !== 'All' ? filter.toLowerCase() : ''} jobs yet
          </p>
          <p className="screen-empty-hint">
            Tap <strong>+ New job</strong> to add your first job.
          </p>
        </div>
      ) : (
        <ul className="job-list">
          {filtered.map(j => (
            <JobCard key={j.id || j.cloudId} job={j} />
          ))}
        </ul>
      )}
    </>
  );
}

// ── WorkScreen (root) ─────────────────────────────────────────────────────────

export default function WorkScreen({ jobs = [], onNewJob }) {
  const [subview, setSubview] = useState(getPersistedView);

  const switchSubview = useCallback((v) => {
    // Telemetry — wire to real analytics when infrastructure exists
    // TODO: replace console.log with posthog/mixpanel/etc
    console.log('[telemetry] work_subview', { subview: v });
    setSubview(v);
    persistView(v);
  }, []);

  return (
    <div className="screen work-screen">
      {/* Header */}
      <div className="screen-header">
        <h1 className="screen-title">Jobs</h1>
        <div className="screen-header-right">
          <button className="new-btn" onClick={onNewJob}>+ New job</button>
        </div>
      </div>

      {/* Segmented control */}
      <div className="work-segments" role="group" aria-label="Switch between list and calendar view">
        <button
          className={`work-segment ${subview === 'list' ? 'work-segment--active' : ''}`}
          onClick={() => switchSubview('list')}
          aria-pressed={subview === 'list'}
        >
          List
        </button>
        <button
          className={`work-segment ${subview === 'calendar' ? 'work-segment--active' : ''}`}
          onClick={() => switchSubview('calendar')}
          aria-pressed={subview === 'calendar'}
        >
          Calendar
        </button>
      </div>

      {/* Subview */}
      {subview === 'list' ? (
        <JobsList jobs={jobs} onNewJob={onNewJob} />
      ) : (
        <WorkCalendar jobs={jobs} onNewJobOnDate={onNewJob} />
      )}
    </div>
  );
}
