// @vitest-environment jsdom
/**
 * Settings → Materials row
 *
 * Verifies that the "Materials" row in Invoice settings calls onBrowseMaterials
 * when tapped. This is the front door to the Materials library introduced in
 * fix/materials-frontdoor-and-tidies.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
  setLastUpgradeTrigger: vi.fn(),
  getLastUpgradeTrigger: vi.fn(),
  UPGRADE_TRIGGERS: {
    INSIGHT_LOCKED:    'insight_locked',
    WHITELABEL_FOOTER: 'whitelabel_footer',
    AUTO_CHASE_LOCKED: 'auto_chase_locked',
    SETTINGS:          'settings',
    TRIAL_BANNER:      'trial_banner',
    TODAY_PILL:        'today_pill',
    UPGRADE_BANNER:    'upgrade_banner',
  },
}));

vi.mock('../../lib/billing', () => ({
  startCheckout:    vi.fn().mockResolvedValue({}),
  openBillingPortal: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/pushSubscribe', () => ({
  isPushSupported:     vi.fn().mockReturnValue(false),
  getSubscriptionStatus: vi.fn().mockResolvedValue('unsupported'),
  subscribe:           vi.fn().mockResolvedValue(null),
  unsubscribe:         vi.fn().mockResolvedValue(false),
}));

vi.mock('../../lib/consent', () => ({
  getConsent: vi.fn().mockReturnValue('denied'),
  setConsent: vi.fn(),
}));

vi.mock('../../lib/cashflow', () => ({
  getOverheadTotal: vi.fn().mockReturnValue(0),
}));

vi.mock('../../lib/overheads', () => ({
  OVERHEAD_CATEGORIES: ['Other'],
}));

vi.mock('../../lib/plan', () => ({
  isPro:            vi.fn().mockReturnValue(false),
  isTrialActive:    vi.fn().mockReturnValue(false),
  trialDaysLeft:    vi.fn().mockReturnValue(0),
  UNLOCK_PRO_FOR_ALL: false,
}));

vi.mock('../../lib/bizValidation', () => ({
  isValidStripePaymentLink: vi.fn().mockReturnValue(false),
}));

vi.mock('../../lib/exportCsv', () => ({
  buildJobsCsv:      vi.fn().mockReturnValue(''),
  downloadOrShareCsv: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/chaseList', () => ({
  buildChaseList: vi.fn().mockReturnValue([]),
}));

vi.mock('../../lib/whatsNew', () => ({
  WHATS_NEW:          [],
  formatWhatsNewDate: vi.fn().mockReturnValue(''),
}));

vi.mock('../../lib/theme', () => ({
  getStoredPref: vi.fn().mockReturnValue('system'),
  setPref:       vi.fn(),
}));

// ── Component under test ─────────────────────────────────────────────────────

import SettingsScreen from '../SettingsScreen';

const SESSION = { user: { id: 'user-1', email: 'test@example.com' } };
const PROFILE = {
  plan:             'free',
  first_name:       'Test',
  last_name:        'User',
  business_name:    'Test Co',
  sort_code:        '04-00-04',
  account_number:   '12345678',
  default_markup:   20,
};
const NOOP = vi.fn();

afterEach(() => vi.clearAllMocks());

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Settings — Materials row', () => {
  it('renders a "Materials" row in Invoice settings', () => {
    render(
      <SettingsScreen
        session={SESSION}
        profile={PROFILE}
        jobs={[]}
        receipts={[]}
        onSignOut={NOOP}
        onOpenWizard={NOOP}
        onProfileUpdate={NOOP}
        onOpenJob={NOOP}
        onBrowseMaterials={NOOP}
      />
    );
    // The row label is exactly "Materials" — use getAllByRole and filter to the
    // exact label text to distinguish from "Itemise labour & materials on documents".
    const btns = screen.getAllByRole('button', { name: /materials/i });
    const materialsRow = btns.find(
      btn => btn.querySelector('.settings-row-label')?.textContent === 'Materials'
    );
    expect(materialsRow).toBeTruthy();
  });

  it('calls onBrowseMaterials when the Materials row is tapped', () => {
    const onBrowseMaterials = vi.fn();
    render(
      <SettingsScreen
        session={SESSION}
        profile={PROFILE}
        jobs={[]}
        receipts={[]}
        onSignOut={NOOP}
        onOpenWizard={NOOP}
        onProfileUpdate={NOOP}
        onOpenJob={NOOP}
        onBrowseMaterials={onBrowseMaterials}
      />
    );
    const btns = screen.getAllByRole('button', { name: /materials/i });
    const materialsRow = btns.find(
      btn => btn.querySelector('.settings-row-label')?.textContent === 'Materials'
    );
    fireEvent.click(materialsRow);
    expect(onBrowseMaterials).toHaveBeenCalledTimes(1);
  });

  it('renders without crash when onBrowseMaterials is not provided', () => {
    expect(() =>
      render(
        <SettingsScreen
          session={SESSION}
          profile={PROFILE}
          jobs={[]}
          receipts={[]}
          onSignOut={NOOP}
          onOpenWizard={NOOP}
          onProfileUpdate={NOOP}
          onOpenJob={NOOP}
        />
      )
    ).not.toThrow();
  });
});
