import { describe, it, expect } from 'vitest';
import { requiresPriceForStage } from '../../lib/jobStatus';

// Helpers to build minimal job objects for the guard predicate.
const withPrice = (amount = 250) => ({ amount });
const noPrice   = ()             => ({ amount: null });

describe('requiresPriceForStage — money-stage guard', () => {
  // Table-driven: [currentStage label (informational), targetStage, job, expectedGuardFires]
  // currentStage is not an input to requiresPriceForStage — the rule is target-only.
  // It is included in the test name for readability only.
  const cases = [
    // New behaviour: On is NOT a money stage → guard must NOT fire
    { from: 'Lead',     to: 'On',       job: noPrice(),   fires: false },

    // Money stages: guard fires for all of them when no price
    { from: 'Lead',     to: 'Quoted',   job: noPrice(),   fires: true  },
    { from: 'Lead',     to: 'Invoiced', job: noPrice(),   fires: true  },
    { from: 'Lead',     to: 'Overdue',  job: noPrice(),   fires: true  },
    { from: 'Lead',     to: 'Paid',     job: noPrice(),   fires: true  },

    // Staying at Lead: no money claim → no guard
    { from: 'Lead',     to: 'Lead',     job: noPrice(),   fires: false },

    // Price present: guard never fires regardless of target
    { from: 'Lead',     to: 'Quoted',   job: withPrice(), fires: false },
    { from: 'Lead',     to: 'Invoiced', job: withPrice(), fires: false },
    { from: 'Lead',     to: 'Paid',     job: withPrice(), fires: false },
    { from: 'Lead',     to: 'On',       job: withPrice(), fires: false },

    // Source-agnostic improvement: On → money stage fires even though source is not Lead
    { from: 'On',       to: 'Invoiced', job: noPrice(),   fires: true  },
    { from: 'On',       to: 'Paid',     job: noPrice(),   fires: true  },
    { from: 'On',       to: 'Quoted',   job: noPrice(),   fires: true  },

    // On → Lead: moving backwards, no money claim → no guard
    { from: 'On',       to: 'Lead',     job: noPrice(),   fires: false },

    // Quoted → On: backwards to a non-money stage → no guard
    { from: 'Quoted',   to: 'On',       job: noPrice(),   fires: false },

    // Invoiced → Paid: still a money stage → guard fires
    { from: 'Invoiced', to: 'Paid',     job: noPrice(),   fires: true  },
  ];

  it.each(cases)(
    '$from → $to, hasPrice=$job.amount: guard fires=$fires',
    ({ to, job, fires }) => {
      expect(requiresPriceForStage(job, to)).toBe(fires);
    },
  );
});
