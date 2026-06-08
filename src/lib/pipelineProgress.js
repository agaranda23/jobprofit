/**
 * pipelineProgress.js — helpers for Pipeline Phase 2 workflow-visibility UI.
 *
 * Extracted from JobProgressDots.jsx so the component file only exports
 * the default React component (react-refresh/only-export-components rule).
 */

/**
 * Maps a canonical deriveDisplayStatus stage to the number of filled dots
 * (0–4) in the JobProgressDots component.
 *
 * The four logical loop steps are: Quoted → On → Invoiced → Paid.
 * Overdue is a sub-state of Invoiced (same pipeline position, different colour).
 *
 * Returns 0 for unknown/undefined stages — safe default.
 */
export function stageToFilledCount(stage) {
  switch (stage) {
    case 'Lead':     return 0;
    case 'Quoted':   return 1;
    case 'On':       return 2;
    case 'Invoiced': return 3;
    case 'Overdue':  return 3;
    case 'Paid':     return 4;
    default:         return 0;
  }
}
