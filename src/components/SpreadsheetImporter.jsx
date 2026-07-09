/**
 * SpreadsheetImporter — self-contained onboarding import component.
 *
 * Implements SPEC 2 from JobProfit-Import-and-TableView-Spec.md.
 *
 * Self-contained by design: this component does NOT import from OnboardingWizard.
 * The wizard simply mounts it. A Settings → "Bring jobs across" entry point (v1.1)
 * is a one-line addition — mount <SpreadsheetImporter onImport={...} onDone={...} />.
 *
 * Sub-screens (controlled by `phase` state):
 *   'upload'   → A. Drop zone + file picker
 *   'mapping'  → B. Column mapping dropdowns
 *   'preview'  → C. Preview cards + skipped summary
 *   'summary'  → D. Post-import success/partial screen
 *
 * OUT OF SCOPE for v1 (documented here per spec):
 *   - Ongoing/recurring sync
 *   - Receipts/costs/photos/payments history/line items
 *   - Re-import into an already-populated account
 *   - Importing anything other than customers + open jobs
 *
 * Props:
 *   onImport(jobs: object[]) → Promise<{imported: number, failed: object[]}>
 *     Called with the full parsed job array at "Import N jobs" tap.
 *     The parent (OnboardingWizard / Settings) owns all Supabase writes.
 *   onDone()    — called when the user taps "See my jobs" on the summary screen.
 *   onSkip()    — called when the user taps "Skip — I'll add jobs as I go".
 *   logTelemetry(event, data?) — telemetry callback (pass the real logTelemetry).
 */

import { useCallback, useRef, useState } from 'react';
import {
  parseSpreadsheetFile,
  guessColumnMapping,
  applyMapping,
  IMPORT_ROW_LIMIT,
} from '../lib/importParser.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const ACCEPTED_EXTS = ['.csv', '.xls', '.xlsx'];

// Fields we map and the column-target labels shown in the dropdowns.
const MAPPING_FIELDS = [
  { field: 'customer', label: 'Customer name', required: true  },
  { field: 'amount',   label: 'Amount (£)',    required: false },
  { field: 'date',     label: 'Job date',      required: false },
  { field: 'status',   label: 'Stage / status',required: false },
];

const NONE_OPTION = { value: '__none__', label: '(none)' };

// ── Stage colours — canonical --stage-* pipeline palette (jobs-premium-pass
// fast-follow: import-preview palette). Values are var() references to
// index.css's single source of truth (StageStrip.jsx STAGE_TOKEN / index.css
// :root) rather than a duplicated hex ramp, so this preview card can never
// drift from the pipeline's colours again. Feeds the card's left-rail accent
// (--jt-hue) and, via the .jt-stage-label--* rules in index.css, the stage
// chip's border/background. Do NOT reintroduce hardcoded hex here — Quoted
// was mint-green, Overdue was red (#E5484D); Overdue is orange, Paid is the
// only green.
const STAGE_COLOURS = {
  Lead:     'var(--stage-lead)',
  Quoted:   'var(--stage-quoted)',
  On:       'var(--stage-on)',
  Invoiced: 'var(--stage-invoiced)',
  Overdue:  'var(--stage-overdue)',
  Paid:     'var(--stage-paid)',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAmount(amount) {
  if (amount === null || amount === undefined) return 'No price yet';
  return `£${Math.round(amount).toLocaleString('en-GB')}`;
}

function formatDate(date) {
  if (!date) return null;
  try {
    // Try ISO date (YYYY-MM-DD) first, then fall back to locale parse
    const d = new Date(date.includes('T') ? date : date + 'T00:00:00');
    if (isNaN(d.getTime())) return date; // unparseable → show raw
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return date;
  }
}

function isValidFile(file) {
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return ACCEPTED_EXTS.includes('.' + ext);
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * A preview card that mirrors the visual structure of the WorkScreen job tile (jt).
 * Used in the Preview phase to show "your spreadsheet becomes a live job" — the
 * teaching moment per SPEC 2 §2.C. Uses the same CSS classes as the pipeline.
 */
function PreviewJobCard({ customer, amount, date, status }) {
  const stageColour = STAGE_COLOURS[status] || STAGE_COLOURS.On;
  const formattedDate = formatDate(date);

  return (
    <div
      className="import-preview-card jt"
      style={{
        '--jt-hue': stageColour,
        '--jt-fill': '#1a2a3a',
        '--jt-ink': stageColour,
      }}
      role="article"
      aria-label={`Job preview for ${customer}`}
    >
      <div className="jt-head">
        <h3 className="jt-title">{customer}</h3>
        {/* Colour comes entirely from the .jt-stage-label--{stage} class (index.css) —
            no inline --chip-fill/--chip-ink hack needed; those rules already
            key off the same canonical --stage-{x} and --stage-tint-{x} tokens. */}
        <span
          className={`jt-stage-label jt-stage-label--${(status || 'on').toLowerCase()}`}
          aria-label={`Stage: ${status}`}
        >
          {status}
        </span>
      </div>
      <div className="jt-price">{formatAmount(amount)}</div>
      {formattedDate && (
        <div className="jt-signals">
          <span className="jt-signal-group">
            <span className="jt-meta-item jt-signal--mute">{formattedDate}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Expandable skipped-row list. Shows up to 20 items; "+ M more" for the rest.
 */
function SkippedList({ skipped, exactDupeCount }) {
  const [expanded, setExpanded] = useState(false);

  const total = skipped.length + exactDupeCount;
  if (total === 0) return null;

  const visible = expanded ? skipped.slice(0, 20) : skipped.slice(0, 5);
  const hiddenCount = skipped.length - visible.length;

  return (
    <div className="import-skipped">
      <button
        type="button"
        className="import-skipped-toggle"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide' : 'Show'} what we couldn't read
        {!expanded && ` (${total} row${total !== 1 ? 's' : ''})`}
      </button>

      {expanded && (
        <div className="import-skipped-list" role="list">
          {visible.map((row) => (
            <div key={row.rowIndex} className="import-skipped-item" role="listitem">
              <span className="import-skipped-row">Row {row.rowIndex}</span>
              <span className="import-skipped-reason">{row.reason}</span>
            </div>
          ))}
          {exactDupeCount > 0 && (
            <div className="import-skipped-item" role="listitem">
              <span className="import-skipped-row">—</span>
              <span className="import-skipped-reason">
                {exactDupeCount} exact duplicate row{exactDupeCount !== 1 ? 's' : ''} removed
              </span>
            </div>
          )}
          {hiddenCount > 0 && (
            <div className="import-skipped-more">+ {hiddenCount} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SpreadsheetImporter({ onImport, onDone, onSkip, logTelemetry: log }) {
  // ── Phase state ─────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('upload'); // 'upload' | 'mapping' | 'preview' | 'summary'

  // ── Upload phase ────────────────────────────────────────────────────────────
  const [dragOver, setDragOver]   = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [parseError, setParseError] = useState(null);
  const fileInputRef = useRef(null);

  // ── Parsed data ─────────────────────────────────────────────────────────────
  const [parseResult, setParseResult] = useState(null);
  // { headers, rows, totalRows, truncated, firstRowIsData }

  // ── Mapping phase ───────────────────────────────────────────────────────────
  const [mapping, setMapping]         = useState({ customer: null, amount: null, date: null, status: null });
  const [treatFirstAsData, setTreatFirstAsData] = useState(false);
  const [mappingError, setMappingError] = useState(null);

  // ── Preview phase ───────────────────────────────────────────────────────────
  const [applyResult, setApplyResult] = useState(null);
  // { importable, skipped, exactDupeCount }

  // ── Summary phase ───────────────────────────────────────────────────────────
  const [importedCount, setImportedCount] = useState(0);
  const [failedJobs, setFailedJobs]       = useState([]);
  const [importing, setImporting]         = useState(false);
  const [importError, setImportError]     = useState(null);

  // Preserve parsed set until user leaves summary (spec §6: don't lose before user leaves).
  const parsedJobsRef = useRef([]);

  // ── File processing ─────────────────────────────────────────────────────────

  const processFile = useCallback(async (file) => {
    if (!isValidFile(file)) {
      const ext = (file.name || '').split('.').pop().toUpperCase();
      setParseError(`We can read CSV or Excel. That looked like a .${ext} — try exporting as CSV.`);
      return;
    }

    setParseError(null);
    setParsing(true);
    log?.('import_file_selected');

    try {
      const result = await parseSpreadsheetFile(file);

      // Edge: empty file
      if (!result.rows.length && !result.firstRowIsData) {
        setParseError('This sheet looks empty — nothing to import.');
        setParsing(false);
        return;
      }

      setParseResult(result);

      // Effective headers (may be generic labels when first row looks like data)
      const effectiveHeaders = result.firstRowIsData
        ? result.headers.map((_, i) => `Column ${String.fromCharCode(65 + i)}`)
        : result.headers;

      const guessed = guessColumnMapping(effectiveHeaders);
      setMapping(guessed);
      setTreatFirstAsData(result.firstRowIsData);
      setParsing(false);
      setPhase('mapping');
    } catch (err) {
      setParsing(false);
      if (err.code === 'WRONG_TYPE') {
        setParseError(`We can read CSV or Excel. That looked like a .${err.ext} — try exporting as CSV.`);
      } else if (err.code === 'EMPTY') {
        setParseError('This sheet looks empty — nothing to import.');
      } else {
        setParseError("We couldn't open that file. Try re-saving it as CSV and dropping it in again.");
      }
    }
  }, [log]);

  // ── Drop zone handlers ──────────────────────────────────────────────────────

  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so the same file can be re-selected after an error
    e.target.value = '';
  }

  // ── Mapping → Preview ───────────────────────────────────────────────────────

  function handleConfirmMapping() {
    if (mapping.customer === null) {
      setMappingError('Pick which column is the customer name.');
      return;
    }
    setMappingError(null);

    // When first row looks like data, include it in the data rows
    const effectiveHeaders = treatFirstAsData
      ? (parseResult.headers.map((_, i) => `Column ${String.fromCharCode(65 + i)}`))
      : parseResult.headers;

    const dataRows = treatFirstAsData
      ? [parseResult.headers, ...parseResult.rows]
      : parseResult.rows;

    const result = applyMapping(dataRows, effectiveHeaders, mapping, treatFirstAsData ? 1 : 2);
    setApplyResult(result);
    log?.('import_mapping_confirmed');
    setPhase('preview');
  }

  // ── Import ──────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!applyResult?.importable?.length) return;

    const jobs = applyResult.importable.map(row => ({
      id:        crypto.randomUUID(),
      name:      row.customer,         // summary/job name = customer for imported jobs
      customer:  row.customer,
      amount:    row.amount,
      paid:      row.status === 'Paid',
      status:    deriveJobStatus(row.status),
      date:      row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
      createdAt: new Date().toISOString(),
      source:    'import',
    }));

    parsedJobsRef.current = jobs;
    setImporting(true);
    setImportError(null);

    try {
      const { imported, failed } = await onImport(jobs);
      setImportedCount(imported);
      setFailedJobs(failed || []);
      log?.('import_completed', {
        imported,
        skipped: applyResult.skipped.length,
        exact_dupes: applyResult.exactDupeCount,
      });
      setPhase('summary');
    } catch (err) {
      console.error('Import failed', err);
      setImportError('Something went wrong. Your sheet is still here — try again.');
    } finally {
      setImporting(false);
    }
  }

  async function handleRetryFailed() {
    if (!failedJobs.length) return;
    setImporting(true);
    setImportError(null);
    try {
      const { imported, failed } = await onImport(failedJobs);
      setImportedCount(c => c + imported);
      setFailedJobs(failed || []);
    } catch {
      setImportError('Still having trouble. Check your connection and try again.');
    } finally {
      setImporting(false);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Map canonical stage label to the job.status value that addJobToCloud expects.
   * Mirrors the status field conventions in store.js.
   */
  function deriveJobStatus(stage) {
    switch (stage) {
      case 'Lead':     return 'lead';
      case 'Quoted':   return 'lead';   // lead with quoteStatus=draft approximates Quoted
      case 'On':       return 'active';
      case 'Invoiced': return 'invoice_sent';
      case 'Overdue':  return 'invoice_sent'; // closest cloud status; overdue is derived
      case 'Paid':     return 'paid';
      default:         return 'active';
    }
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const effectiveHeaders = parseResult
    ? (treatFirstAsData
        ? parseResult.headers.map((_, i) => `Column ${String.fromCharCode(65 + i)}`)
        : parseResult.headers)
    : [];

  const columnOptions = [
    NONE_OPTION,
    ...effectiveHeaders
      .filter(h => h.trim())
      .map((h, i) => ({ value: String(i), label: h })),
  ];

  const previewCards  = applyResult?.importable?.slice(0, 3) ?? [];
  const importableCount = applyResult?.importable?.length ?? 0;
  const skippedCount    = (applyResult?.skipped?.length ?? 0);
  const dupeCount       = applyResult?.exactDupeCount ?? 0;

  const defaultedStatusCount = applyResult?.importable?.filter(r => {
    // The raw status col was blank/unrecognised and we defaulted to On
    return r.status === 'On';
  }).length ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── A. Upload ───────────────────────────────────────────────────────────────
  if (phase === 'upload') {
    return (
      <div className="import-phase">
        <div
          className={`import-dropzone${dragOver ? ' import-dropzone--active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="region"
          aria-label="File drop zone"
        >
          <div className="import-dropzone-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <polyline points="9 15 12 12 15 15"/>
            </svg>
          </div>
          <p className="import-dropzone-hint">Drop your spreadsheet here</p>
          <p className="import-dropzone-sub">CSV or Excel. We only read it once — nothing syncs after.</p>
          <label className="import-choose-btn" htmlFor="import-file-input">
            Choose file
            <input
              id="import-file-input"
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTS.join(',')}
              className="import-file-input-hidden"
              onChange={handleFileChange}
              aria-label="Choose a CSV or Excel file"
            />
          </label>
        </div>

        {parsing && (
          <p className="import-status-msg" role="status" aria-live="polite">
            Reading your sheet…
          </p>
        )}

        {parseError && (
          <p className="import-error" role="alert">{parseError}</p>
        )}

        <button
          type="button"
          className="import-skip-btn"
          onClick={onSkip}
        >
          Skip — I'll add jobs as I go
        </button>
      </div>
    );
  }

  // ── B. Column mapping ───────────────────────────────────────────────────────
  if (phase === 'mapping') {
    return (
      <div className="import-phase">
        <p className="import-phase-intro">
          We found <strong>{effectiveHeaders.length}</strong> column{effectiveHeaders.length !== 1 ? 's' : ''}. Tell us which is which.
        </p>

        {parseResult?.truncated && (
          <p className="import-truncation-warning" role="status">
            Your file has more than {IMPORT_ROW_LIMIT} rows. We'll bring across the first {IMPORT_ROW_LIMIT} — run import again for the rest.
          </p>
        )}

        {treatFirstAsData && (
          <p className="import-no-header-note" role="status">
            We couldn't find column headers — using generic labels. Map each column below.
          </p>
        )}

        <div className="import-mapping-fields">
          {MAPPING_FIELDS.map(({ field, label, required }) => {
            const currentVal = mapping[field] !== null ? String(mapping[field]) : '__none__';
            return (
              <div key={field} className="import-mapping-row">
                <label
                  className="import-mapping-label"
                  htmlFor={`import-map-${field}`}
                >
                  {label}
                  {required && <span className="import-required" aria-label="required"> *</span>}
                </label>
                <select
                  id={`import-map-${field}`}
                  className="import-mapping-select"
                  value={currentVal}
                  onChange={e => {
                    const v = e.target.value;
                    setMapping(m => ({ ...m, [field]: v === '__none__' ? null : Number(v) }));
                    if (field === 'customer') setMappingError(null);
                  }}
                  aria-required={required}
                >
                  {columnOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {mappingError && (
          <p className="import-error" role="alert">{mappingError}</p>
        )}

        <div className="import-footer">
          <button
            type="button"
            className="btn-primary"
            onClick={handleConfirmMapping}
            disabled={mapping.customer === null}
            aria-disabled={mapping.customer === null}
          >
            Continue
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ marginLeft: 6 }}>
              <path d="M6.75 4.5L11.25 9L6.75 13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            type="button"
            className="import-back-btn"
            onClick={() => {
              setParseResult(null);
              setMapping({ customer: null, amount: null, date: null, status: null });
              setMappingError(null);
              setPhase('upload');
            }}
          >
            Back
          </button>
        </div>

        <button
          type="button"
          className="import-skip-btn"
          onClick={onSkip}
        >
          Skip — I'll add jobs as I go
        </button>
      </div>
    );
  }

  // ── C. Preview ──────────────────────────────────────────────────────────────
  if (phase === 'preview') {
    return (
      <div className="import-phase">
        <p className="import-found-msg">
          We found <strong>{importableCount}</strong> job{importableCount !== 1 ? 's' : ''} we can bring across.
          {importableCount > 3 && ' Here’s a preview:'}
        </p>

        {/* First 3 rows as real JobProfit job cards — the teaching moment */}
        {previewCards.length > 0 && (
          <div className="import-preview-cards" aria-label="Preview of first jobs to be imported">
            {previewCards.map((row, i) => (
              <PreviewJobCard
                key={i}
                customer={row.customer}
                amount={row.amount}
                date={row.date}
                status={row.status}
              />
            ))}
          </div>
        )}

        {/* Skipped rows notice */}
        {(skippedCount > 0 || dupeCount > 0) && (
          <p className="import-skipped-notice">
            <strong>{skippedCount + dupeCount}</strong> row{(skippedCount + dupeCount) !== 1 ? 's' : ''} we couldn't read — we'll skip those.
          </p>
        )}

        {/* Expandable skipped list */}
        <SkippedList
          skipped={applyResult?.skipped ?? []}
          exactDupeCount={dupeCount}
        />

        {/* Status-defaulted notice */}
        {defaultedStatusCount > 0 && (
          <p className="import-status-note">
            We couldn't read the status on {defaultedStatusCount} job{defaultedStatusCount !== 1 ? 's' : ''} — we've set {defaultedStatusCount !== 1 ? 'them' : 'it'} to On. Change any in two taps.
          </p>
        )}

        {parseResult?.truncated && (
          <p className="import-truncation-warning">
            Your file had more than {IMPORT_ROW_LIMIT} rows — we're importing the first {IMPORT_ROW_LIMIT}. Run import again for the rest.
          </p>
        )}

        {importError && (
          <p className="import-error" role="alert">{importError}</p>
        )}

        <div className="import-footer">
          <button
            type="button"
            className="btn-primary"
            onClick={handleImport}
            disabled={importing || importableCount === 0}
            aria-disabled={importing || importableCount === 0}
          >
            {importing ? 'Importing…' : `Import ${importableCount} job${importableCount !== 1 ? 's' : ''}`}
          </button>
          <button
            type="button"
            className="import-back-btn"
            onClick={() => setPhase('mapping')}
            disabled={importing}
          >
            Back
          </button>
        </div>

        <button
          type="button"
          className="import-skip-btn"
          onClick={onSkip}
          disabled={importing}
        >
          Skip — I'll add jobs as I go
        </button>
      </div>
    );
  }

  // ── D. Post-import summary ──────────────────────────────────────────────────
  if (phase === 'summary') {
    const totalSkipped = skippedCount + dupeCount;

    return (
      <div className="import-phase import-phase--summary">
        <div className="import-summary-icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>

        <h2 className="import-summary-title">
          {importedCount} job{importedCount !== 1 ? 's' : ''} imported.
        </h2>
        <p className="import-summary-sub">They're in your pipeline now.</p>

        {/* Skipped count — never hidden per spec */}
        {totalSkipped > 0 && (
          <p className="import-skipped-notice">
            We skipped <strong>{totalSkipped}</strong> row{totalSkipped !== 1 ? 's' : ''} we couldn't read.
          </p>
        )}

        <SkippedList
          skipped={applyResult?.skipped ?? []}
          exactDupeCount={dupeCount}
        />

        {/* Partial failure retry */}
        {failedJobs.length > 0 && (
          <div className="import-retry-block">
            <p className="import-error" role="alert">
              Imported {importedCount} of {importedCount + failedJobs.length} — tap to retry the rest.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleRetryFailed}
              disabled={importing}
            >
              {importing ? 'Retrying…' : `Retry ${failedJobs.length} failed`}
            </button>
          </div>
        )}

        {importError && (
          <p className="import-error" role="alert">{importError}</p>
        )}

        <button
          type="button"
          className="btn-primary import-done-btn"
          onClick={onDone}
        >
          See my jobs
        </button>
      </div>
    );
  }

  return null;
}
