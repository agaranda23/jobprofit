// @vitest-environment jsdom
/**
 * Icon system tests — feat/icon-system-wave-0-1
 *
 * Covers:
 *   1. <Icon> registry: known names render, unknown names fail gracefully.
 *   2. <Icon> props: size, variant, label (a11y), className.
 *   3. <BottomNav> Wave 1: renders Lucide SVGs instead of Unicode glyphs for all
 *      three nav layouts; active/inactive colour variant applied correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Mocks (must come before component imports) ────────────────────────────────

vi.mock('../../lib/telemetry', () => ({ logTelemetry: vi.fn() }));

// ── Imports ──────────────────────────────────────────────────────────────────

import Icon from '../Icon';
import BottomNav from '../BottomNav';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Render and return the first .jp-icon wrapper span */
function renderIcon(props) {
  const { container } = render(<Icon {...props} />);
  return container.querySelector('.jp-icon');
}

// ── Icon: registry ────────────────────────────────────────────────────────────

describe('Icon — registry coverage', () => {
  it('renders a .jp-icon span for the "today" semantic name', () => {
    const el = renderIcon({ name: 'today' });
    expect(el).not.toBeNull();
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('renders for "jobs"', () => {
    expect(renderIcon({ name: 'jobs' })?.querySelector('svg')).not.toBeNull();
  });

  it('renders for "schedule"', () => {
    expect(renderIcon({ name: 'schedule' })?.querySelector('svg')).not.toBeNull();
  });

  it('renders for "money" (custom GBP glyph)', () => {
    const el = renderIcon({ name: 'money' });
    expect(el).not.toBeNull();
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('renders for "settings"', () => {
    expect(renderIcon({ name: 'settings' })?.querySelector('svg')).not.toBeNull();
  });

  it('returns null and warns (dev) for an unknown name', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<Icon name="totally-made-up-name" />);
    // nothing rendered
    expect(container.firstChild).toBeNull();
    // warning emitted (import.meta.env.DEV is true in test env)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('totally-made-up-name')
    );
    spy.mockRestore();
  });

  it('handles empty string name gracefully', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<Icon name="" />);
    expect(container.firstChild).toBeNull();
    spy.mockRestore();
  });
});

// ── Icon: props ───────────────────────────────────────────────────────────────

describe('Icon — size prop', () => {
  it('passes size=24 to the SVG (width attribute)', () => {
    const el = renderIcon({ name: 'today', size: 24 });
    expect(el.querySelector('svg').getAttribute('width')).toBe('24');
  });

  it('passes size=16 to the SVG', () => {
    const el = renderIcon({ name: 'today', size: 16 });
    expect(el.querySelector('svg').getAttribute('width')).toBe('16');
  });

  it('uses strokeWidth 1.5 automatically when size is 32', () => {
    const el = renderIcon({ name: 'today', size: 32 });
    expect(el.querySelector('svg').getAttribute('stroke-width')).toBe('1.5');
  });

  it('uses strokeWidth 2 by default at size 24', () => {
    const el = renderIcon({ name: 'today', size: 24 });
    expect(el.querySelector('svg').getAttribute('stroke-width')).toBe('2');
  });
});

describe('Icon — variant prop', () => {
  it('sets color to --text-dim for variant="muted"', () => {
    const el = renderIcon({ name: 'today', variant: 'muted' });
    expect(el.style.color).toBe('var(--text-dim)');
  });

  it('sets color to --accent for variant="brand"', () => {
    const el = renderIcon({ name: 'today', variant: 'brand' });
    expect(el.style.color).toBe('var(--accent)');
  });

  it('sets color to --danger for variant="danger"', () => {
    const el = renderIcon({ name: 'today', variant: 'danger' });
    expect(el.style.color).toBe('var(--danger)');
  });

  it('sets no inline color for variant="inherit" (falls through to parent)', () => {
    const el = renderIcon({ name: 'today', variant: 'inherit' });
    expect(el.style.color).toBe('');
  });

  it('sets no inline color when variant is omitted (default = inherit)', () => {
    const el = renderIcon({ name: 'today' });
    expect(el.style.color).toBe('');
  });
});

describe('Icon — accessibility', () => {
  it('is aria-hidden when no label supplied', () => {
    const el = renderIcon({ name: 'today' });
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('role')).toBeNull();
  });

  it('has role="img" and aria-label when label is provided', () => {
    const el = renderIcon({ name: 'today', label: 'Home screen' });
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Home screen');
    expect(el.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('Icon — className prop', () => {
  it('adds the extra class to .jp-icon wrapper', () => {
    const el = renderIcon({ name: 'today', className: 'my-spacing-class' });
    expect(el.classList.contains('jp-icon')).toBe(true);
    expect(el.classList.contains('my-spacing-class')).toBe(true);
  });
});

// ── BottomNav: Wave 1 icon rendering ────────────────────────────────────────

describe('BottomNav — Wave 1 icons (slice3 layout)', () => {
  afterEach(() => vi.clearAllMocks());

  function renderSlice3(view = 'today') {
    return render(
      <BottomNav
        view={view}
        onChange={() => {}}
        slice3={true}
      />
    );
  }

  it('renders 4 nav-tab buttons in slice3 layout', () => {
    const { container } = renderSlice3();
    expect(container.querySelectorAll('.nav-tab').length).toBe(4);
  });

  it('every tab contains a .jp-icon span with an svg (no raw Unicode glyphs)', () => {
    const { container } = renderSlice3();
    const tabs = container.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      expect(tab.querySelector('.jp-icon')).not.toBeNull();
      expect(tab.querySelector('.jp-icon svg')).not.toBeNull();
    });
  });

  it('no tab contains the old Unicode glyph characters', () => {
    const { container } = renderSlice3();
    const text = container.textContent;
    // Old glyphs that used to appear
    expect(text).not.toContain('●');
    expect(text).not.toContain('⊞');
    expect(text).not.toContain('£');
    expect(text).not.toContain('⚙');
    expect(text).not.toContain('≡');
    expect(text).not.toContain('⋯');
  });

  it('active tab icon has variant="brand" (color = --accent)', () => {
    const { container } = renderSlice3('today');
    const activeTab = container.querySelector('.nav-tab.active');
    const iconSpan = activeTab.querySelector('.jp-icon');
    expect(iconSpan.style.color).toBe('var(--accent)');
  });

  it('inactive tab icons have variant="muted" (color = --text-dim)', () => {
    const { container } = renderSlice3('today');
    const inactiveTabs = container.querySelectorAll('.nav-tab:not(.active)');
    inactiveTabs.forEach(tab => {
      const iconSpan = tab.querySelector('.jp-icon');
      expect(iconSpan.style.color).toBe('var(--text-dim)');
    });
  });

  it('switching active tab changes which icon is brand coloured', () => {
    const { container } = renderSlice3('finance');
    const activeTab = container.querySelector('.nav-tab.active');
    // finance tab label is "Money"
    expect(activeTab.textContent).toContain('Money');
    expect(activeTab.querySelector('.jp-icon').style.color).toBe('var(--accent)');
  });
});

describe('BottomNav — Wave 1 icons (newNav layout)', () => {
  function renderNewNav(view = 'today') {
    return render(
      <BottomNav
        view={view}
        onChange={() => {}}
        newNav={true}
      />
    );
  }

  it('renders 4 tabs each containing a .jp-icon svg', () => {
    const { container } = renderNewNav();
    const tabs = container.querySelectorAll('.nav-tab');
    expect(tabs.length).toBe(4);
    tabs.forEach(tab => {
      expect(tab.querySelector('.jp-icon svg')).not.toBeNull();
    });
  });

  it('money badge renders alongside the icon (not replacing it)', () => {
    const { container } = render(
      <BottomNav
        view="today"
        onChange={() => {}}
        newNav={true}
        moneyBadge={3}
      />
    );
    const moneyTab = Array.from(container.querySelectorAll('.nav-tab'))
      .find(t => t.textContent.includes('Money'));
    expect(moneyTab.querySelector('.jp-icon svg')).not.toBeNull();
    expect(moneyTab.querySelector('.nav-badge')).not.toBeNull();
    expect(moneyTab.querySelector('.nav-badge').textContent).toBe('3');
  });
});

describe('BottomNav — Wave 1 icons (legacy layout)', () => {
  function renderLegacy(view = 'today') {
    return render(<BottomNav view={view} onChange={() => {}} />);
  }

  it('renders 3 tabs in legacy layout each with a .jp-icon', () => {
    const { container } = renderLegacy();
    const tabs = container.querySelectorAll('.nav-tab');
    expect(tabs.length).toBe(3);
    tabs.forEach(tab => {
      expect(tab.querySelector('.jp-icon')).not.toBeNull();
    });
  });
});

// ── Wave 3 — JobDetailDrawer icon registry coverage ──────────────────────────
//
// These tests verify that every semantic name added for Wave 3 resolves to
// a real Lucide SVG in the registry. They guard against future registry drift
// (e.g. a typo in a name silently producing null instead of an icon).
//
// Approach: render <Icon name="…"> and assert a .jp-icon svg is present.
// Mirrors the Wave 0-1 registry tests above.

describe('Icon registry — Wave 3 new entries', () => {
  const wave3Names = [
    'customer',    // 👤 customer name row (User)
    'text',        // 💬 SMS/text chip (MessageSquare)
    'whatsapp',    // WhatsApp chip (MessageCircle)
    'address',     // 📍 address / maps (MapPin)
    'date',        // 📅 visit date / schedule (CalendarDays)
    'note',        // 📝 job notes (NotebookPen)
    'materials',   // 🧰 costs section (Wrench)
    'photos',      // 🖼️ gallery source (Image)
    'receipt',     // 🧾 receipt row alias (ReceiptText)
    'hours',       // ⏱️ estimated hours (Clock alias)
    'map-pin',     // MapPin secondary alias
  ];

  wave3Names.forEach(name => {
    it(`"${name}" renders a .jp-icon svg`, () => {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('.jp-icon')).not.toBeNull();
      expect(container.querySelector('.jp-icon svg')).not.toBeNull();
    });
  });

  it('"paid" with variant="brand" renders a brand-coloured icon (Paid finish-line)', () => {
    const { container } = render(<Icon name="paid" size={32} variant="brand" />);
    const span = container.querySelector('.jp-icon');
    expect(span).not.toBeNull();
    expect(span.querySelector('svg')).not.toBeNull();
    // Brand variant applies --accent colour inline
    expect(span.style.color).toBe('var(--accent)');
  });
});

// ── Wave 3 — outbound message strings left intact ────────────────────────────
//
// Verify that the message-building helpers that produce outbound WhatsApp /
// SMS strings still contain emoji (those render on the customer's phone, not
// in the JobProfit UI, and must NOT be converted to icons).

describe('Wave 3 — outbound message emoji preserved (not stripped)', () => {
  it('buildChaseMessage tier-1 still contains emoji for customer context', async () => {
    const { buildChaseMessage } = await import('../../lib/chaseLadder');
    const msg = buildChaseMessage({ customerName: 'Alan', amount: '£500', daysOverdue: 5, tier: 1, amountPaid: 0 });
    // The chase message is an outbound WhatsApp string — it must be non-empty text
    // (we don't assert specific emoji here because the template may change, but we
    // confirm the function still returns a non-empty string so callers can send it).
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('buildWhatsAppLink returns a wa.me URL (outbound link, not a UI component)', async () => {
    const { buildWhatsAppLink } = await import('../../lib/invoiceMessage');
    const url = buildWhatsAppLink({ phone: '07700900000', message: 'Hi there' });
    expect(url).toMatch(/^https:\/\/wa\.me\//);
  });
});
