/**
 * ScheduleScreen — Tab 3 in the new nav.
 * Slice 1: stub with week-list view showing scheduled jobs for the next 7 days.
 * Full calendar grid with drag-to-reschedule ships in slice 6.
 *
 * Bug fix (fix/calendar-add-and-payment-pct): "+" buttons previously called
 * onAddJob which was wired to openDetailed() in AppShell — that navigates to
 * the Work tab instead of opening the Add-Job form.  ScheduleScreen now owns
 * its own addJobOpen state and mounts AddJobModal directly, matching the
 * pattern used by WorkScreen and TodayScreen.  When a specific day slot is
 * tapped the date is pre-filled via initialDate + defaultMode='details-manual'.
 */
import { useState } from 'react';
import HeaderAvatar from '../components/HeaderAvatar';
import AddJobModal from '../components/AddJobModal';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ScheduleScreen({ jobs = [], session, profile, onAvatarClick, onSaveJob, onJobTap }) {
  const week = buildWeek();
  const jobsByDay = groupJobsByDay(jobs, week);

  // addJobOpen: controls whether AddJobModal is mounted.
  // addJobDate: ISO date string pre-filled when opening from a specific day slot.
  // Null = no pre-fill (opened from the primary CTA).
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [addJobDate, setAddJobDate] = useState(null);

  const openAddJobForDate = (isoDate) => {
    setAddJobDate(isoDate || null);
    setAddJobOpen(true);
  };

  const openAddJob = () => openAddJobForDate(null);

  const handleJobSave = (job) => {
    setAddJobOpen(false);
    setAddJobDate(null);
    onSaveJob?.(job);
  };

  return (
    <div className="screen schedule-screen">
      <div className="screen-header">
        <h1 className="screen-title">Schedule</h1>
        <div className="screen-header-right">
          <HeaderAvatar session={session} profile={profile} onClick={onAvatarClick} />
        </div>
      </div>

      <div className="schedule-subhead">
        W/c {formatDay(week[0])}
      </div>

      <div className="schedule-week">
        {week.map(day => {
          const key = day.toISOString().slice(0, 10);
          const dayJobs = jobsByDay[key] || [];
          const isToday = key === new Date().toISOString().slice(0, 10);

          return (
            <div key={key} className={`schedule-day ${isToday ? 'schedule-day--today' : ''}`}>
              <div className="schedule-day-label">
                <span className="schedule-day-name">{DAY_LABELS[day.getDay()]}</span>
                <span className="schedule-day-date">{day.getDate()}</span>
              </div>
              <div className="schedule-day-slots">
                {dayJobs.length === 0 ? (
                  <button className="schedule-slot-empty" onClick={() => openAddJobForDate(key)}>
                    — free — <span className="schedule-add">+ Add</span>
                  </button>
                ) : (
                  dayJobs.map(j => (
                    <button
                      key={j.id || j.cloudId}
                      type="button"
                      className="schedule-slot"
                      onClick={() => onJobTap?.(j)}
                      aria-label={`Open ${j.customer || j.name || 'Job'}`}
                      style={{ minHeight: 44, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                    >
                      <span className="schedule-slot-time">
                        {j.scheduledStart || ''}
                      </span>
                      <span className="schedule-slot-title">
                        {j.customer || j.name || 'Job'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn-primary btn-large" style={{ marginTop: 16 }} onClick={openAddJob}>
        + Schedule a job
      </button>

      {addJobOpen && (
        <AddJobModal
          onClose={() => { setAddJobOpen(false); setAddJobDate(null); }}
          onSave={handleJobSave}
          {...(addJobDate ? { initialDate: addJobDate, defaultMode: 'details-manual' } : {})}
        />
      )}
    </div>
  );
}

function buildWeek() {
  const today = new Date();
  // Start from Monday of current week
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dow + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function groupJobsByDay(jobs, week) {
  const keys = new Set(week.map(d => d.toISOString().slice(0, 10)));
  const groups = {};
  for (const j of jobs) {
    const day = j.scheduledDate || j.date || '';
    const key = day.slice(0, 10);
    if (!keys.has(key)) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(j);
  }
  // Sort each day's jobs by scheduledStart
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));
  }
  return groups;
}

function formatDay(d) {
  return `${DAY_LABELS[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}
