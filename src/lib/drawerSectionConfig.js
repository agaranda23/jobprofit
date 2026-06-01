/**
 * drawerSectionConfig.js
 *
 * Single source of truth for which sections render expanded vs collapsed vs
 * hidden in the Job Detail Drawer depending on the job's derived stage.
 *
 * Imported by JobDetailDrawer.jsx to drive the stage-aware layout (Direction 2).
 *
 * Stage values match deriveStatus() output:
 *   'Lead' | 'Quoted' | 'Active' | 'Done' | 'Invoiced' | 'Overdue' | 'Paid'
 *
 * Return shape per section entry:
 *   id        – unique key used as React key and aria-controls target
 *   label     – human-readable section name (used in collapsed one-liner title)
 *   display   – 'expanded' | 'collapsed' | 'hidden'
 *
 * 'expanded'  → full section card rendered as normal
 * 'collapsed' → collapsed one-liner row with chevron; tap to toggle inline
 * 'hidden'    → section is not rendered at all for this stage
 *
 * Sections not present in the drawer (e.g. pills row, modals) are not listed
 * here — they are always rendered by the parent.
 */

const SECTION_ORDER = [
  'nextStep',
  'payment',
  'payments',
  'profit',
  'customer',
  'quote',
];

/**
 * Returns a flat array of section config objects for the given stage.
 * Order in the array = render order in the drawer.
 */
export function getDrawerSectionConfig(stage) {
  switch (stage) {
    case 'Lead':
      return [
        { id: 'nextStep',  display: 'expanded' },
        { id: 'payment',   display: 'hidden'   },
        { id: 'payments',  display: 'hidden'   },
        { id: 'profit',    display: 'hidden'   },
        { id: 'customer',  display: 'collapsed' },
        { id: 'quote',     display: 'collapsed' },
      ];

    case 'Quoted':
      return [
        { id: 'nextStep',  display: 'expanded'  },
        { id: 'payment',   display: 'expanded'  },
        { id: 'payments',  display: 'expanded'  },
        { id: 'profit',    display: 'collapsed' },
        { id: 'customer',  display: 'collapsed' },
        { id: 'quote',     display: 'expanded'  },
      ];

    case 'Active':
      return [
        { id: 'nextStep',  display: 'expanded'  },
        { id: 'payment',   display: 'expanded'  },
        { id: 'payments',  display: 'expanded'  },
        { id: 'profit',    display: 'collapsed' },
        { id: 'customer',  display: 'collapsed' },
        { id: 'quote',     display: 'collapsed' },
      ];

    case 'Done':
      return [
        { id: 'nextStep',  display: 'expanded'  },
        { id: 'payment',   display: 'hidden'    },
        { id: 'payments',  display: 'hidden'    },
        { id: 'profit',    display: 'collapsed' },
        { id: 'customer',  display: 'collapsed' },
        { id: 'quote',     display: 'collapsed' },
      ];

    case 'Invoiced':
    case 'Overdue':
      return [
        { id: 'nextStep',  display: 'expanded'  },
        { id: 'payment',   display: 'expanded'  },
        { id: 'payments',  display: 'expanded'  },
        { id: 'profit',    display: 'collapsed' },
        { id: 'customer',  display: 'collapsed' },
        { id: 'quote',     display: 'collapsed' },
      ];

    case 'Paid':
      return [
        { id: 'nextStep',  display: 'expanded'  },
        { id: 'payment',   display: 'hidden'    },
        { id: 'payments',  display: 'expanded'  },
        { id: 'profit',    display: 'collapsed' },
        { id: 'customer',  display: 'collapsed' },
        { id: 'quote',     display: 'collapsed' },
      ];

    default:
      // Fallback: show everything expanded (unknown / legacy stage)
      return SECTION_ORDER.map(id => ({ id, display: 'expanded' }));
  }
}
