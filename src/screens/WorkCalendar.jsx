/**
 * WorkCalendar — week/day/month calendar for the Work tab.
 *
 * Views:
 *   - Week (default): vertical stacked rows, today-anchored rolling 7-day window.
 *   - Day:  single-day agenda list (no time slots — jobs are date-only).
 *   - Month: standard month grid, tapping a cell drills to Day view.
 *
 * Data contract: reads `jobs` array from props — same source as WorkScreen.
 * No parallel Supabase queries.
 *
 * Persists the active Day/Week/Month sub-mode in localStorage under 'jp.workCalView'.
 * Focused date is kept in component state so Day/Week/Month stay coherent when switching.
 *
 * Week view — rolling window:
 *   Row 1 = the window's start day (today when first loaded or after Today pill).
 *   Prev/Next chevrons shift the window ±7 days. The "Today" pill resets to today-anchored.
 *   Header label shows "Sun 7 – Sat 13 Jun" (date range, single month) or
 *   "Sun 31 May – Sat 6 Jun" (cross-month). No "W/c" prefix — it no longer fits a
 *   rolling window that can start on any day.
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

/** Build a rolling 7-day window starting at `anchor` (inclusive). */
function buildRollingWeek(anchor) {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/**
 * Build the week-range label for the nav header.
 * Same-month: "Sun 7 – Sat 13 Jun"
 * Cross-month: "Sun 31 May – Sat 6 Jun"
 */
function buildWeekRangeLabel(days) {
  const first = days[0];
  const last  = days[days.length - 1];
  const firstDayName = DAY_LABELS[first.getDay()];
  const lastDayName  = DAY_LABELS[last.getDay()];
  const firstDate    = first.getDate();
  const lastDate     = last.getDate();
  const lastMonth    = MONTH_SHORT[last.getMonth()];

  if (first.getMonth() === last.getMonth()) {
    return `${firstDayName} ${firstDate} – ${lastDayName} ${lastDate} ${lastMonth}`;
  }
  const firstMonth = MONTH_SHORT[first.getMonth()];
  return `${firstDayName} ${firstDate} ${firstMonth} – ${lastDayName} ${lastDate} ${lastMonth}`;
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

/**
 * Derive a simple display stage label from a job for the calendar pill.
 * Uses the canonical `status` field first (fast path), then legacy field fallbacks.
 * Does NOT compute date-driven Overdue — the manual `overdue` flag is honoured.
 * Mirrors the logic in WorkScreen.deriveDisplayStatus and JobDetailDrawer.
 */
function deriveCalStage(job) {
  if (job.status === 'lead')         return 'Lead';
  if (job.status === 'quoted')       return 'Quoted';
  if (job.status === 'paid')         return 'Paid';
  if (job.status === 'active' || job.status === 'complete') return 'On';
  if (job.status === 'invoice_sent') {
    if (job.overdue === true) return 'Overdue';
    return 'Invoiced';
  }
  // Legacy fallbacks
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  if (job.invoiceStatus === 'invoiced') return 'Invoiced';
  if (job.jobStatus === 'complete' || job.jobStatus === 'active') return 'On';
  return 'Lead';
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
          onClick={() => onAddOnDate?.(key)}
          aria-label={btnLabel}
        >
          {btnLabel}
        </button>
      </div>
    </div>
  );
}

// ── Week view — vertical stacked rows ─────────────────────────────────────────
// One layout for both mobile and desktop. Desktop's extra width shows inline
// address snippet via CSS at ≥640px — no JS branching between widths.

/** Stage pill for the vertical week row. */
function StagePill({ stage }) {
  if (!stage || stage === 'Lead') return null;
  const cls = {
    Quoted:   'vw-pill--quoted',
    On:       'vw-pill--on',
    Invoiced: 'vw-pill--invoiced',
    Overdue:  'vw-pill--overdue',
    Paid:     'vw-pill--paid',
  }[stage] ?? '';
  return <span className={`vw-pill ${cls}`}>{stage}</span>;
}

/** A single job row inside a vertical week day. */
function WeekJobRow({ job, onJobTap }) {
  const label    = jobLabel(job);
  const amount   = job.total ?? job.amount;
  const stage    = deriveCalStage(job);
  // customer shown in meta if it differs from the summary/name
  const customer = (job.customer && job.customer !== job.summary) ? job.customer : null;
  // address shown on desktop via CSS .vw-job-meta-address (≥640px only)
  const address  = job.address || null;

  return (
    <button
      type="button"
      className="vw-job"
      onClick={() => onJobTap?.(job)}
      aria-label={`Open ${label}`}
    >
      <span className="vw-job-main">
        <span className="vw-job-title">{label}</span>
        {(customer || address) && (
          <span className="vw-job-meta">
            {customer && <span className="vw-job-meta-customer">{customer}</span>}
            {customer && address && <span className="vw-job-meta-dot" aria-hidden="true"> · </span>}
            {address && <span className="vw-job-meta-address">{address}</span>}
          </span>
        )}
      </span>
      <span className="vw-job-right">
        {amount > 0 && (
          <span className="vw-amount">
            £{Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
          </span>
        )}
        <StagePill stage={stage} />
      </span>
    </button>
  );
}

/** A single full-width day row in the vertical week list. */
function WeekDayRow({ day, dayJobs, isToday, onAddOnDate, onJobTap, onDayHeaderTap }) {
  const key      = isoDate(day);
  const dayLabel = formatDayLabel(day);
  const hasJobs  = dayJobs.length > 0;

  const rowClasses = [
    'vw-day',
    isToday  ? 'vw-day--today'    : '',
    hasJobs  ? 'vw-day--has-jobs' : '',
  ].filter(Boolean).join(' ');

  // Per-day subtotal — only shown when >1 job
  const dayTotal = hasJobs
    ? dayJobs.reduce((sum, j) => sum + (Number(j.total ?? j.amount) || 0), 0)
    : 0;

  return (
    <div className={rowClasses}>
      {/* Left date gutter — taps to Day view */}
      <button
        type="button"
        className="vw-gutter"
        onClick={() => onDayHeaderTap?.(key)}
        aria-label={`View ${dayLabel}`}
      >
        <span className="vw-dow">{DAY_LABELS[day.getDay()]}</span>
        <span className="vw-dom">{day.getDate()}</span>
        {isToday && <span className="vw-today-tag" aria-hidden="true">TODAY</span>}
      </button>

      {/* Right: day body */}
      <div className="vw-body">
        {hasJobs ? (
          <>
            {dayJobs.map(j => (
              <WeekJobRow key={j.id || j.cloudId} job={j} onJobTap={onJobTap} />
            ))}
            {dayJobs.length > 1 && (
              <div className="vw-day-foot">
                <span>{dayJobs.length} jobs</span>
                <span>
                  £{dayTotal.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                </span>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            className="vw-add-ghost"
            onClick={() => onAddOnDate?.(key)}
            aria-label={`Add job on ${dayLabel}`}
          >
            <span className="vw-add-plus" aria-hidden="true">+</span>
            Add a job
          </button>
        )}
      </div>
    </div>
  );
}

/** Week total strip — shown below the day rows. */
function WeekTotalStrip({ days, byDay, todayIsInWindow }) {
  let totalJobs   = 0;
  let totalAmount = 0;
  let daysWithJobs = 0;
  let openDays    = 0;

  for (const day of days) {
    const key  = isoDate(day);
    const jobs = byDay[key] || [];
    if (jobs.length > 0) {
      daysWithJobs++;
      totalJobs   += jobs.length;
      totalAmount += jobs.reduce((s, j) => s + (Number(j.total ?? j.amount) || 0), 0);
    } else {
      openDays++;
    }
  }

  const windowLabel = todayIsInWindow ? 'This week' : '7-day window';
  const jobsPart    = totalJobs === 0
    ? 'No jobs booked'
    : `${totalJobs} job${totalJobs === 1 ? '' : 's'}${daysWithJobs > 1 ? ` across ${daysWithJobs} days` : ''}`;
  const openPart    = openDays > 0 ? ` · ${openDays} open day${openDays === 1 ? '' : 's'}` : '';

  return (
    <div className="vw-week-total">
      <span className="vw-week-total-lbl">{windowLabel} · {jobsPart}{openPart}</span>
      <span className="vw-week-total-val">
        £{totalAmount.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
      </span>
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
  // weekWindowStart: the first day of the 7-day rolling window.
  // Initialised to today so today is always row 1 on first load.
  const [weekWindowStart, setWeekWindowStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
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
    onNewJobOnDate?.(dateKey);
  }, [calView, onNewJobOnDate]);

  // Rolling week window — 7 days from weekWindowStart
  const weekDays = buildRollingWeek(weekWindowStart);
  const weekLabel = buildWeekRangeLabel(weekDays);
  // Is today inside the current window?
  const todayInWindow = weekDays.some(d => isoDate(d) === todayKey);

  // Month helpers
  const monthYear = `${MONTH_NAMES[focusedDate.getMonth()]} ${focusedDate.getFullYear()}`;

  // Day nav
  const stepDay = (delta) => setFocusedDate(d => {
    const next = new Date(d);
    next.setDate(d.getDate() + delta);
    return next;
  });

  // Week nav — shift rolling window by 7 days
  const stepWeek = (delta) => setWeekWindowStart(d => {
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
    // Reset week window so today is row 1 again
    setWeekWindowStart(new Date(d));
  };

  const openDatePicker = () => {
    if (datePickerRef.current) {
      datePickerRef.current.showPicker?.();
      datePickerRef.current.click();
    }
  };

  const onPickerChange = (iso) => {
    if (!iso) return;
    const d = parseIso(iso);
    setFocusedDate(d);
    // In week view, jump the window start to the picked date
    if (calView === 'week') {
      setWeekWindowStart(new Date(d));
    }
  };

  // When a month-grid cell is tapped → switch to Day view for that date
  const handleMonthCellTap = (iso) => {
    setFocusedDate(parseIso(iso));
    switchCalView('day');
  };

  // When a week-view day gutter is tapped → switch to Day view for that date
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
          value={isoDate(calView === 'week' ? weekWindowStart : focusedDate)}
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
          prevAriaLabel="Previous 7 days"
          nextAriaLabel="Next 7 days"
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
        <div className="vw-list">
          {weekDays.map(day => {
            const key = isoDate(day);
            return (
              <WeekDayRow
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
          <WeekTotalStrip days={weekDays} byDay={byDay} todayIsInWindow={todayInWindow} />
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
