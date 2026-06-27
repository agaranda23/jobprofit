/**
 * taxYear.js — UK tax-year helpers.
 *
 * The UK tax year runs 6 Apr → 5 Apr the following calendar year.
 * Examples:
 *   2025/26 = 6 Apr 2025 → 5 Apr 2026
 *   2024/25 = 6 Apr 2024 → 5 Apr 2025
 *
 * taxYearFor(dateStr) is the single source of truth used by the Documents
 * overlay filter, the tax subtitle, and the accountant export. Unit-tested
 * including the 5 Apr / 6 Apr boundary.
 */

/**
 * Returns the UK tax year label (e.g. "2025/26") for a given date.
 *
 * @param {string|Date} date — ISO date string ("YYYY-MM-DD") or Date object
 * @returns {string}         — "YYYY/YY" label, empty string if date is invalid
 */
export function taxYearFor(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';

  const year  = d.getFullYear();
  const month = d.getMonth() + 1; // 1-based
  const day   = d.getDate();

  // On or after 6 Apr → this calendar year is the *start* of the tax year.
  // Before 6 Apr → the previous calendar year is the start.
  const startYear = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1;
  const endYear   = startYear + 1;

  return `${startYear}/${String(endYear).slice(2)}`;
}

/**
 * Returns the start Date (inclusive) of the UK tax year that contains `date`.
 * Boundary: 6 Apr 00:00:00 local time.
 *
 * @param {string|Date} date
 * @returns {Date|null}
 */
export function taxYearStart(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;

  const year  = d.getFullYear();
  const month = d.getMonth() + 1;
  const day   = d.getDate();

  const startYear = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1;
  return new Date(startYear, 3, 6); // month index 3 = April
}

/**
 * Returns the end Date (inclusive) of the UK tax year that contains `date`.
 * Boundary: 5 Apr 23:59:59 local time.
 *
 * @param {string|Date} date
 * @returns {Date|null}
 */
export function taxYearEnd(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;

  const year  = d.getFullYear();
  const month = d.getMonth() + 1;
  const day   = d.getDate();

  const startYear = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1;
  const endYear   = startYear + 1;
  return new Date(endYear, 3, 5, 23, 59, 59); // 5 Apr
}

/**
 * Returns true if `date` falls within the UK tax-year period that starts on
 * `refDate` (i.e. the same label as taxYearFor(refDate)).
 *
 * Used by the filter row to bucket receipts into "this tax year."
 *
 * @param {string|Date} date    — receipt date to test
 * @param {string|Date} refDate — any date in the target tax year (usually today)
 * @returns {boolean}
 */
export function isInTaxYear(date, refDate = new Date()) {
  const label    = taxYearFor(refDate);
  const testLabel = taxYearFor(date);
  return !!label && label === testLabel;
}

/**
 * Returns the start and end of the calendar month containing `date`.
 *
 * @param {string|Date} date
 * @returns {{ start: Date, end: Date }|null}
 */
export function monthBounds(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

/**
 * Returns the start and end of the calendar quarter containing `date`.
 * UK quarters: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec.
 *
 * @param {string|Date} date
 * @returns {{ start: Date, end: Date }|null}
 */
export function quarterBounds(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const month  = d.getMonth(); // 0-based
  const qStart = Math.floor(month / 3) * 3;
  const start  = new Date(d.getFullYear(), qStart, 1);
  const end    = new Date(d.getFullYear(), qStart + 3, 0, 23, 59, 59);
  return { start, end };
}

/**
 * Returns true if `receiptDate` falls in the period specified by `period`.
 *
 * @param {string} receiptDate — ISO date string ("YYYY-MM-DD")
 * @param {'month'|'quarter'|'taxyear'|'all'} period
 * @param {Date} now — reference date (default = today)
 * @returns {boolean}
 */
export function receiptInPeriod(receiptDate, period, now = new Date()) {
  if (!receiptDate || period === 'all') return true;
  const d = new Date(receiptDate);
  if (isNaN(d.getTime())) return true; // don't hide receipts with bad dates

  if (period === 'month') {
    const b = monthBounds(now);
    return d >= b.start && d <= b.end;
  }
  if (period === 'quarter') {
    const b = quarterBounds(now);
    return d >= b.start && d <= b.end;
  }
  if (period === 'taxyear') {
    return isInTaxYear(d, now);
  }
  return true;
}
