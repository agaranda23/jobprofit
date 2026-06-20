/**
 * importParser.js — pure CSV/Excel parsing + normalisation for the onboarding import.
 *
 * Designed to be completely self-contained and unit-testable — no React, no DOM APIs,
 * no Supabase. The UI component calls these functions and owns all side effects.
 *
 * Public API:
 *   parseSpreadsheetFile(file)        → Promise<ParseResult>
 *   guessColumnMapping(headers)       → ColumnMapping
 *   applyMapping(rows, headers, map)  → { importable, skipped, exactDupeCount }
 *   normaliseStatus(raw)              → canonical stage string
 *   normaliseAmount(raw)              → number | null
 *   IMPORT_ROW_LIMIT                  → 500
 *
 * ParseResult:
 *   { headers: string[], rows: string[][], totalRows: number, truncated: boolean }
 *
 * ColumnMapping:
 *   { customer: number|null, amount: number|null, date: number|null, status: number|null }
 *   (column indices into the headers/rows arrays; null = not mapped)
 *
 * ApplyResult:
 *   {
 *     importable: ImportRow[],   — rows that passed all guards
 *     skipped: SkippedRow[],     — rows dropped with reasons
 *     exactDupeCount: number,    — byte-identical rows collapsed
 *   }
 *
 * ImportRow:
 *   { customer, amount, date, status, rawRowIndex }
 *   (amount is a number|null; status is a canonical stage string)
 *
 * SkippedRow:
 *   { rowIndex: number, reason: string }
 *
 * Reconciliation invariant (enforced as a unit test):
 *   importable.length + skipped.length + exactDupeCount === totalDataRows
 */

export const IMPORT_ROW_LIMIT = 500;

// ── Status normalisation ──────────────────────────────────────────────────────

/**
 * Map of keyword fragments → canonical stage.
 * Rules are checked in order; first match wins.
 * Fragments are stripped of punctuation/whitespace and lowercased before matching.
 */
const STATUS_RULES = [
  // Paid first — "paid" is also contained in "awaiting payment", so match
  // complete-contains before partial matches.
  [/paid|complete|done|settled/,                'Paid'],
  [/overdue|late|chase/,                         'Overdue'],
  [/invoice|sent|awaiting|owed|due/,             'Invoiced'],
  [/book|scheduled|on|active|progress|wip/,      'On'],
  [/quote|estimate/,                      'Quoted'],
  [/lead|enquiry|new/,                           'Lead'],
];

/**
 * Normalise a free-text status value from a spreadsheet cell to a canonical stage.
 * Strips punctuation and whitespace, applies case-insensitive keyword rules.
 * Unrecognised/blank → 'On' (the safe default for an active live job).
 *
 * @param {string|null|undefined} raw
 * @returns {'Lead'|'Quoted'|'On'|'Invoiced'|'Overdue'|'Paid'}
 */
export function normaliseStatus(raw) {
  if (!raw) return 'On';
  // Strip everything that isn't alphanumeric, then lowercase.
  const clean = String(raw).replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().trim();
  if (!clean) return 'On';
  for (const [pattern, stage] of STATUS_RULES) {
    if (pattern.test(clean)) return stage;
  }
  return 'On';
}

// ── Amount normalisation ──────────────────────────────────────────────────────

/**
 * Normalise a free-text amount cell to a number, or null when it cannot be parsed.
 * Strips £, $, commas, and spaces. Parses the leading numeric portion.
 * A non-numeric string ("approx £400") → 400. An empty/NaN string → null.
 * Returns null (not 0) so the caller knows this is a "no price yet" job.
 *
 * @param {string|number|null|undefined} raw
 * @returns {number|null}
 */
export function normaliseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  // Strip currency symbols, commas, spaces, then try a leading number parse.
  const stripped = String(raw).replace(/[£$,\s]/g, '');
  // Try parsing a leading number (e.g. "400approx" → 400, "approx400" → NaN)
  const n = parseFloat(stripped);
  return isFinite(n) ? n : null;
}

// ── Totals-row detection ──────────────────────────────────────────────────────

/**
 * Returns true when a row looks like a totals/summary row that should be skipped.
 * Matches against "customer" cell when customer is mapped, and falls back to
 * scanning all cells when customer is not mapped (or customer cell is blank but
 * amount cell is present — the common "blank customer, total amount" pattern).
 *
 * @param {string[]} cells — raw cell values for the row
 * @param {number|null} customerCol
 * @param {number|null} amountCol
 * @returns {boolean}
 */
export function isTotalsRow(cells, customerCol, amountCol) {
  const TOTALS_PATTERN = /\b(total|subtotal|sub-total|sum|grand\s*total|totals)\b/i;

  // Pattern 1: customer cell blank but amount cell has a value → likely a totals row.
  if (customerCol !== null && amountCol !== null) {
    const custCell = (cells[customerCol] ?? '').trim();
    const amtCell  = (cells[amountCol]  ?? '').trim();
    if (!custCell && amtCell) return true;
  }

  // Pattern 2: customer cell matches a totals keyword.
  if (customerCol !== null) {
    const custCell = (cells[customerCol] ?? '').trim();
    if (TOTALS_PATTERN.test(custCell)) return true;
  }

  // Pattern 3: any cell in the row matches a totals keyword (covers sheets where
  // the totals label appears in a column that wasn't mapped as customer).
  for (const cell of cells) {
    if (TOTALS_PATTERN.test((cell ?? '').trim())) return true;
  }

  return false;
}

// ── Header detection / column mapping ────────────────────────────────────────

/**
 * The four target fields we can map from spreadsheet headers.
 * Each entry lists the keywords to search for (case-insensitive contains match).
 */
const COLUMN_RULES = [
  { field: 'customer', keywords: ['customer', 'client', 'name', 'who'] },
  { field: 'amount',   keywords: ['amount', 'total', 'price', 'value', '£', 'quote', 'invoice'] },
  { field: 'date',     keywords: ['date', 'when', 'day'] },
  { field: 'status',   keywords: ['status', 'stage', 'state', 'paid'] },
];

/**
 * Auto-guess the best column mapping from a headers array.
 * Returns column indices (0-based); null when no match found.
 * First-match wins per field; each column index is only used once
 * (earlier fields in COLUMN_RULES take priority over later ones).
 *
 * @param {string[]} headers
 * @returns {{ customer: number|null, amount: number|null, date: number|null, status: number|null }}
 */
export function guessColumnMapping(headers) {
  const mapping = { customer: null, amount: null, date: null, status: null };
  const usedCols = new Set();

  for (const { field, keywords } of COLUMN_RULES) {
    for (let i = 0; i < headers.length; i++) {
      if (usedCols.has(i)) continue;
      const h = (headers[i] ?? '').toLowerCase().trim();
      if (!h) continue;
      const matched = keywords.some(kw => h.includes(kw.toLowerCase()));
      if (matched) {
        mapping[field] = i;
        usedCols.add(i);
        break;
      }
    }
  }

  return mapping;
}

// ── No-header detection ───────────────────────────────────────────────────────

/**
 * Heuristic: if row 1 looks like data rather than headers (e.g. all cells are
 * numeric, or cells match date/amount patterns rather than labels), return true
 * so the caller can offer "treat first row as data."
 *
 * A row is considered "looks like data" when FEWER than 2 of its non-empty cells
 * look like text labels (2+ words, starts with a letter, no digits dominating).
 *
 * @param {string[]} firstRow
 * @returns {boolean}
 */
export function looksLikeDataRow(firstRow) {
  const nonEmpty = firstRow.filter(c => (c ?? '').trim() !== '');
  if (nonEmpty.length === 0) return true;

  // A "header-like" cell has at least one letter and doesn't look like a number or date.
  const headerLike = nonEmpty.filter(c => {
    const s = c.trim();
    if (!s) return false;
    if (/^\d/.test(s)) return false;          // starts with digit → probably data
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) return false; // date pattern
    if (/^[£$][\d,.]/.test(s)) return false;  // currency value
    return /[a-zA-Z]/.test(s);               // has at least one letter
  });

  return headerLike.length < 2;
}

// ── Duplicate detection ───────────────────────────────────────────────────────

/**
 * Returns a canonical string key for a row that can be used to detect
 * byte-identical duplicates. Two rows are "exact dupes" only when all four
 * mapped fields produce identical normalised values.
 *
 * @param {string} customer
 * @param {string} amount
 * @param {string} date
 * @param {string} status
 * @returns {string}
 */
function rowKey(customer, amount, date, status) {
  return JSON.stringify([customer, amount, date, status]);
}

// ── Main apply function ───────────────────────────────────────────────────────

/**
 * Apply a column mapping to parsed rows, producing the final importable set
 * and a full skipped-row report.
 *
 * @param {string[][]} rows        — raw data rows (no header row; indices are 1-based relative to original sheet, so pass rowOffset)
 * @param {string[]}   headers     — header strings (for column reference only)
 * @param {{ customer: number|null, amount: number|null, date: number|null, status: number|null }} mapping
 * @param {number}     [rowOffset=2] — the 1-based row number of the first data row in the original sheet (for error messages)
 * @returns {{ importable: ImportRow[], skipped: SkippedRow[], exactDupeCount: number }}
 */
export function applyMapping(rows, headers, mapping, rowOffset = 2) {
  const importable = [];
  const skipped    = [];
  let exactDupeCount = 0;

  const seenKeys = new Map(); // key → first-seen rowIndex (for dupe detection)

  for (let i = 0; i < rows.length; i++) {
    const cells    = rows[i] ?? [];
    const rowIndex = i + rowOffset; // human-readable 1-based row number

    // ── Guard: totals/subtotal row ──────────────────────────────────────────
    if (isTotalsRow(cells, mapping.customer, mapping.amount)) {
      skipped.push({ rowIndex, reason: 'Looked like a totals or summary row' });
      continue;
    }

    // ── Guard: blank row (all empty cells) ─────────────────────────────────
    const allBlank = cells.every(c => (c ?? '').trim() === '');
    if (allBlank) {
      skipped.push({ rowIndex, reason: 'Row was blank' });
      continue;
    }

    // ── Customer (required) ─────────────────────────────────────────────────
    const rawCustomer = mapping.customer !== null ? (cells[mapping.customer] ?? '').trim() : '';
    if (!rawCustomer) {
      skipped.push({ rowIndex, reason: 'No customer name after mapping' });
      continue;
    }

    // ── Amount (optional) ───────────────────────────────────────────────────
    const rawAmount   = mapping.amount !== null ? (cells[mapping.amount] ?? '') : '';
    const amount      = normaliseAmount(rawAmount); // null = no price yet — valid

    // ── Date (optional) ─────────────────────────────────────────────────────
    const rawDate = mapping.date !== null ? (cells[mapping.date] ?? '').trim() : '';
    const date    = rawDate || null;

    // ── Status (optional) ───────────────────────────────────────────────────
    const rawStatus = mapping.status !== null ? (cells[mapping.status] ?? '') : '';
    const status    = normaliseStatus(rawStatus);

    // ── Exact-dupe detection ────────────────────────────────────────────────
    // Exact dupes are reported separately from the "skipped" list (they appear
    // in the summary UI as a distinct sub-count, not as individual skipped rows).
    // The reconciliation invariant is: importable + skipped + exactDupeCount === totalDataRows.
    const key = rowKey(rawCustomer, rawAmount, rawDate, rawStatus);
    if (seenKeys.has(key)) {
      exactDupeCount++;
      continue;
    }
    seenKeys.set(key, rowIndex);

    importable.push({
      customer:    rawCustomer,
      amount,
      date,
      status,
      rawRowIndex: rowIndex,
    });
  }

  return { importable, skipped, exactDupeCount };
}

// ── File parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a CSV string into [headers, ...rows] where every row is a string[].
 * Handles quoted fields containing commas and newlines.
 * RFC 4180-compatible.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvText(text) {
  // Normalise line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    if (inQuote) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          // Escaped quote
          field += '"';
          i += 2;
        } else {
          inQuote = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  row.push(field);
  if (row.some(c => c !== '')) rows.push(row);

  return rows;
}

/**
 * Parse a File object (CSV or Excel) into a ParseResult.
 * CSV is parsed by this module's own parseCsvText (no extra dep).
 * Excel (.xls/.xlsx) is parsed by lazy-loading `read-excel-file` — the parser
 * is only imported when the user actually drops an Excel file, so it never
 * affects first-paint bundle size.
 *
 * ParseResult:
 *   {
 *     headers:    string[],    — header row (row 1 of the sheet)
 *     rows:       string[][],  — data rows (row 2+), capped at IMPORT_ROW_LIMIT
 *     totalRows:  number,      — total data rows before cap
 *     truncated:  boolean,     — true when the file exceeded IMPORT_ROW_LIMIT
 *     firstRowIsData: boolean, — true when row 1 looks like data, not headers
 *   }
 *
 * @param {File} file
 * @returns {Promise<ParseResult>}
 */
export async function parseSpreadsheetFile(file) {
  const name = file.name || '';
  const ext  = name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    return _parseCsv(file);
  }

  if (ext === 'xls' || ext === 'xlsx') {
    return _parseExcel(file);
  }

  throw Object.assign(new Error(`Unsupported file type: .${ext}`), { code: 'WRONG_TYPE', ext });
}

async function _parseCsv(file) {
  const text = await file.text();
  if (!text.trim()) {
    throw Object.assign(new Error('Empty file'), { code: 'EMPTY' });
  }
  const allRows = parseCsvText(text);
  return _buildParseResult(allRows);
}

async function _parseExcel(file) {
  // Lazy-load the Excel parser — never touches the main bundle.
  let readXlsxFile;
  try {
    const mod = await import('read-excel-file/browser');
    // read-excel-file/browser uses a default export
    readXlsxFile = mod.default ?? mod.readXlsxFile ?? mod;
  } catch (importErr) {
    throw Object.assign(
      new Error('Could not load the Excel parser. Try re-saving your file as CSV.'),
      { code: 'PARSER_LOAD_FAILED', cause: importErr }
    );
  }

  let rawRows;
  try {
    rawRows = await readXlsxFile(file);
  } catch (parseErr) {
    throw Object.assign(
      new Error("We couldn't open that file. Try re-saving it as CSV and dropping it in again."),
      { code: 'CORRUPT', cause: parseErr }
    );
  }

  // read-excel-file returns mixed types (numbers, Date objects, strings, null).
  // Flatten everything to strings so the rest of the pipeline is type-uniform.
  const stringRows = (rawRows || []).map(row =>
    (row || []).map(cell => {
      if (cell === null || cell === undefined) return '';
      if (cell instanceof Date) {
        // Format as YYYY-MM-DD for consistency
        try {
          return cell.toISOString().slice(0, 10);
        } catch {
          return '';
        }
      }
      return String(cell);
    })
  );

  if (stringRows.length === 0) {
    throw Object.assign(new Error('Empty file'), { code: 'EMPTY' });
  }

  return _buildParseResult(stringRows);
}

/**
 * Convert raw string[][] (all rows) into a ParseResult.
 * Separates headers from data rows and applies the row cap.
 *
 * @param {string[][]} allRows
 * @returns {ParseResult}
 */
function _buildParseResult(allRows) {
  if (allRows.length === 0) {
    throw Object.assign(new Error('Empty file'), { code: 'EMPTY' });
  }

  const headers  = allRows[0] ?? [];
  const dataRows = allRows.slice(1);

  const firstRowIsData = looksLikeDataRow(headers);

  const totalRows = dataRows.length;
  const truncated = totalRows > IMPORT_ROW_LIMIT;
  const rows = truncated ? dataRows.slice(0, IMPORT_ROW_LIMIT) : dataRows;

  return { headers, rows, totalRows, truncated, firstRowIsData };
}
