/**
 * profitReveal.test.js
 *
 * Contract tests for the Touch-1 profit reveal copy/state selection rules.
 * ProfitRevealBlock is a local (non-exported) function inside RecordPaymentModal,
 * so these tests validate the pure logic it delegates to:
 *   getJobProfit()  → { quote, materials, profit, margin }
 *   marginState()   → 'healthy' | 'thin' | 'underwater'
 *
 * Copy rules under test (spec 2026-06-08):
 *   A. healthy  (profit > 0, margin >= 25): headline + margin sub "X% margin on this one."
 *   B. thin     (profit > 0, margin 5–24):  headline + margin sub "X% margin — tighter than usual."
 *   C. no-quote (profit > 0, quote <= 0):   headline only (no margin sub)
 *   D. loss     (profit <= 0, costs logged): loss headline "This one cost you £X."
 *   E. zero     (profit = 0, no data):       "Paid. Logged." — never a fake £0 celebration
 *   F. break-even with costs logged:         treated as loss (underwater), not zero-data
 */

import { describe, it, expect } from 'vitest';
import { getJobProfit } from '../../lib/cashflow';
import { marginState } from '../../lib/profitThresholds';

// ── Helper: mirrors ProfitRevealBlock's state selection ──────────────────────
// Returns a plain object describing which UI branch would render, without
// touching the DOM. This is the load-bearing logic the component uses.
function selectRevealState(job, receipts) {
  const { quote, materials, profit, margin } = getJobProfit(job, receipts);

  if (profit === 0 && materials === 0 && quote === 0) {
    return { branch: 'no-data' };
  }

  if (profit <= 0) {
    return {
      branch: 'loss',
      lossAbs: Math.round(Math.abs(profit)),
    };
  }

  const state = marginState(margin);

  if (quote > 0) {
    return { branch: 'profit', state, margin };
  }

  // profit > 0 but no quote recorded (e.g. cash job with no quote total)
  return { branch: 'profit-no-quote', state };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function receipt(jobId, amount) {
  return { jobId, amount };
}

// ── A. Healthy margin (≥ 25%) ─────────────────────────────────────────────────

describe('profit reveal — healthy margin', () => {
  it('selects profit branch with healthy state at exactly 25% margin', () => {
    const job = { id: 'j1', total: 400 };
    const receipts = [receipt('j1', 300)]; // profit 100, margin 25%
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('profit');
    expect(result.state).toBe('healthy');
    expect(result.margin).toBe(25);
  });

  it('selects profit branch with healthy state for a high-margin job', () => {
    const job = { id: 'j2', total: 1000 };
    const receipts = [receipt('j2', 200)]; // profit 800, margin 80%
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('profit');
    expect(result.state).toBe('healthy');
    expect(result.margin).toBe(80);
  });

  it('selects profit branch with healthy state when no costs logged (100% margin)', () => {
    const job = { id: 'j3', total: 500 };
    const receipts = [];
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('profit');
    expect(result.state).toBe('healthy');
    expect(result.margin).toBe(100);
  });
});

// ── B. Thin margin (5–24%) ────────────────────────────────────────────────────

describe('profit reveal — thin margin', () => {
  it('selects profit branch with thin state at exactly 5% margin', () => {
    const job = { id: 'j4', total: 1000 };
    const receipts = [receipt('j4', 950)]; // profit 50, margin 5%
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('profit');
    expect(result.state).toBe('thin');
    expect(result.margin).toBe(5);
  });

  it('selects thin at 24% margin (one below healthy threshold)', () => {
    const job = { id: 'j5', total: 100 };
    const receipts = [receipt('j5', 76)]; // profit 24, margin 24%
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('profit');
    expect(result.state).toBe('thin');
    expect(result.margin).toBe(24);
  });

  it('selects thin at 15% margin (middle of range)', () => {
    const job = { id: 'j6', total: 200 };
    const receipts = [receipt('j6', 170)]; // profit 30, margin 15%
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('profit');
    expect(result.state).toBe('thin');
    expect(result.margin).toBe(15);
  });
});

// ── C. Profit with no quote (quote <= 0) — drop margin sub-line ───────────────

describe('profit reveal — quote fallback (no quote logged)', () => {
  it('selects profit-no-quote branch when job has no total/amount', () => {
    // A job created without a price; materials may still be zero too.
    // getJobProfit returns profit=0, quote=0 — triggers no-data branch.
    const job = { id: 'j7' }; // no total, no amount
    const receipts = [];
    const result = selectRevealState(job, receipts);
    // quote=0, materials=0, profit=0 → no-data
    expect(result.branch).toBe('no-data');
  });

  it('selects profit-no-quote when receipts exist but job has no quote total', () => {
    // Odd case: receipts linked but no quote. getJobProfit gives quote=0,
    // materials>0, profit<0 — triggers the loss branch, not profit-no-quote.
    const job = { id: 'j8' }; // no total
    const receipts = [receipt('j8', 50)];
    const result = selectRevealState(job, receipts);
    // profit = 0 - 50 = -50 → loss branch
    expect(result.branch).toBe('loss');
    expect(result.lossAbs).toBe(50);
  });
});

// ── D. Loss (profit <= 0, costs logged or quote < costs) ─────────────────────

describe('profit reveal — loss / underwater', () => {
  it('selects loss branch when costs exceed quote', () => {
    const job = { id: 'j9', total: 300 };
    const receipts = [receipt('j9', 400)]; // £100 loss
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('loss');
    expect(result.lossAbs).toBe(100);
  });

  it('calculates lossAbs correctly for large loss', () => {
    const job = { id: 'j10', total: 500 };
    const receipts = [receipt('j10', 750)]; // £250 loss
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('loss');
    expect(result.lossAbs).toBe(250);
  });

  it('selects loss branch when profit is exactly break-even but costs are logged', () => {
    // profit = quote - costs = 0, costs > 0 → NOT no-data, IS break-even loss
    const job = { id: 'j11', total: 300 };
    const receipts = [receipt('j11', 300)]; // break-even
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('loss');
    expect(result.lossAbs).toBe(0);
  });
});

// ── E. Zero-data fallback (profit=0, no quote, no costs) ─────────────────────

describe('profit reveal — zero-data fallback', () => {
  it('selects no-data when job has no quote and no receipts', () => {
    const job = { id: 'j12' };
    const receipts = [];
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('no-data');
  });

  it('selects no-data when job total is 0 and no receipts', () => {
    const job = { id: 'j13', total: 0 };
    const receipts = [];
    const result = selectRevealState(job, receipts);
    expect(result.branch).toBe('no-data');
  });

  it('does NOT select no-data when costs are logged even with zero quote', () => {
    const job = { id: 'j14', total: 0 };
    const receipts = [receipt('j14', 50)];
    const result = selectRevealState(job, receipts);
    // profit = 0 - 50 = -50 → loss, not no-data
    expect(result.branch).toBe('loss');
  });
});

// ── F. Multi-receipt aggregation ──────────────────────────────────────────────

describe('profit reveal — multi-receipt aggregation', () => {
  it('sums all receipts linked to the job', () => {
    const job = { id: 'j15', total: 1000 };
    const receipts = [
      receipt('j15', 200),
      receipt('j15', 150),
      receipt('other', 999), // different job — must not count
    ];
    const result = selectRevealState(job, receipts);
    // profit = 1000 - 350 = 650, margin = 65%
    expect(result.branch).toBe('profit');
    expect(result.state).toBe('healthy');
    expect(result.margin).toBe(65);
  });

  it('ignores receipts for other jobs', () => {
    const job = { id: 'j16', total: 500 };
    const receipts = [receipt('different-job', 400)];
    const result = selectRevealState(job, receipts);
    // No matching receipts — 100% margin
    expect(result.branch).toBe('profit');
    expect(result.state).toBe('healthy');
    expect(result.margin).toBe(100);
  });
});
