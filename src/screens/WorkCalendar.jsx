/**
 * WorkCalendar — week/day/month calendar for the Work tab.
 *
 * Views:
 *   - Week (default): 7-column grid, Monday-first.
 *   - Day:  single-day agenda list (no time slots — jobs are date-only).
 *   - Month: standard month grid, tapping a cell drills to Day view.
 *
 * Data contract: reads `jobs` array from props — same source as WorkScreen.
 * No parallel Supabase queries.
 *
 * Persists the active Day/Week/Month sub-mode in localStorage under 'jp.workCalView'.
 * Focused date is kept in component state so Day/Week/Month stay coherent when switching.
 *
 * Drag-to-reschedule: v2 — not implemented in this PR.
 * TODO(v2): add drag-and-drop rescheduling via HTML5 drag API or @dnd-kit.
 */

import { useState, useCallback, useRef } from 'react';
import { logTelemetry } from '../lib/telemetry';

const DAY_LABELS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES  = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT  = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Monday-first single-letter weekday headers for the month grid
const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const CAL_VIEW_KEY = 'jp.workCalView';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Format a Date as a human-friendly label: e.g. "Thu 4 Jun" */
function formatDayLabel(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Parse an ISO YYYY-MM-DD string into a local midnight Date (avoids UTC shift). */
function parseIso(iso) {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
}

/** Build the 7 Date objects for the week containing `anchor`, Monday-first. */
function buildWeekForDate(anchor) {
  const dow = anchor.getDay(); // 0=Sun
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((dow + 6) % 7));
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
  return job.summary || job.customer || job.name || 'Job';
}

/** Build all Date cells for a month grid (Monday-first, padding with prev/next month days). */
function buildMonthGrid(year, month) {
  // month is 0-indexed
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  // Pad start to Monday (dow 1); if firstDay is Sunday (0), we need 6 padding days
  const startPad = (firstDay.getDay() + 6) % 7;
  const endPad = (7 - ((lastDay.getDay() + 6) % 7 + 1)) % 7;

  const cells = [];
  for (let i = startPad; i > 0; i--) {
    const d = new Date(firstDay);
    d.setDate(firstDay.getDate() - i);
    cells.push({ date: d, inMonth: false });
  }
  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    cells.push({ date: new Date(d), inMonth: true });
  }
  for (let i = 1; i <= endPad; i++) {
    const d = new Date(lastDay);
    d.setDate(lastDay.getDate() + i);
    cells.push({ date: d, inMonth: false });
  }
  return cells;
}

function getPersistedCalView() {
  try {
    const v = localStorage.getItem(CAL_VIEW_KEY);
    if (v === 'day' || v === 'week' || v === 'month') return v;
  } catch {
    // ignore
  }
  return 'week';
}

function persistCalView(v) {
  try {
    localStorage.setItem(CAL_VIEW_KEY, v);
  } catch {
    // ignore
  }
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

/** Shared header: back chevron, centre label (tappable), Today pill, forward chevron. */
function NavHeader({ label, onPrev, onNext, onPickDate, onToday, prevAriaLabel, nextAriaLabel }) {
  return (
    <div className="wc-nav-header">
      <button
        type="button"
        className="wc-nav-chevron"
        onClick={onPrev}
        aria-label={prevAriaLabel || 'Previous'}
      >
        &#8249;
      </button>
      <button
        type="button"
        className="wc-nav-label"
        onClick={onPickDate}
        aria-label="Jump to date"
      >
        {label}
      </button>
      <button
        type="button"
        className="wc-today-pill"
        onClick={onToday}
        aria-label="Go to today"
      >
        Today
      </button>
      <button
        type="button"
        className="wc-nav-chevron"
        onClick={onNext}
        aria-label={nextAriaLabel || 'Next'}
      >
        &#8250;
      </button>
    </div>
  );
}

/** Invisible native date-input used to pop the platform date picker. */
function DatePickerTrigger({ value, onChange, triggerRef }) {
  return (
    <input
      ref={triggerRef}
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      tabIndex={-1}
      aria-hidden="true"
    />
  );
}

// ── Day view ──────────────────────────────────────────────────────────────────

function DayView({ focusedDate, byDay, todayKey, onAddOnDate, onJobTap }) {
  const key = isoDate(focusedDate);
  const dayJobs = byDay[key] || [];
  const dayLabel = formatDayLabel(focusedDate);
  const btnLabel = `+ Add job on ${dayLabel}`;

  return (
    <div className="wc-day-view">
      {dayJobs.length === 0 ? (
        <div className="wc-day-empty">
          <span className="wc-day-empty-icon" role="img" aria-label="Calendar">&#128197;</span>
          <p className="wc-day-empty-title">Nothing booked {dayLabel}</p>
          <p className="wc-day-empty-hint">Tap below to put a job in the diary for this day.</p>
        </div>
      ) : (
        <ul className="wc-day-list">
          {dayJobs.map(j => (
            <li
              key={j.id || j.cloudId}
              className="wc-day-tile"
              role="button"
              tabIndex={0}
              onClick={() => onJobTap?.(j)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onJobTap?.(j); }}
              aria-label={`Open ${jobLabel(j)}`}
            >
              <span className="wc-day-tile-label">{jobLabel(j)}</span>
              {(j.customer && j.customer !== j.summary) && (
                <span className="wc-day-tile-customer">{j.customer}</span>
              )}
              {(j.total ?? j.amount) > 0 && (
                <span className="wc-day-tile-amount">
                  £{Number(j.total ?? j.amount).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Sticky create button — always visible at the bottom */}
      <div className="wc-day-sticky-footer">
        <button
          type="button"
          className="wc-day-add-btn"
          onClick={() => onAddOnDate(key)}
          aria-label={btnLabel}
        >
          {btnLabel}
        </button>
      </div>
    </div>
  );
}

// ── Week day column ───────────────────────────────────────────────────────────
// Desktop: solid bordered box matching Month cell style, 7-column grid.
// Mobile (<640px): full-width stacked row — layout controlled purely via CSS.

function DayColumn({ day, dayJobs, isToday, onAddOnDate, onJobTap, onDayHeaderTap }) {
  const key = isoDate(day);
  const dayLabel = formatDayLabel(day);
  const hasJobs = dayJobs.length > 0;

  // Desktop: cap at 3 visible chips; mobile: show all (CSS removes the overflow chip via display:none).
  const DESKTOP_CAP = 3;
  const visibleJobs = dayJobs.slice(0, DESKTOP_CAP);
  const overflowCount = dayJobs.length - visibleJobs.length;

  const cellClasses = [
    'wc-week-cell',
    isToday ? 'wc-week-cell--today' : '',
    hasJobs ? 'wc-week-cell--has-jobs' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cellClasses}>
      {/* Tappable day header — drills to Day view */}
      <button
        type="button"
        className="wc-week-cell-header"
        onClick={() => onDayHeaderTap?.(key)}
        aria-label={`View ${dayLabel}`}
      >
        <span className="wc-day-name">{DAY_LABELS[day.getDay()]}</span>
        <span className={`wc-day-num${isToday ? ' wc-day-num--today' : ''}`}>{day.getDate()}</span>
      </button>

      {/* Job chips */}
      <div className="wc-week-cell-jobs">
        {visibleJobs.map(j => {
          const amount = j.total ?? j.amount;
          return (
            <button
              key={j.id || j.cloudId}
              type="button"
              className="wc-slot-job"
              title={jobLabel(j)}
              onClick={() => onJobTap?.(j)}
              aria-label={`Open ${jobLabel(j)}`}
            >
              <span className="wc-slot-job-label">{jobLabel(j).slice(0, 14)}{jobLabel(j).length > 14 ? '…' : ''}</span>
              {amount > 0 && (
                <span className="wc-slot-job-amount">
                  £{Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                </span>
              )}
            </button>
          );
        })}

        {/* Mobile-only: show all remaining chips (desktop shows overflow chip instead) */}
        {dayJobs.slice(DESKTOP_CAP).map(j => {
          const amount = j.total ?? j.amount;
          return (
            <button
              key={j.id || j.cloudId}
              type="button"
              className="wc-slot-job wc-slot-job--mobile-only"
              title={jobLabel(j)}
              onClick={() => onJobTap?.(j)}
              aria-label={`Open ${jobLabel(j)}`}
            >
              <span className="wc-slot-job-label">{jobLabel(j).slice(0, 14)}{jobLabel(j).length > 14 ? '…' : ''}</span>
              {amount > 0 && (
                <span className="wc-slot-job-amount">
                  £{Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                </span>
              )}
            </button>
          );
        })}

        {/* Desktop-only: +N more overflow chip */}
        {overflowCount > 0 && (
          <button
            type="button"
            className="wc-slot-overflow wc-slot-overflow--desktop-only"
            onClick={() => onDayHeaderTap?.(key)}
            aria-label={`View all ${dayJobs.length} jobs on ${dayLabel}`}
          >
            +{overflowCount} more
          </button>
        )}
      </div>

      {/* Ghost "+ Add" row — quiet, not a primary CTA */}
      <button
        type="button"
        className={`wc-week-cell-add-ghost${!hasJobs ? ' wc-week-cell-add-ghost--empty' : ''}`}
        onClick={() => onAddOnDate(key)}
        aria-label={`Add job on ${dayLabel}`}
      >
        <span className="wc-week-cell-add-text">
          {hasJobs ? '+ Add' : '+ Add a job'}
        </span>
      </button>
    </div>
  );
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({ year, month, byDay, todayKey, onCellTap }) {
  const cells = buildMonthGrid(year, month);

  return (
    <div className="wc-month-grid-wrap">
      {/* Weekday header row — Monday-first single letters */}
      <div className="wc-month-dow-row">
        {WEEK_LETTERS.map((l, i) => (
          <span key={i} className="wc-month-dow">{l}</span>
        ))}
      </div>
      <div className="wc-month-grid">
        {cells.map(({ date, inMonth }) => {
          const key = isoDate(date);
          const dayJobs = byDay[key] || [];
          const isToday = key === todayKey;
          const hasJobs = dayJobs.length > 0;

          // Up to 2 dots shown; if >3 jobs show 2 dots + ·N count
          const dotCount = Math.min(2, dayJobs.length);
          const overflowDots = dayJobs.length > 3 ? dayJobs.length - 2 : 0;

          return (
            <button
              key={key}
              type="button"
              className={[
                'wc-month-cell',
                isToday ? 'wc-month-cell--today' : '',
                !inMonth ? 'wc-month-cell--out' : '',
                hasJobs ? 'wc-month-cell--has-jobs' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onCellTap(key)}
              aria-label={`${formatDayLabel(date)}${hasJobs ? `, ${dayJobs.length} job${dayJobs.length === 1 ? '' : 's'}` : ''}`}
            >
              <span className="wc-month-cell-num">{date.getDate()}</span>

              {/* Desktop: up to 3 truncated labels (CSS hides these on mobile) */}
              {inMonth && dayJobs.length > 0 && (
                <div className="wc-month-cell-labels">
                  {dayJobs.slice(0, 3).map(j => (
                    <span key={j.id || j.cloudId} className="wc-month-cell-label">
                      {jobLabel(j).slice(0, 12)}{jobLabel(j).length > 12 ? '…' : ''}
                    </span>
                  ))}
                  {dayJobs.length > 3 && (
                    <span className="wc-month-cell-more">+{dayJobs.length - 3} more</span>
                  )}
                </div>
              )}

              {/* Mobile: coloured dots (CSS hides on desktop) */}
              {inMonth && dayJobs.length > 0 && (
                <div className="wc-month-cell-dots" aria-hidden="true">
                  {Array.from({ length: dotCount }).map((_, i) => (
                    <span key={i} className="wc-month-dot" />
                  ))}
                  {overflowDots > 0 && (
                    <span className="wc-month-dot-count">·{overflowDots}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── WorkCalendar ──────────────────────────────────────────────────────────────

export default function WorkCalendar({ jobs = [], onNewJobOnDate, onJobTap }) {
  // All hooks must sit above any early return (lesson from PR #125).
  const [calView, setCalView] = useState(getPersistedCalView);
  const [focusedDate, setFocusedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const datePickerRef = useRef(null);

  const todayKey = isoDate(new Date());
  const byDay = groupByDay(jobs);
  const unscheduled = jobs.filter(isUnscheduled);

  const switchCalView = useCallback((v) => {
    setCalView(v);
    persistCalView(v);
    logTelemetry('calendar_view_switch', { view: v });
  }, []);

  const handleAddOnDate = useCallback((dateKey) => {
    logTelemetry('calendar_add_tap', { date: dateKey, view: calView });
    onNewJobOnDate(dateKey);
  }, [calView, onNewJobOnDate]);

  // Week helpers
  const week = buildWeekForDate(focusedDate);
  const weekLabel = `W/c ${DAY_LABELS[week[0].getDay()]} ${week[0].getDate()} ${MONTH_SHORT[week[0].getMonth()]}`;

  // Month helpers
  const monthYear = `${MONTH_NAMES[focusedDate.getMonth()]} ${focusedDate.getFullYear()}`;

  // Day nav
  const stepDay = (delta) => setFocusedDate(d => {
    const next = new Date(d);
    next.setDate(d.getDate() + delta);
    return next;
  });

  // Week nav — step by 7 days
  const stepWeek = (delta) => setFocusedDate(d => {
    const next = new Date(d);
    next.setDate(d.getDate() + delta * 7);
    return next;
  });

  // Month nav
  const stepMonth = (delta) => setFocusedDate(d => {
    const next = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    return next;
  });

  const goToToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setFocusedDate(d);
  };

  const openDatePicker = () => {
    if (datePickerRef.current) {
      datePickerRef.current.showPicker?.();
      datePickerRef.current.click();
    }
  };

  const onPickerChange = (iso) => {
    if (!iso) return;
    setFocusedDate(parseIso(iso));
  };

  // When a month-grid cell is tapped → switch to Day view for that date
  const handleMonthCellTap = (iso) => {
    setFocusedDate(parseIso(iso));
    switchCalView('day');
  };

  // When a week-view day header is tapped → switch to Day view for that date
  const handleWeekDayHeaderTap = (iso) => {
    setFocusedDate(parseIso(iso));
    switchCalView('day');
  };

  return (
    <div className="work-calendar">
      {/* View toggle header */}
      <div className="wc-view-toggle" role="group" aria-label="Calendar view">
        <button
          className={`wc-view-btn${calView === 'day' ? ' wc-view-btn--active' : ''}`}
          onClick={() => switchCalView('day')}
          aria-pressed={calView === 'day'}
        >
          Day
        </button>
        <button
          className={`wc-view-btn${calView === 'week' ? ' wc-view-btn--active' : ''}`}
          onClick={() => switchCalView('week')}
          aria-pressed={calView === 'week'}
        >
          Week
        </button>
        <button
          className={`wc-view-btn${calView === 'month' ? ' wc-view-btn--active' : ''}`}
          onClick={() => switchCalView('month')}
          aria-pressed={calView === 'month'}
        >
          Month
        </button>
      </div>

      {/* Hidden native date picker — triggered programmatically */}
      <div style={{ position: 'relative', height: 0, overflow: 'hidden' }}>
        <DatePickerTrigger
          triggerRef={datePickerRef}
          value={isoDate(focusedDate)}
          onChange={onPickerChange}
        />
      </div>

      {/* Per-view nav header */}
      {calView === 'day' && (
        <NavHeader
          label={formatDayLabel(focusedDate)}
          onPrev={() => stepDay(-1)}
          onNext={() => stepDay(1)}
          onPickDate={openDatePicker}
          onToday={goToToday}
          prevAriaLabel="Previous day"
          nextAriaLabel="Next day"
        />
      )}
      {calView === 'week' && (
        <NavHeader
          label={weekLabel}
          onPrev={() => stepWeek(-1)}
          onNext={() => stepWeek(1)}
          onPickDate={openDatePicker}
          onToday={goToToday}
          prevAriaLabel="Previous week"
          nextAriaLabel="Next week"
        />
      )}
      {calView === 'month' && (
        <NavHeader
          label={monthYear}
          onPrev={() => stepMonth(-1)}
          onNext={() => stepMonth(1)}
          onPickDate={openDatePicker}
          onToday={goToToday}
          prevAriaLabel="Previous month"
          nextAriaLabel="Next month"
        />
      )}

      {/* Unscheduled strip — shown on all views */}
      <UnscheduledStrip jobs={unscheduled} />

      {/* View body */}
      {calView === 'day' && (
        <DayView
          focusedDate={focusedDate}
          byDay={byDay}
          todayKey={todayKey}
          onAddOnDate={handleAddOnDate}
          onJobTap={onJobTap}
        />
      )}

      {calView === 'week' && (
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
                onJobTap={onJobTap}
                onDayHeaderTap={handleWeekDayHeaderTap}
              />
            );
          })}
        </div>
      )}

      {calView === 'month' && (
        <MonthView
          year={focusedDate.getFullYear()}
          month={focusedDate.getMonth()}
          byDay={byDay}
          todayKey={todayKey}
          onCellTap={handleMonthCellTap}
        />
      )}
    </div>
  );
}
