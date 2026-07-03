// @vitest-environment jsdom
/**
 * todayResumeDraft.test.jsx — "Resume your quote?" banner on TodayScreen.
 *
 * Covers the founder-facing pain: "if someone calls me in the middle of a
 * quote, it doesn't save." AddJobModal autosaves the in-progress form to
 * localStorage (src/lib/draftAutosave.js); this banner is the recovery UI
 * that offers to restore it the next time Today is shown.
 *
 * Mocking strategy copied from todayFirstJobNudge.test.jsx (same component,
 * same network/browser-API surface).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks required by TodayScreen and its imports ────────────────────────────

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
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
  },
}));

vi.mock('../../lib/store', () => ({
  uploadJobPhoto: vi.fn().mockResolvedValue({ url: 'https://example.com/photo.jpg' }),
  getSignedPhotoUrl: vi.fn().mockResolvedValue('https://example.com/signed.jpg'),
  deleteJobPhoto: vi.fn().mockResolvedValue(null),
  deleteJobFromCloud: vi.fn().mockResolvedValue(null),
  fetchPublicJob: vi.fn().mockResolvedValue({ data: null, error: 'not found' }),
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
  setLastUpgradeTrigger: vi.fn(),
  getLastUpgradeTrigger: vi.fn(),
  UPGRADE_TRIGGERS: {
    INSIGHT_LOCKED:     'insight_locked',
    WHITELABEL_FOOTER:  'whitelabel_footer',
    AUTO_CHASE_LOCKED:  'auto_chase_locked',
    SETTINGS:           'settings',
    TRIAL_BANNER:       'trial_banner',
    TODAY_PILL:         'today_pill',
    UPGRADE_BANNER:     'upgrade_banner',
  },
}));

vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn().mockResolvedValue({}),
  openBillingPortal: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/pushSubscribe', () => ({
  isPushSupported: vi.fn().mockReturnValue(false),
  getSubscriptionStatus: vi.fn().mockResolvedValue('unsupported'),
  subscribe: vi.fn().mockResolvedValue(null),
  unsubscribe: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../lib/invoicePDF', () => ({
  downloadInvoicePDF: vi.fn().mockResolvedValue(null),
  getInvoicePDFBlob: vi.fn().mockResolvedValue(new Blob()),
  downloadQuotePDF: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/receiptPDF', () => ({
  downloadReceiptPDF: vi.fn().mockResolvedValue(null),
  getReceiptPDFBlob: vi.fn().mockResolvedValue(new Blob()),
}));

vi.mock('../../lib/photoCompress', () => ({
  compressPhoto: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc'),
}));

vi.mock('../../lib/voiceParse', () => ({
  parseJobFromSpeech: vi.fn().mockResolvedValue({ customer: 'Test', amount: 100 }),
}));

vi.mock('../../lib/receiptOCR', () => ({
  extractReceipt: vi.fn().mockResolvedValue({ merchant: 'Screwfix', total: 20 }),
}));

vi.mock('../../lib/exportCsv', () => ({
  buildJobsCsv: vi.fn().mockReturnValue('csv,data'),
  downloadOrShareCsv: vi.fn(),
}));

vi.mock('../../lib/realtime', () => ({
  subscribeToJobs: vi.fn().mockReturnValue(() => {}),
}));

// ── Component under test ──────────────────────────────────────────────────────

import TodayScreen from '../TodayScreen';
import { saveDraft, loadDraft } from '../../lib/draftAutosave';

const NOOP = () => {};
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };

function renderToday(jobs = [], extra = {}) {
  return render(
    <TodayScreen
      jobs={jobs}
      receipts={[]}
      onAddJob={NOOP}
      onUpdateJob={NOOP}
      onOpenDetailed={NOOP}
      onMarkPaid={NOOP}
      onJobTap={NOOP}
      onNavigateToMoney={NOOP}
      onSeeTheWeek={NOOP}
      profile={PROFILE_FREE}
      {...extra}
    />
  );
}

describe('TodayScreen — Resume your quote? banner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('does not show the banner when no draft exists', () => {
    renderToday([]);
    expect(screen.queryByText(/resume your/i)).not.toBeInTheDocument();
  });

  it('shows the banner naming the job when an unsent draft exists on mount', () => {
    saveDraft({
      view: 'quote',
      summary: 'Kitchen tap',
      customer: 'Dave Jones',
      qTotal: '450',
      quoteTranscript: 'fix the kitchen tap for dave four fifty',
    });
    renderToday([]);
    expect(screen.getByText(/resume your kitchen tap quote\?/i)).toBeInTheDocument();
  });

  it('falls back to generic copy when the draft has no name/summary yet', () => {
    saveDraft({ view: 'quote', qTotal: '' , summary: '', name: '' });
    renderToday([]);
    expect(screen.getByText(/resume your unsent quote\?/i)).toBeInTheDocument();
  });

  it('Discard clears the draft and hides the banner', () => {
    saveDraft({ view: 'quote', summary: 'Kitchen tap' });
    renderToday([]);
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(loadDraft()).toBeNull();
    expect(screen.queryByText(/resume your/i)).not.toBeInTheDocument();
  });

  it('Continue opens AddJobModal restoring the summary, customer, total, and voice transcript', () => {
    saveDraft({
      view: 'quote',
      summary: 'Kitchen tap',
      customer: 'Dave Jones',
      qTotal: '450',
      quoteTranscript: 'fix the kitchen tap for dave four fifty',
    });
    renderToday([]);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // The glanceable confirm card renders these as text (see AddJobModal.jsx) —
    // proves the resumed draft, including the voice transcription, is restored.
    expect(screen.getByText('Kitchen tap')).toBeInTheDocument();
    expect(screen.getByText('Dave Jones')).toBeInTheDocument();
    expect(screen.getByText('£450')).toBeInTheDocument();
    expect(screen.getByText(/fix the kitchen tap for dave four fifty/i)).toBeInTheDocument();

    // The banner itself is hidden while the modal is open.
    expect(screen.queryByText(/resume your kitchen tap quote\?/i)).not.toBeInTheDocument();
  });
});
