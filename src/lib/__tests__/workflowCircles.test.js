/**
 * workflowCircles.test.js — unit tests for OHNAR stage-mapping logic.
 *
 * Tests for deriveCircleStates() and deriveWasOverdue() in workflowCircles.js.
 *
 * Coverage:
 *   1. Each of the six stages → correct circle states (including Overdue + Paid)
 *   2. Paid WITHOUT overdue → Overdue circle is 'skipped' (not 'future', not 'completed')
 *   3. Paid after being overdue → Overdue is 'completed', Paid is 'was-overdue'
 *   4. Active overdue → Overdue is 'current', Paid is 'future'
 *   5. Linear progression: all prior stages are 'completed', current is 'current', future is 'future'
 *   6. deriveWasOverdue: history array, overdue flag on paid, absence
 *   7. Edge cases: null/unknown stage
 */

import { describe, it, expect } from 'vitest';
import {
  deriveCircleStates,
  deriveWasOverdue,
  WORKFLOW_STAGES,
} from '../workflowCircles.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract just the state strings in WORKFLOW_STAGES order for easy assertion */
function states(stage, wasOverdue = false) {
  return deriveCircleStates(stage, wasOverdue).map(c => c.state);
}

/** Extract stages array (should always equal WORKFLOW_STAGES) */
function stageNames(stage) {
  return deriveCircleStates(stage).map(c => c.stage);
}

// ── 1. Output shape ───────────────────────────────────────────────────────────

describe('deriveCircleStates — output shape', () => {
  it('always returns exactly 6 entries', () => {
    for (const s of WORKFLOW_STAGES) {
      expect(deriveCircleStates(s)).toHaveLength(6);
    }
  });

  it('entries are in WORKFLOW_STAGES order regardless of current stage', () => {
    for (const s of WORKFLOW_STAGES) {
      expect(stageNames(s)).toEqual(WORKFLOW_STAGES);
    }
  });

  it('each entry has { stage, state } shape', () => {
    const result = deriveCircleStates('Lead');
    result.forEach(entry => {
      expect(entry).toHaveProperty('stage');
      expect(entry).toHaveProperty('state');
    });
  });
});

// ── 2. Stage: Lead ────────────────────────────────────────────────────────────

describe('deriveCircleStates — Lead', () => {
  it('Lead is current; everything else is future', () => {
    expect(states('Lead')).toEqual(['current', 'future', 'future', 'future', 'future', 'future']);
  });
});

// ── 3. Stage: Quoted ──────────────────────────────────────────────────────────

describe('deriveCircleStates — Quoted', () => {
  it('Lead is completed, Quoted is current, rest are future; Overdue is future', () => {
    expect(states('Quoted')).toEqual(['completed', 'current', 'future', 'future', 'future', 'future']);
  });
});

// ── 4. Stage: On ─────────────────────────────────────────────────────────────

describe('deriveCircleStates — On', () => {
  it('Lead + Quoted are completed, On is current, rest are future; Overdue is future', () => {
    expect(states('On')).toEqual(['completed', 'completed', 'current', 'future', 'future', 'future']);
  });
});

// ── 5. Stage: Invoiced ───────────────────────────────────────────────────────

describe('deriveCircleStates — Invoiced', () => {
  it('Lead/Quoted/On are completed, Invoiced is current, Overdue + Paid are future', () => {
    expect(states('Invoiced')).toEqual(['completed', 'completed', 'completed', 'current', 'future', 'future']);
  });
});

// ── 6. Stage: Overdue (active) ───────────────────────────────────────────────

describe('deriveCircleStates — Overdue (active)', () => {
  it('Lead/Quoted/On/Invoiced are completed, Overdue is "overdue" (red, not blue current), Paid is future', () => {
    expect(states('Overdue')).toEqual(['completed', 'completed', 'completed', 'completed', 'overdue', 'future']);
  });
});

// ── 7. Stage: Paid WITHOUT going overdue (skipped case) ──────────────────────

describe('deriveCircleStates — Paid, wasOverdue=false (skipped)', () => {
  it('Lead/Quoted/On/Invoiced are completed; Overdue is SKIPPED; Paid is COMPLETED (terminal green, not current)', () => {
    const result = states('Paid', false);
    // Fix #1: Paid is 'completed' (green terminal win), NOT 'current' (blue in-progress)
    expect(result).toEqual(['completed', 'completed', 'completed', 'completed', 'skipped', 'completed']);
  });

  it('Overdue state is specifically "skipped" — not "future"', () => {
    const result = deriveCircleStates('Paid', false);
    const overdueCircle = result.find(c => c.stage === 'Overdue');
    expect(overdueCircle.state).toBe('skipped');
    expect(overdueCircle.state).not.toBe('future');
    expect(overdueCircle.state).not.toBe('completed');
  });

  it('Paid state is "completed" (terminal green) — NOT "current", NOT "was-overdue"', () => {
    const result = deriveCircleStates('Paid', false);
    const paidCircle = result.find(c => c.stage === 'Paid');
    expect(paidCircle.state).toBe('completed');
    expect(paidCircle.state).not.toBe('current');
    expect(paidCircle.state).not.toBe('was-overdue');
  });

  it('NO circle is in "current" state on a paid job (terminal success = all green, no blue)', () => {
    const result = deriveCircleStates('Paid', false);
    const currentCircles = result.filter(c => c.state === 'current');
    expect(currentCircles).toHaveLength(0);
  });

  it('default wasOverdue=false gives skipped Overdue + completed Paid (default param)', () => {
    const result = deriveCircleStates('Paid'); // no second arg
    const overdueCircle = result.find(c => c.stage === 'Overdue');
    const paidCircle = result.find(c => c.stage === 'Paid');
    expect(overdueCircle.state).toBe('skipped');
    expect(paidCircle.state).toBe('completed');
  });
});

// ── 8. Stage: Paid WITH overdue history (was-overdue case) ───────────────────

describe('deriveCircleStates — Paid, wasOverdue=true (was-overdue trace)', () => {
  it('Lead/Quoted/On/Invoiced/Overdue are completed; Paid is "was-overdue" (green + red trace)', () => {
    const result = states('Paid', true);
    expect(result).toEqual(['completed', 'completed', 'completed', 'completed', 'completed', 'was-overdue']);
  });

  it('Overdue is "completed" (green — it DID happen) when wasOverdue is true', () => {
    const result = deriveCircleStates('Paid', true);
    const overdueCircle = result.find(c => c.stage === 'Overdue');
    expect(overdueCircle.state).toBe('completed');
    expect(overdueCircle.state).not.toBe('skipped');
  });

  it('Paid circle is "was-overdue" (terminal green + red-trace; NOT "current", NOT "completed")', () => {
    const result = deriveCircleStates('Paid', true);
    const paidCircle = result.find(c => c.stage === 'Paid');
    expect(paidCircle.state).toBe('was-overdue');
    expect(paidCircle.state).not.toBe('current');
    expect(paidCircle.state).not.toBe('completed');
  });

  it('NO circle is in "current" state on a paid-after-overdue job', () => {
    const result = deriveCircleStates('Paid', true);
    const currentCircles = result.filter(c => c.state === 'current');
    expect(currentCircles).toHaveLength(0);
  });
});

// ── 9. Edge cases ─────────────────────────────────────────────────────────────

describe('deriveCircleStates — edge cases', () => {
  it('unknown stage → Lead is current (safe default, same as Lead)', () => {
    // Unknown stage falls to currentIdx=0 so Lead=current, rest=future
    const result = states('UnknownStage');
    expect(result[0]).toBe('current');
    // Overdue must never be 'current' for an unknown stage
    const overdueState = deriveCircleStates('UnknownStage').find(c => c.stage === 'Overdue').state;
    expect(overdueState).toBe('future');
  });

  it('empty string stage → same as Lead safe default', () => {
    const result = deriveCircleStates('');
    expect(result.find(c => c.stage === 'Lead').state).toBe('current');
  });
});

// ── 10. deriveWasOverdue ──────────────────────────────────────────────────────

describe('deriveWasOverdue', () => {
  it('returns false for null', () => {
    expect(deriveWasOverdue(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(deriveWasOverdue(undefined)).toBe(false);
  });

  it('returns false for a clean paid job with no history', () => {
    expect(deriveWasOverdue({ status: 'paid', overdue: false })).toBe(false);
  });

  it('returns false for an invoiced job (not paid)', () => {
    expect(deriveWasOverdue({ status: 'invoice_sent', overdue: true })).toBe(false);
  });

  it('returns true when overdue_history is a non-empty array (primary signal)', () => {
    expect(deriveWasOverdue({
      status: 'paid',
      overdue_history: ['2026-06-01T10:00:00Z'],
    })).toBe(true);
  });

  it('returns false when overdue_history is an empty array', () => {
    expect(deriveWasOverdue({
      status: 'paid',
      overdue_history: [],
    })).toBe(false);
  });

  it('returns true when status=paid AND overdue=true (legacy fallback heuristic)', () => {
    expect(deriveWasOverdue({ status: 'paid', overdue: true })).toBe(true);
  });

  it('returns false when overdue=true but status is NOT paid (overdue flag alone)', () => {
    expect(deriveWasOverdue({ status: 'invoice_sent', overdue: true })).toBe(false);
  });

  it('overdue_history takes priority over overdue flag absence', () => {
    // history present, overdue flag absent
    expect(deriveWasOverdue({
      status: 'paid',
      overdue_history: ['2026-06-01T10:00:00Z'],
      overdue: false,
    })).toBe(true);
  });
});

// ── 11. deriveConnectorClass — connector state derivation ────────────────────

import { deriveConnectorClass } from '../workflowCircles.js';

describe('deriveConnectorClass', () => {
  it('returns --done when both endpoints are completed', () => {
    expect(deriveConnectorClass('completed', 'completed')).toBe(' wfc__connector--done');
  });

  it('returns --done when both endpoints are was-overdue / completed', () => {
    expect(deriveConnectorClass('completed', 'was-overdue')).toBe(' wfc__connector--done');
    expect(deriveConnectorClass('was-overdue', 'completed')).toBe(' wfc__connector--done');
  });

  it('returns --skipped when right endpoint is skipped (connector touches bypass)', () => {
    // This is the connector between Invoiced (completed) and Overdue (skipped)
    expect(deriveConnectorClass('completed', 'skipped')).toBe(' wfc__connector--skipped');
  });

  it('returns --skipped when left endpoint is skipped (connector after bypass)', () => {
    // This is the connector between Overdue (skipped) and Paid (completed)
    expect(deriveConnectorClass('skipped', 'completed')).toBe(' wfc__connector--skipped');
  });

  it('returns "" when right endpoint is future', () => {
    expect(deriveConnectorClass('completed', 'future')).toBe('');
  });

  it('returns "" when right endpoint is current', () => {
    expect(deriveConnectorClass('completed', 'current')).toBe('');
  });

  it('returns "" when right endpoint is overdue', () => {
    expect(deriveConnectorClass('completed', 'overdue')).toBe('');
  });

  it('returns "" when both endpoints are future', () => {
    expect(deriveConnectorClass('future', 'future')).toBe('');
  });
});

// ── 12. Integration: all valid stage → no state is undefined ─────────────────

describe('deriveCircleStates — no undefined states for any valid stage', () => {
  const validStates = new Set(['future', 'completed', 'current', 'overdue', 'skipped', 'was-overdue']);

  WORKFLOW_STAGES.forEach(stage => {
    it(`stage "${stage}" (wasOverdue=false) → all 6 states are valid enum values`, () => {
      deriveCircleStates(stage, false).forEach(({ state }) => {
        expect(validStates.has(state)).toBe(true);
      });
    });

    it(`stage "${stage}" (wasOverdue=true) → all 6 states are valid enum values`, () => {
      deriveCircleStates(stage, true).forEach(({ state }) => {
        expect(validStates.has(state)).toBe(true);
      });
    });
  });
});

// ── 12. Skipped vs future: the critical visual distinction ────────────────────

describe('skipped vs future — critical distinction for Paid jobs', () => {
  it('a paid job (no overdue history) never has a "future" circle — Overdue is "skipped"', () => {
    const result = deriveCircleStates('Paid', false);
    const hasFuture = result.some(c => c.state === 'future');
    expect(hasFuture).toBe(false);
  });

  it('a paid job (no overdue history) never has a "current" circle — green wins', () => {
    const result = deriveCircleStates('Paid', false);
    const hasCurrent = result.some(c => c.state === 'current');
    expect(hasCurrent).toBe(false);
  });

  it('a paid-after-overdue job never has a "current" circle', () => {
    const result = deriveCircleStates('Paid', true);
    const hasCurrent = result.some(c => c.state === 'current');
    expect(hasCurrent).toBe(false);
  });

  it('a non-paid job always has at least one "future" circle', () => {
    for (const stage of ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue']) {
      const result = deriveCircleStates(stage);
      const hasFuture = result.some(c => c.state === 'future');
      expect(hasFuture).toBe(true);
    }
  });
});
