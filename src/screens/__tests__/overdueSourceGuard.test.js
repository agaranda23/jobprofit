/**
 * Unit tests for the Overdue-source restriction in StageChipDropdown.moveToStage
 * (src/screens/WorkScreen.jsx).
 *
 * The guard is inline (not exported), so this file mirrors its logic as a
 * pure predicate — the same pattern used in deriveDisplayStatus.test.js.
 *
 * Rule: moveToStage('Overdue') is only allowed when currentStage === 'Invoiced'.
 * From any other source stage the guard fires (toast shown, no patch applied).
 * The price guard (requiresPriceForStage) fires first; the overdue-source guard
 * stacks cleanly after it.
 */

import { describe, it, expect } from 'vitest';

// ── Mirror of the Overdue-source guard in StageChipDropdown.moveToStage ───────
// Returns true when the guard should block the move (toast fires, no patch).
function overdueSourceBlocked(targetStage, currentStage) {
  return targetStage === 'Overdue' && currentStage !== 'Invoiced';
}
// ─────────────────────────────────────────────────────────────────────────────

describe('Overdue-source guard: allowed path', () => {
  it('Invoiced → Overdue: guard does NOT fire', () => {
    expect(overdueSourceBlocked('Overdue', 'Invoiced')).toBe(false);
  });
});

describe('Overdue-source guard: blocked paths', () => {
  const blockedSources = ['Lead', 'Quoted', 'On', 'Paid'];

  it.each(blockedSources)('%s → Overdue: guard fires (toast, no patch)', (source) => {
    expect(overdueSourceBlocked('Overdue', source)).toBe(true);
  });
});

describe('Overdue-source guard: non-Overdue targets are never blocked by this guard', () => {
  const allStages = ['Lead', 'Quoted', 'On', 'Invoiced', 'Paid'];

  it.each(allStages)('Lead → %s: guard does NOT fire', (target) => {
    // The overdue-source guard only cares about targetStage === 'Overdue'
    expect(overdueSourceBlocked(target, 'Lead')).toBe(false);
  });
});
