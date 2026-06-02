/**
 * tradeTypeCapture — pure-logic tests for Phase 1 trade-type capture.
 *
 * No DOM, no React — matches project convention.
 * Visual smoke is covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   1.  deriveTradeRowValue returns null when trade_types is empty/absent
 *   2.  deriveTradeRowValue returns null when trade_types is null
 *   3.  deriveTradeRowValue returns primary label when only one trade selected
 *   4.  deriveTradeRowValue returns "Primary · +N" format when multiple selected
 *   5.  deriveTradeRowValue uses trade_other text for the "other" chip
 *   6.  deriveTradeRowValue falls back gracefully when primary is not in the list
 *   7.  Max-3 enforcement — toggleChip simulation does not exceed three selections
 *   8.  Primary defaults to first selected chip when primary is null
 *   9.  Primary reassigns to next chip when current primary is deselected
 *   10. Save patch writes trade_types, trade_primary, trade_other correctly
 *   11. Save patch sets trade_types to null when nothing selected
 *   12. trade_other is null when "other" chip is not selected (even if otherText set)
 *   13. getTradeVoiceHint returns trade-specific hint for known keys
 *   14. getTradeVoiceHint falls back to generic hint for unknown/null trade
 */

import { describe, it, expect } from 'vitest';

// ── Inline helpers under test ─────────────────────────────────────────────────
// We inline rather than import the screen/component files because those have
// side-effect imports (supabase, posthog, package.json) that need heavy mocking.
// The helpers here are kept in sync with SettingsScreen.jsx and AddJobModal.jsx.

const TRADE_CHIPS = [
  { key: 'plumber',              label: 'Plumber' },
  { key: 'gas_engineer',         label: 'Gas engineer' },
  { key: 'heating_engineer',     label: 'Heating engineer' },
  { key: 'electrician',          label: 'Electrician' },
  { key: 'builder',              label: 'Builder' },
  { key: 'carpenter_joiner',     label: 'Carpenter/Joiner' },
  { key: 'decorator',            label: 'Decorator' },
  { key: 'plasterer',            label: 'Plasterer' },
  { key: 'roofer',               label: 'Roofer' },
  { key: 'tiler',                label: 'Tiler' },
  { key: 'landscaper_groundworker', label: 'Landscaper/Groundworker' },
  { key: 'other',                label: 'Other' },
];

const TRADE_MAX = 3;

function deriveTradeRowValue(profile) {
  const types   = Array.isArray(profile?.trade_types) ? profile.trade_types : [];
  const primary = profile?.trade_primary || null;
  if (types.length === 0) return null;
  // "other" key always uses free-text, never the generic chip label
  let primaryLabel;
  if (primary === 'other') {
    primaryLabel = profile?.trade_other?.trim() || 'Other';
  } else {
    const chip = TRADE_CHIPS.find(c => c.key === primary);
    primaryLabel = chip ? chip.label : null;
  }
  if (!primaryLabel) return null;
  const extras = types.filter(k => k !== primary).length;
  if (extras === 0) return primaryLabel;
  return `${primaryLabel} · +${extras}`;
}

function getTradeVoiceHint(tradePrimary) {
  const map = {
    plumber:                  'Burst pipe Mrs Jones one eighty cash',
    gas_engineer:             'Boiler service Mrs Mitchell one twenty',
    heating_engineer:         'Heating flush Mr Evans two fifty bank',
    electrician:              'Replace consumer unit Mr Patel four fifty',
    builder:                  'Foundation work site London three thousand',
    carpenter_joiner:         'Fit kitchen Mr Harris six hundred cash',
    decorator:                'Repaint hallway Mrs Brown four hundred',
    plasterer:                'Skim bedroom ceiling Dave two eighty',
    roofer:                   'Ridge tile repair Mr Clark three sixty',
    tiler:                    'Bathroom tiling Mrs White five hundred',
    landscaper_groundworker:  'Turf garden Mr Green eight hundred',
  };
  const key = (tradePrimary || '').toLowerCase();
  return map[key] || 'Kitchen job Sarah three eighty cash';
}

/**
 * Simulates the toggleChip reducer from TradeSetupSheet without React state.
 * Returns { selected, primary } after the toggle.
 */
function simulateToggle(currentSelected, currentPrimary, key) {
  let selected = [...currentSelected];
  let primary  = currentPrimary;

  if (selected.includes(key)) {
    selected = selected.filter(k => k !== key);
    if (primary === key) {
      primary = selected[0] ?? null;
    }
  } else {
    if (selected.length >= TRADE_MAX) return { selected, primary };
    selected = [...selected, key];
    if (!primary) primary = key;
  }
  return { selected, primary };
}

/**
 * Simulates the save patch builder from TradeSetupSheet.handleSave.
 */
function buildSavePatch({ selected, primary, otherText }) {
  const resolvedPrimary = selected.length > 0
    ? (primary && selected.includes(primary) ? primary : selected[0])
    : null;
  return {
    trade_types:   selected.length > 0 ? selected : null,
    trade_primary: resolvedPrimary,
    trade_other:   selected.includes('other') ? (otherText.trim() || null) : null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('deriveTradeRowValue', () => {
  it('returns null when trade_types is absent (profile has no trade fields)', () => {
    expect(deriveTradeRowValue({})).toBeNull();
  });

  it('returns null when trade_types is null', () => {
    expect(deriveTradeRowValue({ trade_types: null, trade_primary: null })).toBeNull();
  });

  it('returns null when trade_types is an empty array', () => {
    expect(deriveTradeRowValue({ trade_types: [], trade_primary: null })).toBeNull();
  });

  it('returns the primary label when exactly one trade is selected', () => {
    const result = deriveTradeRowValue({
      trade_types:   ['plumber'],
      trade_primary: 'plumber',
    });
    expect(result).toBe('Plumber');
  });

  it('returns "Primary · +N" format when two trades are selected', () => {
    const result = deriveTradeRowValue({
      trade_types:   ['gas_engineer', 'heating_engineer'],
      trade_primary: 'gas_engineer',
    });
    expect(result).toBe('Gas engineer · +1');
  });

  it('returns "Primary · +2" format when three trades are selected', () => {
    const result = deriveTradeRowValue({
      trade_types:   ['electrician', 'builder', 'tiler'],
      trade_primary: 'electrician',
    });
    expect(result).toBe('Electrician · +2');
  });

  it('uses trade_other text as the label when "other" is primary', () => {
    const result = deriveTradeRowValue({
      trade_types:   ['other'],
      trade_primary: 'other',
      trade_other:   'Tree surgeon',
    });
    expect(result).toBe('Tree surgeon');
  });

  it('falls back to "Other" when "other" is primary but trade_other is blank', () => {
    const result = deriveTradeRowValue({
      trade_types:   ['other'],
      trade_primary: 'other',
      trade_other:   '   ',
    });
    expect(result).toBe('Other');
  });

  it('returns null when primary key is not in the chip list and not "other"', () => {
    const result = deriveTradeRowValue({
      trade_types:   ['mystery_trade'],
      trade_primary: 'mystery_trade',
    });
    expect(result).toBeNull();
  });
});

describe('max-3 enforcement (simulateToggle)', () => {
  it('allows selecting up to 3 chips', () => {
    let state = { selected: [], primary: null };
    state = simulateToggle(state.selected, state.primary, 'plumber');
    state = simulateToggle(state.selected, state.primary, 'gas_engineer');
    state = simulateToggle(state.selected, state.primary, 'electrician');
    expect(state.selected).toHaveLength(3);
    expect(state.selected).toContain('plumber');
    expect(state.selected).toContain('gas_engineer');
    expect(state.selected).toContain('electrician');
  });

  it('blocks a 4th chip from being added — selection stays at 3', () => {
    let state = { selected: ['plumber', 'gas_engineer', 'electrician'], primary: 'plumber' };
    state = simulateToggle(state.selected, state.primary, 'tiler');
    expect(state.selected).toHaveLength(3);
    expect(state.selected).not.toContain('tiler');
  });
});

describe('primary assignment (simulateToggle)', () => {
  it('auto-assigns primary to the first chip when nothing is selected yet', () => {
    const state = simulateToggle([], null, 'decorator');
    expect(state.primary).toBe('decorator');
    expect(state.selected).toContain('decorator');
  });

  it('does not change primary when adding a second chip (primary stays on first)', () => {
    let state = simulateToggle([], null, 'plumber');
    state = simulateToggle(state.selected, state.primary, 'gas_engineer');
    expect(state.primary).toBe('plumber');
  });

  it('reassigns primary to the next chip when current primary is deselected', () => {
    let state = { selected: ['plumber', 'gas_engineer'], primary: 'plumber' };
    state = simulateToggle(state.selected, state.primary, 'plumber');
    expect(state.selected).not.toContain('plumber');
    expect(state.primary).toBe('gas_engineer');
  });

  it('sets primary to null when the only selected chip is deselected', () => {
    let state = { selected: ['roofer'], primary: 'roofer' };
    state = simulateToggle(state.selected, state.primary, 'roofer');
    expect(state.selected).toHaveLength(0);
    expect(state.primary).toBeNull();
  });
});

describe('buildSavePatch', () => {
  it('writes all three fields correctly when two trades are selected', () => {
    const patch = buildSavePatch({
      selected:  ['plumber', 'gas_engineer'],
      primary:   'plumber',
      otherText: '',
    });
    expect(patch.trade_types).toEqual(['plumber', 'gas_engineer']);
    expect(patch.trade_primary).toBe('plumber');
    expect(patch.trade_other).toBeNull();
  });

  it('sets trade_types to null when nothing is selected (clear / unset state)', () => {
    const patch = buildSavePatch({ selected: [], primary: null, otherText: '' });
    expect(patch.trade_types).toBeNull();
    expect(patch.trade_primary).toBeNull();
    expect(patch.trade_other).toBeNull();
  });

  it('stores free text in trade_other when "other" chip is selected', () => {
    const patch = buildSavePatch({
      selected:  ['other'],
      primary:   'other',
      otherText: 'Tree surgeon',
    });
    expect(patch.trade_other).toBe('Tree surgeon');
    expect(patch.trade_primary).toBe('other');
  });

  it('stores null for trade_other when "other" is selected but text is blank', () => {
    const patch = buildSavePatch({
      selected:  ['other'],
      primary:   'other',
      otherText: '   ',
    });
    expect(patch.trade_other).toBeNull();
  });

  it('sets trade_other to null when "other" chip is NOT selected even if text is present', () => {
    const patch = buildSavePatch({
      selected:  ['plumber'],
      primary:   'plumber',
      otherText: 'Some leftover text',
    });
    expect(patch.trade_other).toBeNull();
  });

  it('falls back to selected[0] as primary when stored primary is not in selected list', () => {
    const patch = buildSavePatch({
      selected:  ['tiler', 'roofer'],
      primary:   'plasterer', // stale — not in selected
      otherText: '',
    });
    expect(patch.trade_primary).toBe('tiler');
  });
});

describe('getTradeVoiceHint', () => {
  it('returns a gas-engineer specific hint for gas_engineer key', () => {
    const hint = getTradeVoiceHint('gas_engineer');
    expect(hint).toContain('Boiler service');
  });

  it('returns an electrician hint for electrician key', () => {
    const hint = getTradeVoiceHint('electrician');
    expect(hint).toContain('consumer unit');
  });

  it('returns a decorator hint for decorator key', () => {
    const hint = getTradeVoiceHint('decorator');
    expect(hint).toContain('Repaint');
  });

  it('returns the generic fallback hint for null trade (no trade set)', () => {
    const hint = getTradeVoiceHint(null);
    expect(hint).toBe('Kitchen job Sarah three eighty cash');
  });

  it('returns the generic fallback hint for an unknown trade key', () => {
    const hint = getTradeVoiceHint('tree_surgeon');
    expect(hint).toBe('Kitchen job Sarah three eighty cash');
  });

  it('returns the generic fallback hint for the "other" key', () => {
    // "other" has no tailored example — we do not attempt to guess
    const hint = getTradeVoiceHint('other');
    expect(hint).toBe('Kitchen job Sarah three eighty cash');
  });
});
