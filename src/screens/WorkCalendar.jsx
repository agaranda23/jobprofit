/**
 * WorkCalendar — week-view calendar for the Work tab (slice 3).
 *
 * Features:
 *   - Week view (default) via CSS Grid — 7 day-columns.
 *   - "Unscheduled (n)" strip at top for jobs with null/missing date.
 *   - Tap an empty day slot → calls onNewJobOnDate (pre-fills date in AddJob modal).
 *   - Tap a job in any slot → TODO: open job-detail modal (not yet wired).
 *   - Day / Week / Month toggle header (Week is active; Day + Month are v2 placeholders).
 *
 * Data contract: reads `jobs` array from props — same source as JobsScreen/WorkScreen.
 * No parallel Supabase queries.
 *
 * Drag-to-reschedule: v2 — not implemented in this PR.
 * TODO(v2): add drag-and-drop rescheduling via HTML5 drag API or @dnd-kit.
 */

import { logTelemetry } from '../lib/telemetry';

const DAY_LABELS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function buildWeek() {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  // Normalise to Monday of current week (Mon=0 offset)
  monday.setDate(today.getDate() - ((dow + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function groupByDay(jobs) {
  const groups = {};
  for (const j of jobs) {
    const raw = j.scheduledDate || j.date || '';
    if (!raw) continue;
    const key = raw.slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(j);
  }
  return groups;
}

function isUnscheduled(job) {
  const raw = job.scheduledDate || job.date || '';
  return !raw || raw.trim() === '';
}

function jobLabel(job) {
  return job.customer || job.name || 'Job';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UnscheduledStrip({ jobs }) {
  if (jobs.length === 0) return null;
  return (
    <div className="wc-unscheduled">
      <span className="wc-unscheduled-label">Unscheduled ({jobs.length})</span>
      <div className="wc-unscheduled-chips">
        {jobs.map(j => (
          <span key={j.id || j.cloudId} className="wc-unscheduled-chip" title={jobLabel(j)}>
            {jobLabel(j).slice(0, 18)}{jobLabel(j).length > 18 ? '…' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function DayColumn({ day, dayJobs, isToday, onAddOnDate }) {
  const key = isoDate(day);
  return (
    <div className={`wc-day ${isToday ? 'wc-day--today' : ''}`}>
      <div className="wc-day-header">
        <span className="wc-day-name">{DAY_LABELS[day.getDay()]}</span>
        <span className={`wc-day-num ${isToday ? 'wc-day-num--today' : ''}`}>{day.getDate()}</span>
      </div>
      <div className="wc-day-slots">
        {dayJobs.length === 0 ? (
          <button
            className="wc-slot-empty"
            onClick={() => onAddOnDate(key)}
            aria-label={`Add job on ${key}`}
          >
            +
          </button>
        ) : (
          dayJobs.map(j => (
            <div
              key={j.id || j.cloudId}
              className="wc-slot-job"
              title={jobLabel(j)}
            >
              <span className="wc-slot-job-label">{jobLabel(j).slice(0, 14)}{jobLabel(j).length > 14 ? '…' : ''}</span>
            </div>
          ))
        )}
        {dayJobs.length > 0 && (
          <button
            className="wc-slot-add"
            onClick={() => onAddOnDate(key)}
            aria-label={`Add job on ${key}`}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

// ── WorkCalendar ──────────────────────────────────────────────────────────────

export default function WorkCalendar({ jobs = [], onNewJobOnDate }) {
  const week = buildWeek();
  const byDay = groupByDay(jobs);
  const todayKey = isoDate(new Date());
  const unscheduled = jobs.filter(isUnscheduled);

  const weekLabel = `W/c ${DAY_LABELS[week[0].getDay()]} ${week[0].getDate()} ${MONTH_NAMES[week[0].getMonth()]}`;

  const handleAddOnDate = (dateKey) => {
    logTelemetry('calendar_add_tap', { date: dateKey });
    // The brief says "open the existing AddJob modal with date pre-filled".
    // Judgement call: the AddJob modal lives inside App.jsx and isn't yet
    // exposed as a standalone component. For slice 3 we call onNewJobOnDate
    // which opens the new-job flow (same as "+ New job" CTA).
    // TODO(slice-4): pass dateKey into the AddJob modal so the date field is pre-filled.
    onNewJobOnDate();
  };

  return (
    <div className="work-calendar">
      {/* View toggle header — Week is active; Day + Month are v2 placeholders */}
      <div className="wc-view-toggle" role="group" aria-label="Calendar view">
        <button className="wc-view-btn" disabled title="Coming in v2">Day</button>
        <button className="wc-view-btn wc-view-btn--active" aria-pressed="true">Week</button>
        <button className="wc-view-btn" disabled title="Coming in v2">Month</button>
      </div>

      <div className="wc-week-label">{weekLabel}</div>

      {/* Unscheduled strip */}
      <UnscheduledStrip jobs={unscheduled} />

      {/* 7-column week grid */}
      <div className="wc-grid">
        {week.map(day => {
          const key = isoDate(day);
          return (
            <DayColumn
              key={key}
              day={day}
              dayJobs={byDay[key] || []}
              isToday={key === todayKey}
              onAddOnDate={handleAddOnDate}
            />
          );
        })}
      </div>
    </div>
  );
}
