// @vitest-environment jsdom
/**
 * jobDetailHeaderSwipe.test.js — the header swipe-to-dismiss exclusion guard.
 *
 * Regression test for the reported bug: "press-and-hold a non-clickable part of
 * the open job profile → it peeks back to the Jobs tab → snaps back on release."
 *
 * Root cause: the read-only money chips (.jd-money-chip — paid/overdue/due) and
 * the read-only hero price (.jd-hero-price) render as plain, pill-shaped <div>s
 * INSIDE .job-detail-header (the swipe-to-dismiss drag zone). They were NOT in
 * isSwipeBlockedTarget's exclusion list, so a press-and-hold that drifted >10px
 * down armed the drag — sliding the (non-portaled) sheet + fading the backdrop
 * and briefly revealing the Jobs list behind it.
 *
 * Tests the REAL exported guard (not a mirrored copy of the selector), against a
 * jsdom DOM fragment so element.closest() does genuine CSS matching.
 *
 * NOTE (project convention): jsdom-pragma suites don't collect reliably on local
 * Windows checkouts — CI (Linux) is the gate for this file, not a local run.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { isSwipeBlockedTarget } from '../jobDetailHeaderSwipe';

/**
 * Builds the header-top-right price/status region as JobDetailDrawer renders it,
 * covering every price-state branch (paid / overdue / due / add-price / hero).
 */
function headerFixture() {
  const header = document.createElement('div');
  header.className = 'job-detail-header';
  header.innerHTML = `
    <div class="jd-grabber" aria-hidden="true"></div>
    <div class="jd-header-actions">
      <div class="jd-kebab-wrap">
        <button type="button" class="jd-kebab-btn" aria-label="More actions">…</button>
      </div>
    </div>
    <div class="jd-header-top-right">
      <div class="jd-money-chip jd-chip--paid">
        <span class="jd-chip-primary">Paid</span>
        <span class="jd-chip-sub">£380</span>
      </div>
      <div class="jd-money-chip jd-chip--overdue">
        <span class="jd-chip-primary">£120 due</span>
        <span class="jd-chip-sub">3 days overdue</span>
      </div>
      <div class="jd-money-chip jd-chip--due">
        <span class="jd-chip-primary">£120 due</span>
        <span class="jd-chip-sub">Invoiced</span>
      </div>
      <button type="button" class="jd-money-chip jd-chip--add" aria-label="Add job price">
        <span class="jd-chip-primary">+ Add price</span>
      </button>
      <div class="jd-hero-price">£380</div>
    </div>
    <p class="job-detail-summary">Jane Smith</p>
  `;
  document.body.appendChild(header);
  return header;
}

describe('isSwipeBlockedTarget — header swipe-to-dismiss guard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('BLOCKS a drag starting on the read-only Paid chip (regression: was NOT blocked)', () => {
    const header = headerFixture();
    // Press lands on the inner span, as a real finger would — closest() must
    // still walk up to the .jd-money-chip ancestor.
    const target = header.querySelector('.jd-chip--paid .jd-chip-primary');
    expect(isSwipeBlockedTarget(target)).toBe(true);
  });

  it('BLOCKS a drag starting on the read-only Overdue chip', () => {
    const header = headerFixture();
    expect(isSwipeBlockedTarget(header.querySelector('.jd-chip--overdue'))).toBe(true);
  });

  it('BLOCKS a drag starting on the read-only Invoiced/Due chip', () => {
    const header = headerFixture();
    expect(isSwipeBlockedTarget(header.querySelector('.jd-chip--due'))).toBe(true);
  });

  it('BLOCKS a drag starting on the read-only hero price figure', () => {
    const header = headerFixture();
    expect(isSwipeBlockedTarget(header.querySelector('.jd-hero-price'))).toBe(true);
  });

  it('still BLOCKS the tappable +Add price chip (already a button — no regression)', () => {
    const header = headerFixture();
    expect(isSwipeBlockedTarget(header.querySelector('.jd-chip--add'))).toBe(true);
  });

  it('still BLOCKS the kebab / interactive controls', () => {
    const header = headerFixture();
    expect(isSwipeBlockedTarget(header.querySelector('.jd-kebab-btn'))).toBe(true);
  });

  it('does NOT block the grabber pill (must remain a drag handle)', () => {
    const header = headerFixture();
    expect(isSwipeBlockedTarget(header.querySelector('.jd-grabber'))).toBe(false);
  });

  it('does NOT block blank header background (must remain draggable)', () => {
    const header = headerFixture();
    expect(isSwipeBlockedTarget(header)).toBe(false);
  });

  it('does NOT block a read-only customer summary line (plain text, not chip-like)', () => {
    const header = headerFixture();
    expect(isSwipeBlockedTarget(header.querySelector('.job-detail-summary'))).toBe(false);
  });

  it('is null/undefined-safe (returns false, never throws)', () => {
    expect(isSwipeBlockedTarget(null)).toBe(false);
    expect(isSwipeBlockedTarget(undefined)).toBe(false);
  });
});
