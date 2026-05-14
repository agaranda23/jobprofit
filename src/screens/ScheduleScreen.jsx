/**
 * ScheduleScreen — Tab 3 in the new nav.
 * Slice 1: stub with week-list view showing scheduled jobs for the next 7 days.
 * Full calendar grid with drag-to-reschedule ships in slice 6.
 */
import HeaderAvatar from '../components/HeaderAvatar';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ScheduleScreen({ jobs = [], session, profile, onAvatarClick, onAddJob }) {
  const week = buildWeek();
  const jobsByDay = groupJobsByDay(jobs, week);

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
                  <button className="schedule-slot-empty" onClick={onAddJob}>
                    — free — <span className="schedule-add">+ Add</span>
                  </button>
                ) : (
                  dayJobs.map(j => (
                    <div key={j.id || j.cloudId} className="schedule-slot">
                      <span className="schedule-slot-time">
                        {j.scheduledStart || ''}
                      </span>
                      <span className="schedule-slot-title">
                        {j.customer || j.name || 'Job'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn-primary btn-large" style={{ marginTop: 16 }} onClick={onAddJob}>
        + Schedule a job
      </button>
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
