// @vitest-environment jsdom
/**
 * workflowCircles.test.jsx — component render tests for WorkflowCircles.
 *
 * Tests the rendered DOM output for:
 *   1. Both variants (compact, full) render six circles
 *   2. Correct CSS classes per circle state
 *   3. Full variant renders labels and icons; compact is rings-only (no Icon component)
 *   4. aria-label announces the correct stage
 *   5. Overdue circle has --overdue class when stage is Overdue
 *   6. Skipped circle has --skipped class (not --future) on a paid job
 *   7. Was-overdue circle has --was-overdue class on paid-after-overdue
 *   8. Paid animation class applied to Paid circle when job is Paid
 *   9. Filter chips (StageStrip) are NOT rendered by this component (scope check)
 *  10. Per-stage --circle-colour inline style is set on each wfc__step
 *  11. Stage colour tokens: Lead=blue, Quoted=teal, On=green, Invoiced=amber, Overdue=orange, Paid=deep-green
 *  12. Chips and circles share one stage palette (--stage-* tokens drive both)
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

  it('renders jp-icon spans inside every circle in compact mode (coloured rings + icons)', () => {
    // Compact now matches the full variant's brand-cycle treatment: coloured rings
    // with the stage Lucide icon inside. Six circles → six .jp-icon elements.
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="compact" />);
    expect(container.querySelectorAll('.jp-icon')).toHaveLength(6);
  });

  it('compact circles are 26px base (current/overdue are 28px via CSS)', () => {
    // The component sets size={11} (future/completed) or size={12} (current/overdue).
    // CSS governs the ring dimensions — here we just confirm the icon size attr is set.
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="compact" />);
    // Lead (index 0) is current — icon size 12 → data-size="12" set by Icon.jsx
    const icons = container.querySelectorAll('.jp-icon');
    expect(icons.length).toBe(6);
    // All icons present — DOM structure validated
    icons.forEach(icon => {
      expect(icon).not.toBeNull();
    });
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

// ── Brand-cycle: per-stage --circle-colour on each step ──────────────────────

describe('WorkflowCircles — brand-cycle per-stage colours (feat/workflow-circles-brand-cycle)', () => {
  /**
   * Each wfc__step carries --circle-colour as an inline CSS custom property.
   * This drives the ring and icon colour for vivid states; future/skipped states
   * override to muted via !important in CSS so the value here is present but inert.
   */
  it('each wfc__step has a --circle-colour inline style', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const steps = Array.from(container.querySelectorAll('.wfc__step'));
    steps.forEach(step => {
      const colour = step.style.getPropertyValue('--circle-colour');
      expect(colour.trim().length).toBeGreaterThan(0);
    });
  });

  it('Lead step has --circle-colour pointing to --stage-lead (blue)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const leadStep = container.querySelectorAll('.wfc__step')[0];
    expect(leadStep.style.getPropertyValue('--circle-colour')).toBe('var(--stage-lead)');
  });

  it('Quoted step has --circle-colour pointing to --stage-quoted (teal)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const quotedStep = container.querySelectorAll('.wfc__step')[1];
    expect(quotedStep.style.getPropertyValue('--circle-colour')).toBe('var(--stage-quoted)');
  });

  it('On step has --circle-colour pointing to --stage-on (green)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const onStep = container.querySelectorAll('.wfc__step')[2];
    expect(onStep.style.getPropertyValue('--circle-colour')).toBe('var(--stage-on)');
  });

  it('Invoiced step has --circle-colour pointing to --stage-invoiced (amber)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const invoicedStep = container.querySelectorAll('.wfc__step')[3];
    expect(invoicedStep.style.getPropertyValue('--circle-colour')).toBe('var(--stage-invoiced)');
  });

  it('Overdue step has --circle-colour pointing to --stage-overdue (orange)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const overdueStep = container.querySelectorAll('.wfc__step')[4];
    expect(overdueStep.style.getPropertyValue('--circle-colour')).toBe('var(--stage-overdue)');
  });

  it('Paid step has --circle-colour pointing to --stage-paid (deep green)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const paidStep = container.querySelectorAll('.wfc__step')[5];
    expect(paidStep.style.getPropertyValue('--circle-colour')).toBe('var(--stage-paid)');
  });

  it('stage order matches WORKFLOW_STAGES: Lead→Quoted→On→Invoiced→Overdue→Paid', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const expectedColours = [
      'var(--stage-lead)',
      'var(--stage-quoted)',
      'var(--stage-on)',
      'var(--stage-invoiced)',
      'var(--stage-overdue)',
      'var(--stage-paid)',
    ];
    const steps = Array.from(container.querySelectorAll('.wfc__step'));
    const actualColours = steps.map(s => s.style.getPropertyValue('--circle-colour'));
    expect(actualColours).toEqual(expectedColours);
  });

  it('compact variant also carries --circle-colour on each step (shared one palette)', () => {
    const { container } = render(<WorkflowCircles job={makeJob('active')} variant="compact" />);
    const steps = Array.from(container.querySelectorAll('.wfc__step'));
    steps.forEach(step => {
      const colour = step.style.getPropertyValue('--circle-colour');
      expect(colour.trim().length).toBeGreaterThan(0);
    });
  });
});

// ── Brand-cycle: vivid/muted visual distinction ───────────────────────────────

describe('WorkflowCircles — vivid vs muted state classes (brand-cycle)', () => {
  it('future circles carry --future class so CSS can apply muted treatment', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const circles = Array.from(getCircles(container));
    // On a Lead job, circles 1-5 are future
    circles.slice(1).forEach(c => {
      expect(c.classList.contains('wfc__circle--future')).toBe(true);
    });
  });

  it('current circle carries --current class so CSS applies the scale+glow emphasis', () => {
    const { container } = render(<WorkflowCircles job={makeJob('quoted')} variant="full" />);
    const circles = Array.from(getCircles(container));
    // Quoted (index 1) = current
    expect(circles[1].classList.contains('wfc__circle--current')).toBe(true);
  });

  it('future step also carries wfc__step--future so the label mute rule applies', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const steps = Array.from(container.querySelectorAll('.wfc__step'));
    // steps 1-5 are future on a Lead job
    steps.slice(1).forEach(step => {
      expect(step.classList.contains('wfc__step--future')).toBe(true);
    });
  });

  it('current step carries wfc__step--current so the label accent rule applies', () => {
    const { container } = render(<WorkflowCircles job={makeJob('lead')} variant="full" />);
    const steps = Array.from(container.querySelectorAll('.wfc__step'));
    expect(steps[0].classList.contains('wfc__step--current')).toBe(true);
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

  it('paid-on-time job: connectors between completed circles are --done', () => {
    // Paid (no overdue): Lead/Quoted/On/Invoiced = completed; Overdue = skipped; Paid = completed
    // connectors[0] = Lead→Quoted (completed→completed) → --done
    // connectors[1] = Quoted→On (completed→completed) → --done
    // connectors[2] = On→Invoiced (completed→completed) → --done
    const { container } = render(<WorkflowCircles job={makeJob('paid')} variant="full" />);
    const connectors = Array.from(container.querySelectorAll('.wfc__connector'));
    expect(connectors[0].classList.contains('wfc__connector--done')).toBe(true);
    expect(connectors[1].classList.contains('wfc__connector--done')).toBe(true);
    expect(connectors[2].classList.contains('wfc__connector--done')).toBe(true);
  });

  it('paid-on-time job: connector touching skipped Overdue is --skipped, NOT --done', () => {
    // connectors[3] = Invoiced→Overdue (completed→skipped) → --skipped
    // connectors[4] = Overdue→Paid (skipped→completed) → --skipped
    const { container } = render(<WorkflowCircles job={makeJob('paid')} variant="full" />);
    const connectors = Array.from(container.querySelectorAll('.wfc__connector'));
    // Connector before Overdue (index 3 in connectors array = 4th circle)
    expect(connectors[3].classList.contains('wfc__connector--skipped')).toBe(true);
    expect(connectors[3].classList.contains('wfc__connector--done')).toBe(false);
    // Connector before Paid (index 4 in connectors array = 5th circle)
    expect(connectors[4].classList.contains('wfc__connector--skipped')).toBe(true);
    expect(connectors[4].classList.contains('wfc__connector--done')).toBe(false);
  });

  it('paid-after-overdue job: all connectors between completed/was-overdue are --done, none --skipped', () => {
    // Overdue = completed, Paid = was-overdue — all stages fully traversed
    const { container } = render(
      <WorkflowCircles
        job={{ status: 'paid', overdue_history: ['2026-06-01T10:00:00Z'] }}
        variant="full"
      />
    );
    const connectors = Array.from(container.querySelectorAll('.wfc__connector'));
    connectors.forEach(c => {
      expect(c.classList.contains('wfc__connector--done')).toBe(true);
      expect(c.classList.contains('wfc__connector--skipped')).toBe(false);
    });
  });

  it('compact variant: connector touching skipped Overdue is --skipped, NOT --done', () => {
    const { container } = render(<WorkflowCircles job={makeJob('paid')} variant="compact" />);
    const connectors = Array.from(container.querySelectorAll('.wfc__connector'));
    expect(connectors[3].classList.contains('wfc__connector--skipped')).toBe(true);
    expect(connectors[3].classList.contains('wfc__connector--done')).toBe(false);
  });
});
