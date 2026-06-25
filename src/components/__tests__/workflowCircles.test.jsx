// @vitest-environment jsdom
/**
 * workflowCircles.test.jsx — component render tests for WorkflowCircles.
 *
 * Tests the rendered DOM output for:
 *   1. Both variants (compact, full) render six circles
 *   2. Correct CSS classes per circle state
 *   3. Full variant renders labels and icons
 *   4. aria-label announces the correct stage
 *   5. Overdue circle has --overdue class when stage is Overdue
 *   6. Skipped circle has --skipped class (not --future) on a paid job
 *   7. Was-overdue circle has --was-overdue class on paid-after-overdue
 *   8. Paid animation class applied to Paid circle when job is Paid
 *   9. Filter chips (StageStrip) are NOT rendered by this component (scope check)
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import WorkflowCircles from '../WorkflowCircles';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal job object in the canonical stage format */
function makeJob(statusOrFields) {
  if (typeof statusOrFields === 'string') {
    return { status: statusOrFields };
  }
  return statusOrFields;
}

/** Render and return all wfc__step elements */
function getSteps(container) {
  return container.querySelectorAll('.wfc__step');
}

/** Render and return all wfc__circle elements */
function getCircles(container) {
  return container.querySelectorAll('.wfc__circle');
}

// ── Compact variant ───────────────────────────────────────────────────────────

describe('WorkflowCircles — compact variant', () => {
  it('renders exactly 6 step elements', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="compact" />);
    expect(getSteps(container)).toHaveLength(6);
  });

  it('renders exactly 6 circle elements', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="compact" />);
    expect(getCircles(container)).toHaveLength(6);
  });

  it('has class wfc--compact on the outer wrapper', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="compact" />);
    expect(container.querySelector('.wfc--compact')).not.toBeNull();
  });

  it('does NOT render label text in compact mode', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="compact" />);
    expect(container.querySelectorAll('.wfc__label')).toHaveLength(0);
  });

  it('does NOT render jp-icon spans in compact mode (no icons in compact)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="compact" />);
    expect(container.querySelectorAll('.jp-icon')).toHaveLength(0);
  });
});

// ── Full variant ──────────────────────────────────────────────────────────────

describe('WorkflowCircles — full variant', () => {
  it('renders exactly 6 step elements', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    expect(getSteps(container)).toHaveLength(6);
  });

  it('has class wfc--full on the outer wrapper', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    expect(container.querySelector('.wfc--full')).not.toBeNull();
  });

  it('renders exactly 6 label elements', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    expect(container.querySelectorAll('.wfc__label')).toHaveLength(6);
  });

  it('renders jp-icon spans (Lucide icons) for each circle in full mode', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    // Each non-completed circle has its stage icon; completed has check icon
    expect(container.querySelectorAll('.jp-icon').length).toBeGreaterThan(0);
  });

  it('labels contain the six stage names', () => {
    const { container } = render(<WorkflowCircles job={makeJob('quoted')} variant="full" />);
    const labels = Array.from(container.querySelectorAll('.wfc__label')).map(l => l.textContent);
    expect(labels).toContain('Lead');
    expect(labels).toContain('Quoted');
    expect(labels).toContain('On');
    expect(labels).toContain('Invoiced');
    expect(labels).toContain('Overdue');
    expect(labels).toContain('Paid');
  });
});

// ── Accessibility ─────────────────────────────────────────────────────────────

describe('WorkflowCircles — accessibility', () => {
  it('outer wrapper has role="img"', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} />);
    expect(container.querySelector('.wfc').getAttribute('role')).toBe('img');
  });

  it('aria-label announces "Job stage: Lead" for a Lead job', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} />);
    expect(container.querySelector('.wfc').getAttribute('aria-label')).toBe('Job stage: Lead');
  });

  it('aria-label announces "Job stage: Quoted" for a Quoted job', () => {
    const { container } = render(<WorkflowCircles job={makeJob('quoted')} />);
    expect(container.querySelector('.wfc').getAttribute('aria-label')).toBe('Job stage: Quoted');
  });

  it('aria-label announces "Job stage: Invoiced — overdue" for an Overdue job', () => {
    const { container } = render(
      <WorkflowCircles job={{ status: 'invoice_sent', overdue: true }} />
    );
    expect(container.querySelector('.wfc').getAttribute('aria-label')).toBe('Job stage: Invoiced — overdue');
  });

  it('aria-label announces "Job stage: Paid" for a Paid job', () => {
    const { container } = render(<WorkflowCircles job={makeJob('paid')} />);
    expect(container.querySelector('.wfc').getAttribute('aria-label')).toBe('Job stage: Paid');
  });

  it('all wfc__step elements are aria-hidden', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} />);
    getSteps(container).forEach(step => {
      expect(step.getAttribute('aria-hidden')).toBe('true');
    });
  });
});

// ── Circle state CSS classes ──────────────────────────────────────────────────

describe('WorkflowCircles — circle state classes', () => {
  it('Lead stage: first circle is --current, rest are --future', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="compact" />);
    const circles = Array.from(getCircles(container));
    expect(circles[0].classList.contains('wfc__circle--current')).toBe(true);
    circles.slice(1).forEach(c => {
      expect(c.classList.contains('wfc__circle--future')).toBe(true);
    });
  });

  it('On stage: Lead + Quoted --completed, On --current, Invoiced + Overdue + Paid --future', () => {
    const { container } = render(<WorkflowCircles job={makeJob('active')} variant="compact" />);
    const circles = Array.from(getCircles(container));
    // Lead(0), Quoted(1) = completed
    expect(circles[0].classList.contains('wfc__circle--completed')).toBe(true);
    expect(circles[1].classList.contains('wfc__circle--completed')).toBe(true);
    // On(2) = current
    expect(circles[2].classList.contains('wfc__circle--current')).toBe(true);
    // Invoiced(3), Overdue(4), Paid(5) = future
    expect(circles[3].classList.contains('wfc__circle--future')).toBe(true);
    expect(circles[4].classList.contains('wfc__circle--future')).toBe(true);
    expect(circles[5].classList.contains('wfc__circle--future')).toBe(true);
  });

  it('Overdue stage: Overdue circle has --overdue class (not --current, not --future)', () => {
    const { container } = render(
      <WorkflowCircles job={{ status: 'invoice_sent', overdue: true }} variant="compact" />
    );
    const circles = Array.from(getCircles(container));
    const overdueCircle = circles[4]; // index 4 = Overdue
    expect(overdueCircle.classList.contains('wfc__circle--overdue')).toBe(true);
    expect(overdueCircle.classList.contains('wfc__circle--current')).toBe(false);
    expect(overdueCircle.classList.contains('wfc__circle--future')).toBe(false);
  });

  it('Paid stage (no overdue history): Overdue circle is --skipped, Paid circle is --completed (not --current)', () => {
    const { container } = render(
      <WorkflowCircles job={makeJob('paid')} variant="compact" />
    );
    const circles = Array.from(getCircles(container));
    const overdueCircle = circles[4]; // index 4 = Overdue
    const paidCircle = circles[5];    // index 5 = Paid
    expect(overdueCircle.classList.contains('wfc__circle--skipped')).toBe(true);
    expect(overdueCircle.classList.contains('wfc__circle--future')).toBe(false);
    expect(overdueCircle.classList.contains('wfc__circle--completed')).toBe(false);
    // Fix #1: Paid = terminal green, never blue current
    expect(paidCircle.classList.contains('wfc__circle--completed')).toBe(true);
    expect(paidCircle.classList.contains('wfc__circle--current')).toBe(false);
  });

  it('Paid stage with overdue history: Overdue circle is --completed, Paid is --was-overdue', () => {
    const { container } = render(
      <WorkflowCircles
        job={{ status: 'paid', overdue_history: ['2026-06-01T10:00:00Z'] }}
        variant="compact"
      />
    );
    const circles = Array.from(getCircles(container));
    const overdueCircle = circles[4];
    const paidCircle = circles[5];
    expect(overdueCircle.classList.contains('wfc__circle--completed')).toBe(true);
    expect(paidCircle.classList.contains('wfc__circle--was-overdue')).toBe(true);
  });

  it('Paid stage via legacy overdue:true fallback: Paid is --was-overdue (not --current)', () => {
    const { container } = render(
      <WorkflowCircles
        job={{ status: 'paid', overdue: true }}
        variant="compact"
      />
    );
    const circles = Array.from(getCircles(container));
    const paidCircle = circles[5];
    expect(paidCircle.classList.contains('wfc__circle--was-overdue')).toBe(true);
    expect(paidCircle.classList.contains('wfc__circle--current')).toBe(false);
  });

  it('no circle has --current class on a paid job (all-green terminal state)', () => {
    const { container } = render(
      <WorkflowCircles job={makeJob('paid')} variant="compact" />
    );
    const circles = Array.from(getCircles(container));
    const currentCircles = circles.filter(c => c.classList.contains('wfc__circle--current'));
    expect(currentCircles).toHaveLength(0);
  });
});

// ── Paid animation class ──────────────────────────────────────────────────────

describe('WorkflowCircles — paid animation class', () => {
  it('Paid circle has --paid-anim class when job stage is Paid', () => {
    const { container } = render(<WorkflowCircles job={makeJob('paid')} variant="full" />);
    const circles = Array.from(getCircles(container));
    const paidCircle = circles[5]; // index 5 = Paid
    expect(paidCircle.classList.contains('wfc__circle--paid-anim')).toBe(true);
  });

  it('Paid circle does NOT have --paid-anim class when job is not Paid', () => {
    const { container } = render(<WorkflowCircles job={makeJob('invoice_sent')} variant="full" />);
    const circles = Array.from(getCircles(container));
    const paidCircle = circles[5];
    expect(paidCircle.classList.contains('wfc__circle--paid-anim')).toBe(false);
  });

  it('--paid-anim is applied in compact variant too', () => {
    const { container } = render(<WorkflowCircles job={makeJob('paid')} variant="compact" />);
    const circles = Array.from(getCircles(container));
    const paidCircle = circles[5];
    expect(paidCircle.classList.contains('wfc__circle--paid-anim')).toBe(true);
  });
});

// ── Default variant ───────────────────────────────────────────────────────────

describe('WorkflowCircles — default variant', () => {
  it('defaults to compact when no variant prop is provided', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} />);
    expect(container.querySelector('.wfc--compact')).not.toBeNull();
    expect(container.querySelector('.wfc--full')).toBeNull();
  });
});

// ── Scope guard: filter chips not affected ────────────────────────────────────

describe('WorkflowCircles — scope (filter chips untouched)', () => {
  it('does not render a stage-strip or stage-tile element', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} />);
    expect(container.querySelector('.stage-strip')).toBeNull();
    expect(container.querySelector('.stage-tile')).toBeNull();
  });
});

// ── Null / undefined job ──────────────────────────────────────────────────────

describe('WorkflowCircles — null/undefined job', () => {
  it('renders without throwing when job is null', () => {
    expect(() => render(<WorkflowCircles job={null} />)).not.toThrow();
  });

  it('renders without throwing when job is undefined', () => {
    expect(() => render(<WorkflowCircles job={undefined} />)).not.toThrow();
  });

  it('shows Lead as current for null job (deriveDisplayStatus safe default)', () => {
    const { container } = render(<WorkflowCircles job={null} variant="compact" />);
    const circles = Array.from(getCircles(container));
    expect(circles[0].classList.contains('wfc__circle--current')).toBe(true);
  });
});

// ── Connector lines ───────────────────────────────────────────────────────────

describe('WorkflowCircles — connector lines', () => {
  it('renders 5 connector elements (one before each circle except the first)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    expect(container.querySelectorAll('.wfc__connector')).toHaveLength(5);
  });

  it('connectors before completed circles have --done class', () => {
    // Paid job: circles 0-4 are completed/skipped; connector before index 4 is between 3+4
    const { container } = render(<WorkflowCircles job={makeJob('paid')} variant="full" />);
    // First 4 connectors (before Quoted, On, Invoiced, Overdue) should be --done
    // because the preceding circles are completed
    const connectors = Array.from(container.querySelectorAll('.wfc__connector'));
    // connectors[0] is before Quoted (Lead is completed → done)
    expect(connectors[0].classList.contains('wfc__connector--done')).toBe(true);
  });
});
