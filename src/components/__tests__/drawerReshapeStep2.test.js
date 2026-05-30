/**
 * drawerReshapeStep2.test.js
 *
 * Integration-style logic tests for the Step 2 drawer reshape.
 * Convention: pure logic mirrors, no DOM mount (matches JobDetailDrawer.test.js pattern).
 *
 * Covers:
 *   - ProfitRibbon colour class derivation at each threshold boundary
 *   - viewProfitBreakdown wire-up intent (handler lookup)
 *   - Ribbon renders when quote > 0, hidden when quote = 0
 *   - MoreDisclosure summary string construction
 *   - CollapsedSectionRow default-expanded logic
 *   - Attention-forced expansion (Customer row when phone missing + chase action)
 */

import { describe, it, expect } from 'vitest';
import { marginState } from '../../lib/profitThresholds';
import { sectionsNeedingAttention } from '../../lib/sectionAttention';

// ── ProfitRibbon colour class — boundary tests ────────────────────────────────

/**
 * Mirrors the class logic in ProfitRibbon.jsx:
 *   `jd-profit-ribbon--${marginState(margin)}`
 */
function ribbonClass(margin) {
  return `jd-profit-ribbon--${marginState(margin)}`;
}

describe('ProfitRibbon — colour class at each margin threshold', () => {
  it('healthy at 25% (green floor)', () => {
    expect(ribbonClass(25)).toBe('jd-profit-ribbon--healthy');
  });

  it('thin at 24.9% (just below green floor)', () => {
    expect(ribbonClass(24.9)).toBe('jd-profit-ribbon--thin');
  });

  it('thin at 5% (amber floor)', () => {
    expect(ribbonClass(5)).toBe('jd-profit-ribbon--thin');
  });

  it('underwater at 4.9% (just below amber floor)', () => {
    expect(ribbonClass(4.9)).toBe('jd-profit-ribbon--underwater');
  });

  it('underwater at 0% (break-even)', () => {
    expect(ribbonClass(0)).toBe('jd-profit-ribbon--underwater');
  });

  it('underwater at negative margin', () => {
    expect(ribbonClass(-15)).toBe('jd-profit-ribbon--underwater');
  });

  it('healthy at 42% (typical boiler swap)', () => {
    expect(ribbonClass(42)).toBe('jd-profit-ribbon--healthy');
  });
});

// ── ProfitRibbon render gate — mirrors ribbon visibility logic in JobDetailDrawer ──

/**
 * Mirrors: ribbon only shown when quote > 0
 */
function ribbonShouldShow(job) {
  const quote = Number(job.total ?? job.amount ?? 0);
  return quote > 0;
}

describe('ProfitRibbon — render gate', () => {
  it('shows when job has a positive total', () => {
    expect(ribbonShouldShow({ total: 1450 })).toBe(true);
  });

  it('shows when job has amount (fallback) but no total', () => {
    expect(ribbonShouldShow({ amount: 800 })).toBe(true);
  });

  it('hides when total is 0', () => {
    expect(ribbonShouldShow({ total: 0 })).toBe(false);
  });

  it('hides when neither total nor amount is present', () => {
    expect(ribbonShouldShow({})).toBe(false);
  });
});

// ── viewProfitBreakdown wire-up — handler map lookup ─────────────────────────

/**
 * Mirrors the nextStepHandlers map in JobDetailDrawer.
 * In Step 2, viewProfitBreakdown is wired to setProfitSheetOpen(true).
 * We test that the action token maps to a defined handler (not a no-op stub).
 *
 * In the real drawer the function is () => setProfitSheetOpen(true).
 * Here we verify the contract: the action key exists and is a function.
 */
function buildHandlerMap(setProfitSheetOpen) {
  return {
    sendQuoteLink:       () => {},
    openInvoiceModal:    () => {},
    openPaymentModal:    () => {},
    handleChase:         () => {},
    openReceiptModal:    () => {},
    openPhotoInput:      () => {},
    openSigPad:          () => {},
    editPrice:           () => {},
    editLineItems:       () => {},
    viewProfitBreakdown: () => setProfitSheetOpen(true),
    noop:                () => {},
  };
}

describe('viewProfitBreakdown — wire-up to profit sheet', () => {
  it('calling viewProfitBreakdown sets profitSheetOpen to true', () => {
    let open = false;
    const handlers = buildHandlerMap((v) => { open = v; });
    handlers.viewProfitBreakdown();
    expect(open).toBe(true);
  });

  it('viewProfitBreakdown handler is defined (not the old no-op)', () => {
    const calls = [];
    const handlers = buildHandlerMap(() => calls.push('opened'));
    handlers.viewProfitBreakdown();
    expect(calls).toEqual(['opened']);
  });
});

// ── MoreDisclosure — summary string construction ──────────────────────────────

/**
 * Mirrors the moreSummary derivation in JobDetailDrawer's Photos+Notes block.
 */
function buildMoreSummary(job) {
  const photoCount = Array.isArray(job.photos) ? job.photos.length : 0;
  const hasPhotoContent = photoCount > 0;
  const jobNotes = Array.isArray(job.jobNotes) ? job.jobNotes : [];
  const hasNoteContent = jobNotes.length > 0 ||
    (typeof job.notes === 'string' && job.notes.trim());

  const summaryParts = [];
  if (hasPhotoContent) summaryParts.push(`Photos (${photoCount})`);
  else summaryParts.push('Photos');
  if (hasNoteContent) {
    const noteCount = jobNotes.length;
    summaryParts.push(noteCount > 0 ? `Notes (${noteCount})` : 'Notes');
  } else {
    summaryParts.push('Notes');
  }
  return summaryParts.join(' · ');
}

describe('MoreDisclosure — summary string', () => {
  it('shows count when photos present', () => {
    const summary = buildMoreSummary({ photos: ['x', 'y', 'z'] });
    expect(summary).toContain('Photos (3)');
  });

  it('shows Photos without count when no photos', () => {
    const summary = buildMoreSummary({});
    expect(summary).toContain('Photos');
    expect(summary).not.toContain('Photos (');
  });

  it('shows note count when structured notes present', () => {
    const job = { jobNotes: [{ id: 'n1', body: 'test' }, { id: 'n2', body: 'test2' }] };
    const summary = buildMoreSummary(job);
    expect(summary).toContain('Notes (2)');
  });

  it('shows Notes without count when plain notes string', () => {
    const summary = buildMoreSummary({ notes: 'Key under mat' });
    expect(summary).toContain('Notes');
  });

  it('combines photos and notes in one string', () => {
    const job = { photos: ['a'], jobNotes: [{ id: 'n1', body: 'hi' }] };
    const summary = buildMoreSummary(job);
    expect(summary).toBe('Photos (1) · Notes (1)');
  });
});

// ── CollapsedSectionRow — hasContent for MoreDisclosure dot ──────────────────

/**
 * Mirrors: dot shown when hasAnyContent = hasPhotoContent || hasNoteContent
 */
function hasAnyMoreContent(job) {
  const hasPhotoContent = Array.isArray(job.photos) && job.photos.length > 0;
  const hasNoteContent =
    (Array.isArray(job.jobNotes) && job.jobNotes.length > 0) ||
    (typeof job.notes === 'string' && job.notes.trim().length > 0);
  return hasPhotoContent || hasNoteContent;
}

describe('MoreDisclosure — green dot (hasContent)', () => {
  it('dot shown when job has photos', () => {
    expect(hasAnyMoreContent({ photos: ['img'] })).toBe(true);
  });

  it('dot shown when job has structured notes', () => {
    expect(hasAnyMoreContent({ jobNotes: [{ id: 'n1', body: 'hi' }] })).toBe(true);
  });

  it('dot shown when job has plain notes string', () => {
    expect(hasAnyMoreContent({ notes: 'Key under mat' })).toBe(true);
  });

  it('no dot when blank job (no photos, no notes)', () => {
    expect(hasAnyMoreContent({ photos: [], jobNotes: [] })).toBe(false);
  });

  it('no dot when all fields absent', () => {
    expect(hasAnyMoreContent({})).toBe(false);
  });
});

// ── Amber Customer row — phone missing + chase action ─────────────────────────

describe('amber Customer row — full scenario', () => {
  it('Customer goes amber when handleChase is the action and phone is missing', () => {
    const job = {
      id: 'j1',
      status: 'invoice_sent',
      quoteStatus: 'sent',
      customer: 'Dave',
      customerPhone: null,
      phone: null,
      mobile: null,
      date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const nextStep = { primaryCta: { action: 'handleChase' } };
    const result = sectionsNeedingAttention(job, nextStep, []);
    expect(result.customer).toBe(true);
  });

  it('Customer does NOT go amber when phone is present, even on chase action', () => {
    const job = {
      id: 'j1',
      status: 'invoice_sent',
      quoteStatus: 'sent',
      customerPhone: '07700 900123',
      date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const nextStep = { primaryCta: { action: 'handleChase' } };
    const result = sectionsNeedingAttention(job, nextStep, []);
    expect(result.customer).toBe(false);
  });
});
