// @vitest-environment jsdom
/**
 * stageChipRings.test.jsx — render-based tests for the stage-marker feature
 * (feat/stage-chip-rings).
 *
 * Uses @testing-library/react to verify the observable DOM produced by
 * StageStrip. Complements stageChipsAccent.test.js (source + CSS analysis).
 *
 * Covers:
 *   - Six tiles and six markers render (one marker per chip)
 *   - Each marker carries the correct --marker-colour CSS custom property
 *   - Count text and £ totals are correct from the jobs array
 *   - Lead shows em-dash (not a £ value)
 *   - aria-pressed reflects selected state
 *   - stage-tile--selected class applied to the correct tile only
 *   - stage-marker--selected class applied to the correct marker only
 *   - Tapping a tile fires onSelectStage with the right stage string
 *   - showAll mode marks every tile as selected
 *   - No inline box-shadow inset top-bar on any tile
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import StageStrip from '../StageStrip.jsx';

// ── helpers ───────────────────────────────────────────────────────────────────

function fakeStatus(job) { return job.status ?? 'Lead'; }
function fakeFormat(v)   { return Number(v).toFixed(0); }

const JOBS = [
  { id: '1', status: 'Lead',     total: 0 },
  { id: '2', status: 'On',       total: 150 },
  { id: '3', status: 'On',       total: 250 },
  { id: '4', status: 'Invoiced', total: 500 },
  { id: '5', status: 'Paid',     total: 1000 },
];

function renderStrip(selectedStage = 'On', showAll = false, onSelect = vi.fn()) {
  return render(
    <StageStrip
      jobs={JOBS}
      selectedStage={selectedStage}
      showAll={showAll}
      onSelectStage={onSelect}
      deriveStatus={fakeStatus}
      formatAmount={fakeFormat}
    />,
  );
}

// ── structure ─────────────────────────────────────────────────────────────────

describe('StageStrip — tile and marker structure', () => {
  it('renders exactly six stage tiles', () => {
    const { container } = renderStrip();
    expect(container.querySelectorAll('.stage-tile').length).toBe(6);
  });

  it('renders exactly six stage-marker elements (one per chip)', () => {
    const { container } = renderStrip();
    expect(container.querySelectorAll('.stage-marker').length).toBe(6);
  });

  it('each marker is aria-hidden (decorative)', () => {
    const { container } = renderStrip();
    container.querySelectorAll('.stage-marker').forEach(m => {
      expect(m.getAttribute('aria-hidden')).toBe('true');
    });
  });
});

// ── stage-marker colour tokens ────────────────────────────────────────────────

describe('StageStrip — stage-marker colour tokens', () => {
  it('each marker carries --marker-colour pointing to its canonical --stage-* token', () => {
    const { container } = renderStrip();
    const markers = Array.from(container.querySelectorAll('.stage-marker'));
    const tokenValues = markers.map(m => m.style.getPropertyValue('--marker-colour'));
    expect(tokenValues).toEqual([
      'var(--stage-lead)',
      'var(--stage-quoted)',
      'var(--stage-on)',
      'var(--stage-invoiced)',
      'var(--stage-overdue)',
      'var(--stage-paid)',
    ]);
  });

  it('each marker carries a data-stage attribute matching the lower-cased stage', () => {
    const { container } = renderStrip();
    const markers = Array.from(container.querySelectorAll('.stage-marker'));
    const stages = markers.map(m => m.getAttribute('data-stage'));
    expect(stages).toEqual(['lead', 'quoted', 'on', 'invoiced', 'overdue', 'paid']);
  });
});

// ── counts and £ totals ───────────────────────────────────────────────────────

describe('StageStrip — counts and £ totals', () => {
  it('On chip shows 2 jobs (two On entries in JOBS)', () => {
    const { getByText } = renderStrip();
    expect(getByText('2 jobs')).toBeTruthy();
  });

  it('Invoiced chip shows 1 job', () => {
    // Invoiced has 1 entry; "1 job" (singular). Use getAllByText as Paid also has 1 job.
    const { getAllByText } = renderStrip();
    expect(getAllByText('1 job').length).toBeGreaterThanOrEqual(1);
  });

  it('On chip total is £400 (150+250)', () => {
    const { getByText } = renderStrip();
    expect(getByText('£400')).toBeTruthy();
  });

  it('Invoiced chip total is £500', () => {
    const { getByText } = renderStrip();
    expect(getByText('£500')).toBeTruthy();
  });

  it('Lead chip shows em-dash (no £ value for the Lead stage)', () => {
    const { getAllByText } = renderStrip();
    expect(getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});

// ── selected state ────────────────────────────────────────────────────────────

describe('StageStrip — selected state', () => {
  it('the selected tile has aria-pressed=true', () => {
    const { container } = renderStrip('On');
    const tiles = Array.from(container.querySelectorAll('.stage-tile'));
    // On is index 2 in STAGES order
    expect(tiles[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('unselected tiles have aria-pressed=false', () => {
    const { container } = renderStrip('On');
    const tiles = Array.from(container.querySelectorAll('.stage-tile'));
    [0, 1, 3, 4, 5].forEach(i =>
      expect(tiles[i].getAttribute('aria-pressed')).toBe('false'),
    );
  });

  it('stage-tile--selected class is on the active tile only', () => {
    const { container } = renderStrip('Quoted');
    const tiles = Array.from(container.querySelectorAll('.stage-tile'));
    // Quoted is index 1
    expect(tiles[1].classList.contains('stage-tile--selected')).toBe(true);
    [0, 2, 3, 4, 5].forEach(i =>
      expect(tiles[i].classList.contains('stage-tile--selected')).toBe(false),
    );
  });

  it('stage-marker--selected class is on the active chip marker only', () => {
    const { container } = renderStrip('Invoiced');
    const markers = Array.from(container.querySelectorAll('.stage-marker'));
    // Invoiced is index 3
    expect(markers[3].classList.contains('stage-marker--selected')).toBe(true);
    [0, 1, 2, 4, 5].forEach(i =>
      expect(markers[i].classList.contains('stage-marker--selected')).toBe(false),
    );
  });

  it('in showAll mode all six tiles have stage-tile--selected', () => {
    const { container } = renderStrip('On', true);
    Array.from(container.querySelectorAll('.stage-tile')).forEach(t =>
      expect(t.classList.contains('stage-tile--selected')).toBe(true),
    );
  });

  it('in showAll mode all six markers have stage-marker--selected', () => {
    const { container } = renderStrip('On', true);
    Array.from(container.querySelectorAll('.stage-marker')).forEach(m =>
      expect(m.classList.contains('stage-marker--selected')).toBe(true),
    );
  });
});

// ── tap-to-filter ─────────────────────────────────────────────────────────────

describe('StageStrip — tap-to-filter callback', () => {
  it('tapping a tile fires onSelectStage with the correct stage string', () => {
    const onSelect = vi.fn();
    const { container } = renderStrip('On', false, onSelect);
    const tiles = container.querySelectorAll('.stage-tile');
    // Tap Paid (index 5)
    fireEvent.click(tiles[5]);
    expect(onSelect).toHaveBeenCalledWith('Paid');
  });

  it('tapping Lead fires onSelectStage("Lead")', () => {
    const onSelect = vi.fn();
    const { container } = renderStrip('On', false, onSelect);
    fireEvent.click(container.querySelectorAll('.stage-tile')[0]);
    expect(onSelect).toHaveBeenCalledWith('Lead');
  });

  it('tapping Overdue fires onSelectStage("Overdue")', () => {
    const onSelect = vi.fn();
    const { container } = renderStrip('On', false, onSelect);
    fireEvent.click(container.querySelectorAll('.stage-tile')[4]);
    expect(onSelect).toHaveBeenCalledWith('Overdue');
  });
});

// ── top-bar accent absent ─────────────────────────────────────────────────────

describe('StageStrip — no inline top-bar accent on tiles', () => {
  it('no tile has an inset 0 3px top-bar accent as an inline style', () => {
    // jsdom does not evaluate stylesheets; verify no inline style leaked onto tiles.
    const { container } = renderStrip();
    container.querySelectorAll('.stage-tile').forEach(tile => {
      expect(tile.style.boxShadow ?? '').not.toMatch(/inset\s+0\s+3px/);
    });
  });
});
