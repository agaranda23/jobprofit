/**
 * workflowCircles.js — stage-mapping logic for the OHNAR WorkflowCircles component.
 *
 * Pure function: job → per-circle state array. No React, no DOM, fully testable.
 *
 * The six pipeline stages in display order:
 *   Lead · Quoted · On · Invoiced · Overdue · Paid
 *
 * This module derives WHICH circle is current/completed/skipped/overdue/future
 * from the canonical deriveDisplayStatus() result. It does NOT re-implement
 * stage derivation — that is and remains the sole responsibility of jobStatus.js.
 *
 * Circle state enum (string):
 *   'future'        — not yet reached; white fill + navy outline
 *   'completed'     — reached and passed; success green + checkmark
 *   'current'       — job is at this stage right now; OHNAR Blue ring (hollow, not fill)
 *   'overdue'       — Overdue circle when the job is actively overdue; red fill
 *   'skipped'       — Overdue circle when job reached Paid WITHOUT going overdue;
 *                     muted / dashed ring so it reads "bypassed, not missing"
 *   'was-overdue'   — Paid circle when the job was overdue before being paid;
 *                     success green + faint red trace/ring
 */

/** The six canonical stage labels in pipeline order. */
export const WORKFLOW_STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

/**
 * Derive the display state for each of the six circles given the current stage.
 *
 * @param {string} stage - Output of deriveDisplayStatus(job), one of the six labels.
 * @param {boolean} [wasOverdue=false] - True when the job passed through the Overdue
 *   stage on its way to Paid. Callers can derive this from job.overdue_history or by
 *   checking that the job's status is 'paid' AND it previously had overdue:true.
 *   Defaults to false when not provided (safe for jobs without history tracking).
 *
 * @returns {Array<{stage: string, state: string}>} Six entries in WORKFLOW_STAGES order.
 *
 * State derivation rules (in priority order):
 *
 *   ─ When stage === 'Paid':
 *     Lead/Quoted/On/Invoiced → 'completed'
 *     Overdue → 'skipped' (if !wasOverdue) OR 'completed' (if wasOverdue)
 *     Paid → 'completed' (terminal green win; or 'was-overdue' if wasOverdue — green + red trace)
 *     NOTE: 'current' (blue) is NEVER used when stage === 'Paid'. Green = the win.
 *
 *   ─ When stage === 'Overdue':
 *     Lead/Quoted/On/Invoiced → 'completed'
 *     Overdue → 'current' (activeOverdue colour = red fill)
 *     Paid → 'future'
 *
 *   ─ When stage === 'Invoiced':
 *     Lead/Quoted/On/Invoiced → the last is 'current', the prior are 'completed'
 *     Overdue/Paid → 'future'
 *
 *   ─ Pattern for Lead/Quoted/On: all stages before current are 'completed';
 *     current is 'current'; all after are 'future'.
 *
 *   ─ Overdue is never 'completed' in the linear progression (it's a sub-state
 *     of Invoiced, not a sequential step that must be crossed before Paid).
 *     The only time Overdue gets a filled treatment is:
 *       - 'overdue'   when stage === 'Overdue' (red fill; distinct from blue 'current')
 *       - 'skipped'   when stage === 'Paid' && !wasOverdue
 *       - 'completed' when stage === 'Paid' && wasOverdue
 */
export function deriveCircleStates(stage, wasOverdue = false) {
  // Position of the current stage in the linear pipeline
  // (Overdue is at index 4, Paid at 5 — same order as the visual strip)
  const stageIndex = {
    Lead:     0,
    Quoted:   1,
    On:       2,
    Invoiced: 3,
    Overdue:  4,
    Paid:     5,
  };

  const currentIdx = stageIndex[stage] ?? 0;

  return WORKFLOW_STAGES.map((s, idx) => {
    // ── Overdue circle special cases ─────────────────────────────────────────
    if (s === 'Overdue') {
      // 'overdue' state (red fill) is distinct from 'current' (blue fill) —
      // the Overdue circle NEVER gets the blue current treatment.
      if (stage === 'Overdue') return { stage: s, state: 'overdue' };
      if (stage === 'Paid') {
        // wasOverdue → job actually passed through overdue before being paid
        return { stage: s, state: wasOverdue ? 'completed' : 'skipped' };
      }
      // For Lead/Quoted/On/Invoiced: Overdue is always future
      return { stage: s, state: 'future' };
    }

    // ── Paid circle special case ─────────────────────────────────────────────
    if (s === 'Paid') {
      if (stage === 'Paid') {
        // Terminal success: Paid is always green ('completed' or 'was-overdue').
        // 'current' (blue) is never correct for a completed job — green IS the win.
        return { stage: s, state: wasOverdue ? 'was-overdue' : 'completed' };
      }
      return { stage: s, state: 'future' };
    }

    // ── Linear stages (Lead, Quoted, On, Invoiced) ───────────────────────────
    if (idx < currentIdx) return { stage: s, state: 'completed' };
    if (idx === currentIdx) return { stage: s, state: 'current' };
    return { stage: s, state: 'future' };
  });
}

/**
 * Determine whether a job was overdue before being paid.
 *
 * The canonical signal is job.overdue_history (array of timestamps written when
 * a job transitions into or out of Overdue). If that field is absent, fall back
 * to the weaker heuristic: job.overdue === true at a time when status is 'paid'
 * indicates the overdue flag was not cleared before payment — which only happens
 * on manual "Mark paid" that doesn't go through a full stage pipeline reset.
 *
 * For new jobs going through the correct stagePatch('Paid') path the overdue flag
 * IS cleared (see jobStatus.js stagePatch) so the manual-override heuristic is
 * a best-effort for legacy data only. The overdue_history field is the definitive
 * signal and should be added to the DB schema as a follow-up.
 *
 * @param {object} job - Raw job record
 * @returns {boolean}
 */
export function deriveWasOverdue(job) {
  if (!job) return false;
  // Primary: explicit history log (future-proof)
  if (Array.isArray(job.overdue_history) && job.overdue_history.length > 0) return true;
  // Secondary: overdue flag still set on a paid job (legacy / partial data)
  if (job.status === 'paid' && job.overdue === true) return true;
  return false;
}
