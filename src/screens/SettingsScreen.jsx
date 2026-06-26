/**
 * SettingsScreen — Slice-3 replacement for the top-right AccountDrawer.
 *
 * When jp.navSlice3 is active, this screen renders as the 4th tab.
 * The AccountDrawer and HeaderAvatar are NOT mounted when slice 3 is active
 * (suppressed in AppShell) — this screen is the single account entry point.
 *
 * Navigation model (Phase 2):
 *   Hub view: pinned identity card + subscription + 8 category rows.
 *   All 8 rows now navigate to dedicated sub-screens.
 *
 *   settingsView state:
 *     'hub' | 'invoices' | 'getpaid' | 'costs'
 *     | 'account' | 'notifications' | 'privacy' | 'help' | 'app' | 'voice'
 *
 *   history.pushState is called on sub-screen open; a popstate handler returns
 *   the user to hub (or, for nested 'voice', to 'account') so the PWA
 *   hardware back button works correctly.
 *
 * overheadsRef deep-link REPLACED (Phase 1):
 *   AppShell previously passed scrollTarget='overheads' to scroll the flat list.
 *   With Monthly bills now on the Costs sub-screen, receiving scrollTarget='overheads'
 *   instead NAVIGATES to settingsView='costs'. The ref and scroll effect are removed.
 *
 * Subscription slot seam:
 *   <SubscriptionCard> is the single pinned component on the hub.
 *   When the founding-member branch lands, the precedence will be:
 *     foundingEligible ? <FoundingMemberCard/> : <SubscriptionCard/>
 *   A comment marks the exact insertion point.
 *
 * Judgement calls documented here:
 *   1. "Re-run setup wizard" row is a manual escape hatch — always available.
 *   2. Logo row opens the LogoModal (upload or URL).
 *   3. Theme picker: Light / Dark / System segmented control.
 *   4. Version is imported from package.json via Vite's JSON import.
 *   5. Editable rows use EditFieldModal. Saves bubble up via onProfileUpdate.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import pkg from '../../package.json';
import { supabase } from '../lib/supabase.js';
import {
  buildReferralLink,
  copyReferralLink,
  ensureReferralCode,
} from '../lib/referral.js';
import { logTelemetry, UPGRADE_TRIGGERS } from '../lib/telemetry.js';

const LOGOS_BUCKET = 'logos';
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — matches bucket file_size_limit
import EditFieldModal from '../components/EditFieldModal.jsx';
import Icon from '../components/Icon.jsx';
import {
  isPushSupported,
  getSubscriptionStatus,
  subscribe as pushSubscribe,
  unsubscribe as pushUnsubscribe,
} from '../lib/pushSubscribe.js';
import { OVERHEAD_CATEGORIES } from '../lib/overheads.js';
import { getOverheadTotal } from '../lib/cashflow.js';
import { isPro, isTrialActive, trialDaysLeft, UNLOCK_PRO_FOR_ALL } from '../lib/plan.js';
import { openBillingPortal } from '../lib/billing.js';
import { isValidStripePaymentLink } from '../lib/bizValidation.js';
import { addJobToCloud } from '../lib/store.js';
import { buildJobsCsv, buildEverythingCsv, downloadOrShareCsv } from '../lib/exportCsv.js';
import { buildJobsPdf } from '../lib/exportPdf.js';
import { buildJobsXlsx } from '../lib/exportXlsx.js';
import { downloadOrShare } from '../lib/exportCsv.js';
import { buildChaseList } from '../lib/chaseList.js';
import { WHATS_NEW, formatWhatsNewDate } from '../lib/whatsNew.js';
import { getStoredPref, setPref as setThemePref } from '../lib/theme.js';
import ProUpgradeSheet from '../components/ProUpgradeSheet.jsx';
import ExportFormatSheet from '../components/ExportFormatSheet.jsx';
import SpreadsheetImporter from '../components/SpreadsheetImporter.jsx';
import { getConsent, setConsent } from '../lib/consent.js';

const APP_VERSION = pkg.version;

// ── Share / contact helpers ───────────────────────────────────────────────────

export function buildShareData() {
  return {
    title: 'OHNAR',
    text: "I use OHNAR to quote, invoice and get paid from my phone — give it a go.",
    url: 'https://jobprofit.co.uk',
  };
}

export function buildWhatsAppSupportUrl() {
  return 'https://wa.me/447411353356?text=Hi%2C%20I\'ve%20got%20a%20question%20about%20OHNAR';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveInitials(profile, session) {
  const firstName = profile?.first_name?.trim();
  const lastName  = profile?.last_name?.trim();
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  const email = session?.user?.email || '';
  if (!email) return '?';
  const local = email.split('@')[0];
  const parts = local.split(/[._\-+]/);
  if (parts.length >= 2 && parts[0] && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  const alpha = local.replace(/[^a-zA-Z]/g, '');
  return alpha.slice(0, 2).toUpperCase() || '?';
}

/** Strip non-digits then format as XX-XX-XX (up to 6 digits). */
function formatSortCode(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

// ── Validation helpers ────────────────────────────────────────────────────────

function validateNonEmpty(v) {
  return v.trim() ? null : 'This field is required';
}

function validateAccountNumber(v) {
  const digits = v.replace(/\D/g, '');
  return digits.length === 8 ? null : 'Must be 8 digits';
}

function validateHourlyRate(v) {
  if (v === '' || v === null || v === undefined) return null; // optional
  const n = parseFloat(v);
  if (isNaN(n) || n < 0) return 'Must be a positive number';
  return null;
}

function validateTaxSetAsidePct(v) {
  if (v === '' || v === null || v === undefined) return null; // optional — defaults to 20
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 0 || n > 100) return 'Must be a whole number between 0 and 100';
  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, subline, children }) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">{title}</div>
      {subline && <div className="settings-section-subline">{subline}</div>}
      <div className="settings-card">{children}</div>
    </div>
  );
}

function Row({ label, value, action, onTap, danger = false, chevron = true, highlight = false }) {
  const handleClick = onTap || undefined;
  const classes = [
    'settings-row',
    danger && 'settings-row--danger',
    !onTap && 'settings-row--passive',
    highlight && 'settings-row--gold',
  ].filter(Boolean).join(' ');
  return (
    <button
      className={classes}
      onClick={handleClick}
      disabled={!onTap}
      type="button"
    >
      <span className="settings-row-label">{label}</span>
      <span className="settings-row-right">
        {value && <span className="settings-row-value">{value}</span>}
        {action && <span className="settings-row-action">{action}</span>}
        {chevron && <span className="settings-row-chevron">›</span>}
      </span>
    </button>
  );
}

function PlaceholderRow({ label }) {
  return (
    <Row
      label={label}
      action="Coming soon"
      chevron={false}
    />
  );
}

// ── CookieSettingsRow ─────────────────────────────────────────────────────────
// Shows current analytics consent state and lets the user toggle it.
// Withdrawal is as easy as granting (single tap, no confirmation step).

function CookieSettingsRow() {
  const [consent, setConsentState] = useState(() => getConsent());

  function handleToggle() {
    const next = consent === 'granted' ? 'denied' : 'granted';
    setConsent(next);
    setConsentState(next);
  }

  const label = consent === 'granted' ? 'Analytics on' : 'Analytics off';

  return (
    <Row
      label="Cookie settings"
      value={label}
      onTap={handleToggle}
      chevron={false}
    />
  );
}

// ── FaqItem — expandable Q&A row inside Help SectionCard ─────────────────────

function FaqItem({ question, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="settings-faq-item">
      <button
        type="button"
        className="settings-row settings-faq-q"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="settings-row-label">{question}</span>
        <span className="settings-row-right">
          <span className="settings-row-chevron" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
        </span>
      </button>
      {open && (
        <div className="settings-faq-a">
          {children}
        </div>
      )}
    </div>
  );
}

// ── NotificationsSection ──────────────────────────────────────────────────────

function NotificationsSection({ session }) {
  const [status, setStatus] = useState('loading');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setStatus('unsupported');
      return;
    }
    getSubscriptionStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, []);

  const handleToggle = async () => {
    if (working) return;
    setWorking(true);
    try {
      if (status === 'granted-subscribed') {
        await pushUnsubscribe();
        setStatus('granted-unsubscribed');
      } else {
        const permission = await Notification.requestPermission();
        if (permission === 'granted' && session?.user?.id) {
          const sub = await pushSubscribe(session.user.id);
          setStatus(sub ? 'granted-subscribed' : 'granted-unsubscribed');
        } else if (permission === 'denied') {
          setStatus('denied');
        }
      }
    } catch {
      // Fail silently — status stays where it was
    } finally {
      setWorking(false);
    }
  };

  if (status === 'loading') {
    return <Row label="Quote signed alerts" value="Checking..." chevron={false} />;
  }
  if (status === 'unsupported') {
    return (
      <Row
        label="Quote signed alerts"
        value="Not supported on this browser"
        chevron={false}
      />
    );
  }
  if (status === 'denied') {
    return (
      <Row
        label="Quote signed alerts"
        value="Blocked — enable in phone settings"
        chevron={false}
      />
    );
  }

  const isOn = status === 'granted-subscribed';
  return (
    <Row
      label="Quote signed alerts"
      value={working ? 'Updating…' : isOn ? 'On' : 'Off'}
      onTap={handleToggle}
      chevron={false}
    />
  );
}

// ── WeeklyDigestRow ───────────────────────────────────────────────────────────
// Bound to profiles.weekly_digest_enabled (boolean, default true).
// The column is added by supabase/migrations/20260531100000_add_weekly_digest_enabled.sql.
// The push itself is a no-op until VAPID keys are set in Netlify env (founder action).

function WeeklyDigestRow({ profile, onProfileUpdate }) {
  // Derive initial state from profile; treat null/undefined as true (opt-out default)
  const [enabled, setEnabled] = useState(
    () => profile?.weekly_digest_enabled !== false
  );
  const [working, setWorking] = useState(false);

  // Keep in sync if the parent profile reloads (e.g. after a save elsewhere)
  useEffect(() => {
    setEnabled(profile?.weekly_digest_enabled !== false);
  }, [profile?.weekly_digest_enabled]);

  const handleToggle = async () => {
    if (working) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setWorking(true);
    try {
      await onProfileUpdate({ weekly_digest_enabled: next });
    } catch {
      setEnabled(!next); // revert on failure
    } finally {
      setWorking(false);
    }
  };

  // Only meaningful when push is supported and user is subscribed
  if (!isPushSupported()) return null;

  return (
    <Row
      label="Weekly profit digest"
      value={working ? 'Updating…' : enabled ? 'On' : 'Off'}
      onTap={handleToggle}
      chevron={false}
    />
  );
}

// ── RemindJobCostsRow ─────────────────────────────────────────────────────────
// Bound to profiles.remind_job_costs (boolean, default true).
// When on: after marking a job paid with £0 costs, the app asks once per job.
// When off: no cost-capture prompt is shown on mark-paid.

function RemindJobCostsRow({ profile, onProfileUpdate }) {
  const [enabled, setEnabled] = useState(
    () => profile?.remind_job_costs !== false
  );
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setEnabled(profile?.remind_job_costs !== false);
  }, [profile?.remind_job_costs]);

  const handleToggle = async () => {
    if (working) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setWorking(true);
    try {
      await onProfileUpdate({ remind_job_costs: next });
    } catch {
      setEnabled(!next); // revert on failure
    } finally {
      setWorking(false);
    }
  };

  return (
    <Row
      label="Remind me to add job costs"
      value={working ? 'Updating…' : enabled ? 'On' : 'Off'}
      onTap={handleToggle}
      chevron={false}
    />
  );
}

// ── AutoChaseRow ──────────────────────────────────────────────────────────────
// Bound to profiles.auto_chase_enabled (boolean, default true).
// Column added by supabase/migrations/20260601200000_add_auto_chase_enabled.sql.
// Pro/trial only — free users see a Pro upsell label instead of an active toggle.

function AutoChaseRow({ profile, onProfileUpdate, onUpgrade }) {
  const proUser = isPro(profile);

  const [enabled, setEnabled] = useState(
    () => profile?.auto_chase_enabled !== false
  );
  const [working, setWorking] = useState(false);

  // Keep in sync if the parent profile reloads (e.g. after a save elsewhere)
  useEffect(() => {
    setEnabled(profile?.auto_chase_enabled !== false);
  }, [profile?.auto_chase_enabled]);

  if (!proUser) {
    // Free user — tapping opens the upgrade sheet with auto_chase_locked attribution.
    return (
      <Row
        label="Auto-chase reminders"
        value="Pro"
        chevron={!!onUpgrade}
        onTap={onUpgrade ?? undefined}
      />
    );
  }

  const handleToggle = async () => {
    if (working) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setWorking(true);
    try {
      await onProfileUpdate({ auto_chase_enabled: next });
    } catch {
      setEnabled(!next); // revert on failure
    } finally {
      setWorking(false);
    }
  };

  return (
    <Row
      label="Auto-chase reminders"
      value={working ? 'Updating…' : enabled ? 'On' : 'Off'}
      onTap={handleToggle}
      chevron={false}
    />
  );
}

// ── CIS subcontractor setup sheet ────────────────────────────────────────────
// Shown when the CIS row in Invoice settings is tapped.
// Manages its own local state; saves via onProfileUpdate on close.

const CIS_RATES = [
  { value: 20, label: '20% — Registered' },
  { value: 30, label: '30% — Not registered' },
  { value: 0,  label: '0% — Gross status' },
];

function CisSetupSheet({ profile, onProfileUpdate, onClose }) {
  const [isOn, setIsOn] = useState(() => !!profile?.is_cis_subcontractor);
  const [rate, setRate] = useState(() => Number(profile?.cis_default_rate ?? 20));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await onProfileUpdate({
        is_cis_subcontractor: isOn,
        cis_default_rate: isOn ? rate : 20,
      });
      onClose();
    } catch {
      setError('Could not save — try again');
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="CIS subcontractor setup"
      onClick={onClose}
    >
      <div
        className="modal cis-setup-sheet"
        onClick={e => e.stopPropagation()}
      >
        <div className="cis-sheet__header">
          <h2 className="modal-title">CIS subcontractor</h2>
          <button
            type="button"
            className="chase-list-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="cis-sheet__body">
          <p className="cis-sheet__explainer">
            Do contractors deduct tax from your pay before you get it? That&rsquo;s CIS
            (Construction Industry Scheme). If yes, OHNAR can track it so your
            Tax Pot is accurate.
          </p>

          <div className="cis-sheet__toggle-row">
            <span className="cis-sheet__toggle-label">I&rsquo;m a CIS subcontractor</span>
            <button
              type="button"
              className={`cis-sheet__toggle${isOn ? ' cis-sheet__toggle--on' : ''}`}
              onClick={() => setIsOn(v => !v)}
              role="switch"
              aria-checked={isOn}
            >
              {isOn ? 'On' : 'Off'}
            </button>
          </div>

          {isOn && (
            <>
              <p className="cis-sheet__rate-label">Your CIS deduction rate</p>
              <div className="work-segments cis-sheet__rate-segments">
                {CIS_RATES.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    className={`work-segment${rate === r.value ? ' work-segment--active' : ''}`}
                    onClick={() => setRate(r.value)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="cis-sheet__rate-hint">
                Not sure? Most registered subbies are on 20%. Check your CIS statement
                or ask your contractor.
              </p>
            </>
          )}

          {error && <p className="settings-row-error">{error}</p>}

          <button
            type="button"
            className="cis-sheet__save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Trade type setup sheet ────────────────────────────────────────────────────
// Shown when the "Your trade" row in Settings is tapped.
// Multi-select chip grid (max 3). When 2+ selected, one must be starred primary.
// "Other" chip reveals a free-text input stored in trade_other.
// Saves three profile fields: trade_types, trade_primary, trade_other.

export const TRADE_CHIPS = [
  { key: 'plumber',              label: 'Plumber' },
  { key: 'gas_engineer',         label: 'Gas engineer' },
  { key: 'heating_engineer',     label: 'Heating engineer' },
  { key: 'electrician',          label: 'Electrician' },
  { key: 'builder',              label: 'Builder' },
  { key: 'carpenter_joiner',     label: 'Carpenter/Joiner' },
  { key: 'decorator',            label: 'Decorator' },
  { key: 'plasterer',            label: 'Plasterer' },
  { key: 'roofer',               label: 'Roofer' },
  { key: 'tiler',                label: 'Tiler' },
  { key: 'landscaper_groundworker', label: 'Landscaper/Groundworker' },
  { key: 'other',                label: 'Other' },
];

const TRADE_MAX = 3;

/** Derive the Settings row value string from profile fields. */
export function deriveTradeRowValue(profile) {
  const types   = Array.isArray(profile?.trade_types) ? profile.trade_types : [];
  const primary = profile?.trade_primary || null;
  if (types.length === 0) return null; // caller renders "Not set"
  // "other" key always uses free-text, never the generic chip label
  let primaryLabel;
  if (primary === 'other') {
    primaryLabel = profile?.trade_other?.trim() || 'Other';
  } else {
    const chip = TRADE_CHIPS.find(c => c.key === primary);
    primaryLabel = chip ? chip.label : null;
  }
  if (!primaryLabel) return null;
  const extras = types.filter(k => k !== primary).length;
  if (extras === 0) return primaryLabel;
  return `${primaryLabel} · +${extras}`;
}

function TradeSetupSheet({ profile, onProfileUpdate, onClose }) {
  const initTypes = Array.isArray(profile?.trade_types) ? profile.trade_types : [];
  const initPrimary = profile?.trade_primary || (initTypes[0] ?? null);
  const initOther  = profile?.trade_other || '';

  const [selected, setSelected]   = useState(initTypes);
  const [primary, setPrimary]     = useState(initPrimary);
  const [otherText, setOtherText] = useState(initOther);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  function toggleChip(key) {
    setSelected(prev => {
      if (prev.includes(key)) {
        // Deselecting — if this was primary, reassign primary to first remaining
        const next = prev.filter(k => k !== key);
        if (primary === key) {
          setPrimary(next[0] ?? null);
        }
        return next;
      }
      // Selecting — enforce max
      if (prev.length >= TRADE_MAX) return prev;
      const next = [...prev, key];
      // Auto-assign primary when first chip is picked
      if (!primary) setPrimary(key);
      return next;
    });
  }

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const resolvedPrimary = selected.length > 0
        ? (primary && selected.includes(primary) ? primary : selected[0])
        : null;
      await onProfileUpdate({
        trade_types:   selected.length > 0 ? selected : null,
        trade_primary: resolvedPrimary,
        trade_other:   selected.includes('other') ? (otherText.trim() || null) : null,
      });
      logTelemetry('trade_type_saved', {
        trade_types:   selected.length > 0 ? selected : null,
        trade_primary: resolvedPrimary,
      });
      onClose();
    } catch {
      setError('Could not save — try again');
      setSaving(false);
    }
  };

  const showOther = selected.includes('other');
  const showPrimaryHint = selected.length >= 2;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Your trade"
      onClick={onClose}
    >
      <div
        className="modal cis-setup-sheet trade-setup-sheet"
        onClick={e => e.stopPropagation()}
      >
        <div className="cis-sheet__header">
          <h2 className="modal-title">What&rsquo;s your trade?</h2>
          <button
            type="button"
            className="chase-list-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="cis-sheet__body">
          <p className="cis-sheet__explainer">
            Pick what you do. We&rsquo;ll tailor OHNAR to suit — and it helps us
            build the right tools for your trade.
          </p>

          <p className="trade-sheet__hint">
            Do more than one? Add up to three.
          </p>

          <div className="trade-sheet__chip-grid" role="group" aria-label="Select your trade">
            {TRADE_CHIPS.map(({ key, label }) => {
              const isOn      = selected.includes(key);
              const isPrimary = isOn && primary === key;
              const isMaxed   = !isOn && selected.length >= TRADE_MAX;
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    'trade-sheet__chip',
                    isOn      && 'trade-sheet__chip--on',
                    isPrimary && 'trade-sheet__chip--primary',
                    isMaxed   && 'trade-sheet__chip--maxed',
                  ].filter(Boolean).join(' ')}
                  onClick={() => toggleChip(key)}
                  disabled={isMaxed}
                  aria-pressed={isOn}
                >
                  {showPrimaryHint && isOn && (
                    <span
                      className={`trade-sheet__star${isPrimary ? ' trade-sheet__star--active' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={isPrimary ? 'Primary trade' : 'Set as primary trade'}
                      onClick={e => { e.stopPropagation(); if (isOn) setPrimary(key); }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (isOn) setPrimary(key); } }}
                    >
                      <Icon
                        name="star"
                        size={16}
                        variant={isPrimary ? 'brand' : 'muted'}
                      />
                    </span>
                  )}
                  {label}
                </button>
              );
            })}
          </div>

          {showPrimaryHint && (
            <p className="trade-sheet__hint trade-sheet__hint--star">
              Star your main one.
            </p>
          )}

          {showOther && (
            <div className="trade-sheet__other-wrap">
              <input
                type="text"
                className="trade-sheet__other-input"
                placeholder="Tell us your trade"
                value={otherText}
                onChange={e => setOtherText(e.target.value)}
                aria-label="Your trade (free text)"
                autoFocus
              />
            </div>
          )}

          {error && <p className="settings-row-error">{error}</p>}

          <button
            type="button"
            className="cis-sheet__save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Voice language picker ─────────────────────────────────────────────────────

const VOICE_LANGS = [
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'pl-PL', label: 'Polski' },
  { code: 'ro-RO', label: 'Română' },
  { code: 'pt-PT', label: 'Português' },
  { code: 'es-ES', label: 'Español' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'lt-LT', label: 'Lietuvių' },
  { code: 'uk-UA', label: 'Українська' },
  { code: 'ar-SA', label: 'العربية' },
];

function VoiceLanguageSection({ session }) {
  const [selected, setSelected] = useState(
    () => localStorage.getItem('jp.voiceLang') || 'en-GB'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = async (code) => {
    const previous = selected;
    setSelected(code);
    setError('');
    setSaving(true);
    try {
      const userId = session?.user?.id;
      if (userId) {
        const { error: dbErr } = await supabase
          .from('profiles')
          .update({ preferred_voice_lang: code })
          .eq('id', userId);
        if (dbErr) throw dbErr;
      }
      localStorage.setItem('jp.voiceLang', code);
    } catch {
      setSelected(previous);
      setError('Could not save — try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {VOICE_LANGS.map(({ code, label }) => (
        <button
          key={code}
          className={`settings-row ${selected === code ? 'settings-row--active' : ''}`}
          onClick={() => handleChange(code)}
          disabled={saving}
          type="button"
        >
          <span className="settings-row-label">{label}</span>
          <span className="settings-row-right">
            {selected === code && (
              <Icon name="check" size={16} variant="brand" />
            )}
          </span>
        </button>
      ))}
      {error && <p className="settings-row-error">{error}</p>}
    </>
  );
}

// ── MonthlyOverheadsSection ───────────────────────────────────────────────────
// Available to all users — entering costs is free. The True Profit insight
// (Money tab) is Pro-gated separately.

function MonthlyOverheadsSection({ overheads, onSave }) {
  const [items, setItems] = useState(
    () => (Array.isArray(overheads) ? overheads : [])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // addState: null | { name, amount, category } — controls the inline add form
  const [addState, setAddState] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editState, setEditState] = useState(null);
  // roughTotal: null | string — controls the escape-hatch single-field sheet
  const [roughTotalOpen, setRoughTotalOpen] = useState(false);
  const [roughTotalValue, setRoughTotalValue] = useState('');

  // Keep local items in sync if the parent profile reloads
  useEffect(() => {
    setItems(Array.isArray(overheads) ? overheads : []);
  }, [overheads]);

  // Returns true on success, false on failure. Callers check the return value
  // before closing their inline form — the form stays open when a save fails
  // so the user doesn't lose their input.
  const persist = async (next) => {
    setSaving(true);
    setError('');
    try {
      await onSave({ overheads: next });
      setItems(next);
      return true;
    } catch {
      setError('Could not save — try again');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = (id) => {
    const next = items.map(i =>
      i.id === id ? { ...i, is_active: i.is_active === false ? true : false } : i
    );
    persist(next);
  };

  const handleDelete = (id) => {
    const next = items.filter(i => i.id !== id);
    persist(next);
  };

  const handleAdd = async () => {
    if (!addState) return;
    const name = (addState.name || '').trim();
    const amount = parseFloat(addState.amount);
    if (!name) { setError('Name is required'); return; }
    if (isNaN(amount) || amount < 0) { setError('Enter a valid amount'); return; }
    const newItem = {
      id: crypto.randomUUID(),
      name,
      amount,
      category: addState.category || 'Other',
      is_active: true,
    };
    const ok = await persist([...items, newItem]);
    if (ok) setAddState(null);
  };

  const handleEditSave = async (id) => {
    if (!editState) return;
    const name = (editState.name || '').trim();
    const amount = parseFloat(editState.amount);
    if (!name) { setError('Name is required'); return; }
    if (isNaN(amount) || amount < 0) { setError('Enter a valid amount'); return; }
    const next = items.map(i =>
      i.id === id ? { ...i, name, amount, category: editState.category || i.category } : i
    );
    const ok = await persist(next);
    if (ok) { setEditId(null); setEditState(null); }
  };

  // Escape-hatch: save a single "Monthly bills" lump-sum item.
  // Replaces any existing rough-total item (name === 'Monthly bills') so
  // re-saving doesn't pile up duplicates.
  const handleRoughTotalSave = async () => {
    const amount = parseFloat(roughTotalValue);
    if (isNaN(amount) || amount <= 0) { setError('Enter a valid amount'); return; }
    const withoutOld = items.filter(i => i.name !== 'Monthly bills' || i.category !== 'Other');
    const newItem = {
      id: crypto.randomUUID(),
      name: 'Monthly bills',
      amount,
      category: 'Other',
      is_active: true,
    };
    const ok = await persist([...withoutOld, newItem]);
    if (ok) { setRoughTotalOpen(false); setRoughTotalValue(''); }
  };

  const activeTotal = getOverheadTotal(items);
  const activeCount = items.filter(i => i.is_active !== false).length;

  return (
    <div className="overheads-section">
      {items.length > 0 && (
        <div className="overheads-summary">
          {activeCount > 0
            ? `£${activeTotal.toFixed(2)}/mo across ${activeCount} bill${activeCount === 1 ? '' : 's'}`
            : 'No monthly bills added yet'}
        </div>
      )}

      {items.map(item => {
        const isEditing = editId === item.id;
        if (isEditing) {
          return (
            <div key={item.id} className="overheads-item overheads-item--editing">
              <input
                className="overheads-input"
                placeholder="Name"
                value={editState.name}
                onChange={e => setEditState(s => ({ ...s, name: e.target.value }))}
              />
              <input
                className="overheads-input overheads-input--amount"
                placeholder="£0.00"
                type="number"
                min="0"
                step="0.01"
                value={editState.amount}
                onChange={e => setEditState(s => ({ ...s, amount: e.target.value }))}
              />
              <select
                className="overheads-select"
                value={editState.category}
                onChange={e => setEditState(s => ({ ...s, category: e.target.value }))}
              >
                {OVERHEAD_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <div className="overheads-item-actions">
                <button
                  type="button"
                  className="overheads-btn overheads-btn--save"
                  onClick={() => handleEditSave(item.id)}
                  disabled={saving}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="overheads-btn overheads-btn--cancel"
                  onClick={() => { setEditId(null); setEditState(null); setError(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        }
        return (
          <div key={item.id} className={`overheads-item${item.is_active === false ? ' overheads-item--inactive' : ''}`}>
            <div className="overheads-item-main">
              <span className="overheads-item-name">{item.name}</span>
              <span className="overheads-item-category">{item.category}</span>
            </div>
            <div className="overheads-item-right">
              <span className="overheads-item-amount">£{Number(item.amount).toFixed(2)}/mo</span>
              <button
                type="button"
                className={`overheads-toggle${item.is_active === false ? ' overheads-toggle--off' : ' overheads-toggle--on'}`}
                onClick={() => handleToggleActive(item.id)}
                disabled={saving}
                aria-label={item.is_active === false ? 'Activate' : 'Deactivate'}
              >
                {item.is_active === false ? 'Off' : 'On'}
              </button>
              <button
                type="button"
                className="overheads-btn overheads-btn--edit"
                onClick={() => {
                  setEditId(item.id);
                  setEditState({ name: item.name, amount: String(item.amount), category: item.category });
                  setError('');
                }}
                aria-label="Edit"
              >
                Edit
              </button>
              <button
                type="button"
                className="overheads-btn overheads-btn--delete"
                onClick={() => handleDelete(item.id)}
                disabled={saving}
                aria-label="Delete"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}

      {addState !== null ? (
        <div className="overheads-add-form">
          <input
            className="overheads-input"
            placeholder="e.g. Van payment"
            value={addState.name}
            autoFocus
            onChange={e => setAddState(s => ({ ...s, name: e.target.value }))}
          />
          <input
            className="overheads-input overheads-input--amount"
            placeholder="£0.00"
            type="number"
            min="0"
            step="0.01"
            value={addState.amount}
            onChange={e => setAddState(s => ({ ...s, amount: e.target.value }))}
          />
          <select
            className="overheads-select"
            value={addState.category}
            onChange={e => setAddState(s => ({ ...s, category: e.target.value }))}
          >
            {OVERHEAD_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <div className="overheads-item-actions">
            <button
              type="button"
              className="overheads-btn overheads-btn--save"
              onClick={handleAdd}
              disabled={saving}
            >
              Add
            </button>
            <button
              type="button"
              className="overheads-btn overheads-btn--cancel"
              onClick={() => { setAddState(null); setError(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="overheads-add-btn"
            onClick={() => setAddState({ name: '', amount: '', category: 'Other' })}
          >
            + Add monthly bill
          </button>
          <button
            type="button"
            className="overheads-rough-total-link"
            onClick={() => { setRoughTotalOpen(true); setRoughTotalValue(''); setError(''); }}
          >
            Or just put a rough monthly total &rarr;
          </button>
        </>
      )}

      {/* Rough-total escape hatch — single-field inline sheet */}
      {roughTotalOpen && (
        <div className="overheads-rough-total-sheet">
          <p className="overheads-rough-total-label">
            Roughly, what do your monthly bills come to?
          </p>
          <div className="overheads-rough-total-row">
            <span className="overheads-rough-total-prefix">£</span>
            <input
              className="overheads-input overheads-input--amount"
              type="number"
              min="0"
              step="1"
              placeholder="0"
              autoFocus
              value={roughTotalValue}
              onChange={e => setRoughTotalValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRoughTotalSave(); }}
            />
          </div>
          <div className="overheads-item-actions">
            <button
              type="button"
              className="overheads-btn overheads-btn--save"
              onClick={handleRoughTotalSave}
              disabled={saving}
            >
              Save
            </button>
            <button
              type="button"
              className="overheads-btn overheads-btn--cancel"
              onClick={() => { setRoughTotalOpen(false); setError(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="settings-row-error">{error}</p>}
    </div>
  );
}

// ── What's new helpers ────────────────────────────────────────────────────────

const WHATS_NEW_STORAGE_KEY = 'jp.lastSeenWhatsNew';

function getLastSeenWhatsNew() {
  return localStorage.getItem(WHATS_NEW_STORAGE_KEY) || null;
}

function markWhatsNewSeen() {
  // Store the date of the newest entry so we know when there is something unseen
  const newest = WHATS_NEW[0]?.date;
  if (newest) localStorage.setItem(WHATS_NEW_STORAGE_KEY, newest);
}

function hasUnseenWhatsNew() {
  const seen = getLastSeenWhatsNew();
  if (!seen) return WHATS_NEW.length > 0;
  const newest = WHATS_NEW[0]?.date;
  return newest ? newest > seen : false;
}

// ── WhatsNewModal ─────────────────────────────────────────────────────────────

function WhatsNewModal({ onClose }) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="What's new"
      onClick={onClose}
    >
      <div
        className="modal whats-new-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="whats-new-header">
          <h2 className="modal-title">What&rsquo;s new</h2>
          <button
            type="button"
            className="chase-list-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="whats-new-entries">
          {WHATS_NEW.map(entry => (
            <div key={entry.date + entry.title} className="whats-new-entry">
              <div className="whats-new-entry-header">
                <span className="whats-new-emoji" aria-hidden="true">{entry.emoji}</span>
                <span className="whats-new-entry-title">{entry.title}</span>
                <span className="whats-new-entry-date">{formatWhatsNewDate(entry.date)}</span>
              </div>
              <p className="whats-new-entry-blurb">{entry.blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── DeleteAccountModal ────────────────────────────────────────────────────────

function DeleteAccountModal({ session, onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isConfirmed = confirmText.trim().toUpperCase() === 'DELETE';

  const handleDelete = async () => {
    if (!isConfirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError('Session expired — please sign out and sign back in before deleting your account.');
        setBusy(false);
        return;
      }
      const res = await fetch('/.netlify/functions/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        let msg = 'Deletion failed — please try again or contact support.';
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          // ignore parse error — use default message
        }
        setError(msg);
        setBusy(false);
        return;
      }
      // Successful deletion — sign out and clear local data
      onDeleted();
    } catch (err) {
      console.error('delete-account client error', err?.message);
      setError('Network error — check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Delete account"
      onClick={onClose}
    >
      <div
        className="modal delete-account-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="whats-new-header">
          <h2 className="modal-title delete-account-modal__title">Delete account</h2>
          <button
            type="button"
            className="chase-list-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="delete-account-modal__body">
          <p className="delete-account-modal__warning">
            This is <strong>permanent and irreversible.</strong>
          </p>
          <p className="delete-account-modal__copy">
            Deleting your account will permanently remove:
          </p>
          <ul className="delete-account-modal__list">
            <li>All your jobs, quotes and invoices</li>
            <li>All receipts and receipt items</li>
            <li>All job photos</li>
            <li>Your profile and business details</li>
            <li>Your subscription (if active, cancel in Stripe first)</li>
            <li>Everything else — there is no undo</li>
          </ul>
          <p className="delete-account-modal__copy">
            Type <strong>DELETE</strong> in the box below to confirm:
          </p>
          <input
            className="delete-account-modal__input"
            type="text"
            placeholder="Type DELETE to confirm"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          {error && (
            <p className="delete-account-modal__error" role="alert">{error}</p>
          )}
          <button
            type="button"
            className="delete-account-modal__confirm-btn"
            onClick={handleDelete}
            disabled={!isConfirmed || busy}
          >
            {busy ? 'Deleting…' : 'Permanently delete my account'}
          </button>
          <button
            type="button"
            className="delete-account-modal__cancel-btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel — keep my account
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ItemiseDocumentsRow ───────────────────────────────────────────────────────
// Bound to profiles.itemise_documents (boolean, default false).
// When OFF (default): customer-facing PDFs show a single Total without a
// labour/materials cost split — protecting the trader's margin.
// When ON: the full Labour + Additional costs breakdown is printed.
// CIS deduction maths are unaffected by this toggle.

function ItemiseDocumentsRow({ profile, onProfileUpdate }) {
  const [enabled, setEnabled] = useState(
    () => profile?.itemise_documents === true
  );
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setEnabled(profile?.itemise_documents === true);
  }, [profile?.itemise_documents]);

  const handleToggle = async () => {
    if (working) return;
    const next = !enabled;
    setEnabled(next);
    setWorking(true);
    try {
      await onProfileUpdate({ itemise_documents: next });
    } catch {
      setEnabled(!next);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Row
      label="Itemise labour & materials on documents"
      value={working ? 'Updating…' : enabled ? 'On' : 'Off (default)'}
      onTap={handleToggle}
      chevron={false}
    />
  );
}

// ── DefaultDepositRow ─────────────────────────────────────────────────────────
// 4-button picker (0% / 25% / 50% / Custom) for the trader's default deposit %.
// Lives in the "Get paid" section of Settings.
// Per-quote override in the quote builder uses the same widget but does NOT
// save back to the profile — it only updates the individual quote.

const DEPOSIT_PRESET_BUTTONS = [
  { label: '0%',  value: 0 },
  { label: '25%', value: 25 },
  { label: '50%', value: 50 },
];

function DefaultDepositRow({ profile, onProfileUpdate }) {
  const stored = Number(profile?.default_deposit_percent ?? 25);
  // Treat any value that isn't 0, 25, or 50 as custom
  const isPreset = [0, 25, 50].includes(stored);
  const [customValue, setCustomValue] = useState(() => isPreset ? '' : String(stored));
  const [showCustom, setShowCustom] = useState(!isPreset);
  const [saving, setSaving] = useState(false);

  async function savePercent(value) {
    if (saving) return;
    const n = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    setSaving(true);
    try {
      await onProfileUpdate({ default_deposit_percent: n });
    } catch {
      // Fail silently — profile reload on next open will show the real value
    } finally {
      setSaving(false);
    }
  }

  const currentPercent = stored;

  return (
    <div className="settings-row settings-row--passive settings-row--deposit">
      <span className="settings-row-label">Default deposit %</span>
      <span className="settings-row-hint">
        Asked for on every quote. Customers pay by bank transfer — or by card on acceptance with Pro.
      </span>
      <div className="deposit-picker" role="group" aria-label="Default deposit percentage">
        {DEPOSIT_PRESET_BUTTONS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            className={`deposit-picker-btn${currentPercent === value && !showCustom ? ' deposit-picker-btn--active' : ''}`}
            onClick={() => {
              setShowCustom(false);
              setCustomValue('');
              savePercent(value);
            }}
            disabled={saving}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`deposit-picker-btn${showCustom ? ' deposit-picker-btn--active' : ''}`}
          onClick={() => {
            setShowCustom(true);
            if (!customValue) setCustomValue(String(currentPercent));
          }}
          disabled={saving}
        >
          Custom
        </button>
      </div>
      {showCustom && (
        <div className="deposit-custom-row">
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            className="deposit-custom-input"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onBlur={() => {
              const n = parseInt(customValue, 10);
              if (!isNaN(n) && n >= 0 && n <= 100) {
                savePercent(n);
              }
            }}
            aria-label="Custom deposit percentage"
            placeholder="e.g. 30"
          />
          <span className="deposit-custom-suffix">%</span>
        </div>
      )}
    </div>
  );
}

// ── SettingsAvatar ────────────────────────────────────────────────────────────
// Shows the trader's logo in the identity card when profile.logo_url is set.
// Falls back to the initials circle (with the green ring) when no logo is set
// or when the image fails to load (broken URL, storage error, etc.).

function SettingsAvatar({ profile, session }) {
  const logoUrl = profile?.logo_url || '';

  if (logoUrl) {
    return (
      <div className="settings-avatar settings-avatar--logo">
        <img
          src={logoUrl}
          alt="Business logo"
          className="settings-avatar-img"
          onError={(e) => {
            // Image failed to load — swap to initials fallback without crashing.
            const parent = e.currentTarget.parentElement;
            if (parent) {
              parent.classList.remove('settings-avatar--logo');
              e.currentTarget.replaceWith(
                Object.assign(document.createElement('span'), {
                  textContent: deriveInitials(profile, session),
                })
              );
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="settings-avatar">
      <span>{deriveInitials(profile, session)}</span>
    </div>
  );
}

// ── LogoModal ─────────────────────────────────────────────────────────────────
// Replaces the old URL-only EditFieldModal for the logo field.
// Two input paths:
//   A) Upload image  — file input → Supabase Storage (logos bucket) → public URL
//   B) Paste a URL   — text input → saved directly as logo_url
//
// On any save failure the modal stays open and shows the error inline.
// On success it closes and the save-toast fires in SettingsScreen.

function LogoModal({ currentUrl, session, onSave, onClose }) {
  const fileInputRef = useRef(null);
  const [urlValue, setUrlValue]   = useState(currentUrl || '');
  const [preview, setPreview]     = useState(currentUrl || '');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState('');
  const [error, setError]         = useState('');
  const [tab, setTab]             = useState('upload'); // 'upload' | 'url'

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    if (!file.type.startsWith('image/')) {
      setError('Please pick an image file (JPEG, PNG, WebP…)');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`);
      return;
    }

    const userId = session?.user?.id;
    if (!userId) {
      setError('Not signed in — please sign out and back in then try again.');
      return;
    }

    setUploading(true);
    setProgress('Uploading…');

    try {
      const ext      = file.name.split('.').pop().toLowerCase() || 'jpg';
      const filename = `logo-${Date.now()}.${ext}`;
      const path     = `${userId}/${filename}`;

      const { error: uploadErr } = await supabase.storage
        .from(LOGOS_BUCKET)
        .upload(path, file, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from(LOGOS_BUCKET)
        .getPublicUrl(path);

      const publicUrl = urlData?.publicUrl;
      if (!publicUrl) throw new Error('Could not get public URL after upload');

      setProgress('Saving…');
      await onSave({ logo_url: publicUrl });
      // onSave resolves → SettingsScreen shows the toast and we close
    } catch (err) {
      setError(err?.message || 'Upload failed — try again');
      setUploading(false);
      setProgress('');
    }
  };

  const handleUrlSave = async () => {
    setError('');
    const trimmed = urlValue.trim();
    if (!trimmed) {
      // Saving empty string clears the logo — allow it
    }
    setUploading(true);
    setProgress('Saving…');
    try {
      await onSave({ logo_url: trimmed || null });
    } catch (err) {
      setError(err?.message || 'Could not save — try again');
      setUploading(false);
      setProgress('');
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Logo"
      onClick={e => { if (e.target === e.currentTarget && !uploading) onClose(); }}
    >
      <div
        className="modal-sheet edit-field-sheet logo-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">Logo</h3>
          <button
            className="modal-sheet-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
            disabled={uploading}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Current logo preview */}
        {preview && (
          <div className="logo-modal__preview">
            <img
              src={preview}
              alt="Current logo"
              className="logo-modal__img"
              onError={() => setPreview('')}
            />
          </div>
        )}

        {/* Tab switcher */}
        <div className="logo-modal__tabs work-segments" role="group" aria-label="Logo input method">
          <button
            type="button"
            className={`work-segment${tab === 'upload' ? ' work-segment--active' : ''}`}
            onClick={() => { setTab('upload'); setError(''); }}
            disabled={uploading}
          >
            Upload image
          </button>
          <button
            type="button"
            className={`work-segment${tab === 'url' ? ' work-segment--active' : ''}`}
            onClick={() => { setTab('url'); setError(''); }}
            disabled={uploading}
          >
            Paste URL
          </button>
        </div>

        <div className="edit-field-body">
          {tab === 'upload' ? (
            <>
              <p className="edit-field-help">
                Pick an image from your phone (JPEG, PNG or WebP, max 2 MB).
              </p>
              {/* Hidden real file input — triggered by the button below */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="logo-modal__file-input"
                aria-hidden="true"
                tabIndex={-1}
                onChange={handleFileChange}
                disabled={uploading}
              />
              <button
                type="button"
                className="btn-primary logo-modal__pick-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? progress : 'Choose image'}
              </button>
            </>
          ) : (
            <>
              <div className="edit-field-group">
                <label className="edit-field-label" htmlFor="logo-url-input">
                  Image URL
                </label>
                <input
                  id="logo-url-input"
                  type="url"
                  inputMode="url"
                  className="edit-field-input"
                  value={urlValue}
                  placeholder="https://yourdomain.com/logo.png"
                  onChange={e => { setUrlValue(e.target.value); setPreview(e.target.value); setError(''); }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={uploading}
                />
                <span className="edit-field-help">Paste a public image URL.</span>
              </div>
            </>
          )}

          {error && (
            <p className="edit-field-save-error" role="alert">{error}</p>
          )}
        </div>

        {tab === 'url' && (
          <div className="edit-field-actions">
            <button
              type="button"
              className="btn-ghost edit-field-cancel"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary edit-field-save"
              onClick={handleUrlSave}
              disabled={uploading}
            >
              {uploading ? progress : 'Save'}
            </button>
          </div>
        )}
        {tab === 'upload' && (
          <div className="edit-field-actions">
            <button
              type="button"
              className="btn-ghost edit-field-cancel"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SubscriptionCard ─────────────────────────────────────────────────────────
// Pinned block on the hub. Branches by plan state.
//
// SEAM FOR FOUNDING MEMBER CARD:
//   When feat/founding-member-price-lock merges, wrap this with:
//     foundingEligible ? <FoundingMemberCard /> : <SubscriptionCard ... />
//   The FoundingMemberCard sits in the same pinned slot, above category rows.

function SubscriptionCard({ profile, openUpgradeSheet }) {
  // Trial not yet started: plan='trial' but trial_ends_at is null.
  // This window is brief (one app load while initTrialOnFirstUse writes to DB).
  // Show a neutral "starting" label instead of "0 days left" or "Free".
  if (!UNLOCK_PRO_FOR_ALL && profile?.plan === 'trial' && !profile?.trial_ends_at) {
    return (
      <SectionCard title="Subscription">
        <Row label="Current plan" value="Free trial · starting" chevron={false} />
        <Row
          label="Add card to stay Pro"
          action="£12/mo"
          onTap={() => openUpgradeSheet(UPGRADE_TRIGGERS.SETTINGS)}
          highlight
        />
      </SectionCard>
    );
  }
  if (!UNLOCK_PRO_FOR_ALL && isTrialActive(profile)) {
    return (
      <SectionCard title="Subscription">
        <Row
          label="Current plan"
          value={`Free trial · ${trialDaysLeft(profile)} day${trialDaysLeft(profile) === 1 ? '' : 's'} left`}
          chevron={false}
        />
        <Row
          label="Add card to stay Pro"
          action="£12/mo"
          onTap={() => openUpgradeSheet(UPGRADE_TRIGGERS.SETTINGS)}
          highlight
        />
      </SectionCard>
    );
  }
  if (isPro(profile)) {
    return (
      <SectionCard title="Subscription">
        <Row label="Current plan" value="Pro" chevron={false} />
        <Row
          label="Manage billing"
          onTap={async () => {
            const { error } = await openBillingPortal();
            if (error) {
              // surfaced via the outer component's toast — ignore here
            }
          }}
        />
      </SectionCard>
    );
  }
  // Free (default)
  return (
    <SectionCard title="Subscription">
      <Row label="Current plan" value="Free" chevron={false} />
      <Row
        label="Upgrade to Pro"
        action="£12/mo"
        onTap={() => openUpgradeSheet(UPGRADE_TRIGGERS.SETTINGS)}
        highlight
      />
    </SectionCard>
  );
}

// ── HubCategoryRow ────────────────────────────────────────────────────────────
// A single navigable row on the hub. Uses the existing Row primitive with an
// injected Icon on the left — extends Row visually without touching Row itself.

function HubCategoryRow({ label, iconName, hint, onTap, dot = false }) {
  return (
    <button
      type="button"
      className="settings-row settings-hub-row"
      onClick={onTap}
    >
      <span className="settings-hub-row-left">
        <span className="settings-hub-row-icon" aria-hidden="true">
          <Icon name={iconName} size={20} />
        </span>
        <span className="settings-row-label">
          {label}
          {dot && <span className="settings-new-dot" aria-label="New updates available" />}
        </span>
      </span>
      <span className="settings-row-right">
        {hint && <span className="settings-row-value">{hint}</span>}
        <span className="settings-row-chevron">›</span>
      </span>
    </button>
  );
}

// ── SubScreenHeader ───────────────────────────────────────────────────────────
// Consistent header for every Phase-1 sub-screen. Back chevron (≥44px tap
// target) on the left returns to hub; title centred.

function SubScreenHeader({ title, onBack }) {
  return (
    <div className="screen-header settings-subscreen-header">
      <button
        type="button"
        className="settings-subscreen-back"
        onClick={onBack}
        aria-label="Back to Settings"
      >
        <Icon name="chevron-left" size={24} />
      </button>
      <h1 className="screen-title">{title}</h1>
    </div>
  );
}

// ── ReferralRow ───────────────────────────────────────────────────────────────
// Replaces the generic "Refer a mate" row in the Help sub-screen.
//
// On mount, calls ensureReferralCode to lazily generate + persist the user's
// personal referral code. If the code is available, renders:
//   - a tap-to-copy pill showing the full link
//   - a Share icon CTA
//
// If ensureReferralCode returns null (migration not yet applied), falls back
// to the existing generic share so nothing breaks before the SQL is run.
//
// Props:
//   session         — Supabase session (for user ID)
//   profile         — current profile object (checked for existing code)
//   onGenericShare  — () => void  fallback when migration is pending

function ReferralRow({ session, profile, onGenericShare }) {
  const [code, setCode]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied]   = useState(false);
  const copyTimerRef          = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const userId = session?.user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    ensureReferralCode(supabase, userId, profile).then((result) => {
      if (!cancelled) {
        setCode(result);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const handleCopy = async () => {
    if (!code) return;
    await copyReferralLink(code);
    // Show copied feedback for 2 s
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!code) {
      // Migration not applied — fall back to generic share
      onGenericShare?.();
      return;
    }
    await copyReferralLink(code);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  // Loading state — keep the row present but passive
  if (loading) {
    return <Row label="Refer a mate" value="Loading…" chevron={false} />;
  }

  // Migration not applied — fall back to generic share row so nothing breaks
  if (!code) {
    return <Row label="Refer a mate" onTap={onGenericShare} />;
  }

  const link = buildReferralLink(code);

  return (
    <div className="settings-row settings-row--passive referral-row">
      <span className="settings-row-label">
        <Icon name="gift" size={16} variant="brand" />
        {' '}Refer a mate
      </span>
      <div className="referral-row__right">
        <button
          type="button"
          className="referral-row__pill"
          onClick={handleCopy}
          aria-label={copied ? 'Link copied' : 'Copy referral link'}
          title={link}
        >
          <Icon name="copy" size={14} />
          <span className="referral-row__pill-text">
            {copied ? 'Copied!' : `jobprofit.co.uk/?ref=${code}`}
          </span>
        </button>
        <button
          type="button"
          className="referral-row__share-btn"
          onClick={handleShare}
          aria-label="Share referral link"
        >
          <Icon name="share" size={18} />
        </button>
      </div>
    </div>
  );
}

// ── SettingsScreen ────────────────────────────────────────────────────────────

export default function SettingsScreen({
  session,
  profile,
  jobs,
  receipts,
  onSignOut,
  onOpenWizard,
  onProfileUpdate,
  onOpenJob,
  onNavigateToCardPayments,
  onBrowseMaterials,
  // scrollTarget: 'overheads' | null — from AppShell when the user taps
  // "Add your costs" on the Money tab.
  // Phase 1: receiving 'overheads' now navigates to the Costs sub-screen
  // instead of scrolling (overheadsRef removed). AppShell is unchanged —
  // it still passes 'overheads'; we handle it here by routing to 'costs'.
  scrollTarget = null,
  onScrollTargetConsumed,
}) {
  // ── Hub / sub-screen routing ───────────────────────────────────────────────
  // 'hub' | 'invoices' | 'getpaid' | 'costs'
  // | 'account' | 'notifications' | 'privacy' | 'help' | 'app' | 'voice'
  // 'voice' is a nested sub-view under 'account'; back returns to 'account'.
  const [settingsView, setSettingsView] = useState('hub');
  // Preserve hub scroll position when returning from a sub-screen.
  const hubScrollRef = useRef(0);
  const screenRef = useRef(null);

  const navigateToSubScreen = useCallback((view) => {
    // Save hub scroll position
    hubScrollRef.current = screenRef.current?.scrollTop ?? 0;
    setSettingsView(view);
    // Push a history entry so the PWA back button returns to hub
    history.pushState({ settingsView: view }, '');
    // Sub-screen starts at top
    requestAnimationFrame(() => {
      if (screenRef.current) screenRef.current.scrollTop = 0;
    });
  }, []);

  const navigateToHub = useCallback(() => {
    setSettingsView('hub');
    // Restore hub scroll
    requestAnimationFrame(() => {
      if (screenRef.current) screenRef.current.scrollTop = hubScrollRef.current;
    });
  }, []);

  // Handle hardware/browser back button while on a sub-screen.
  // 'voice' is nested under 'account' — back goes to 'account', not hub.
  useEffect(() => {
    const onPopState = () => {
      if (settingsView === 'voice') {
        setSettingsView('account');
        requestAnimationFrame(() => {
          if (screenRef.current) screenRef.current.scrollTop = 0;
        });
      } else if (settingsView !== 'hub') {
        navigateToHub();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [settingsView, navigateToHub]);

  // overheads deep-link: navigate to Costs sub-screen instead of scrolling
  useEffect(() => {
    if (scrollTarget !== 'overheads') return;
    navigateToSubScreen('costs');
    onScrollTargetConsumed?.();
  }, [scrollTarget, navigateToSubScreen, onScrollTargetConsumed]);

  // ── Theme state ───────────────────────────────────────────────────────────
  const [themePref, setThemePrefState] = useState(() => getStoredPref());

  function handleThemePref(pref) {
    setThemePrefState(pref);
    setThemePref(pref);
  }

  // ── Logo modal state ──────────────────────────────────────────────────────
  const [showLogoModal, setShowLogoModal] = useState(false);
  // Remove the ref — it was only used for scroll-to-overheads (now replaced by
  // navigateToSubScreen('costs') via the scrollTarget effect above).

  // ── What's new state ──────────────────────────────────────────────────────
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [whatsNewDot, setWhatsNewDot] = useState(() => hasUnseenWhatsNew());

  const handleOpenWhatsNew = () => {
    setShowWhatsNew(true);
    if (whatsNewDot) {
      markWhatsNewSeen();
      setWhatsNewDot(false);
    }
  };

  // ── Delete account state ──────────────────────────────────────────────────
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  const handleAccountDeleted = async () => {
    // Clear all local/session storage so no stale data remains after deletion
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Ignore — storage clear is best-effort
    }
    // Sign out via Supabase (invalidates the session on the client)
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore — the server already deleted the auth user
    }
    // onSignOut navigates back to the auth/landing screen in AppShell
    onSignOut?.();
  };
  const email       = session?.user?.email || '';
  const firstName   = profile?.first_name  || '';
  const lastName    = profile?.last_name   || '';
  const tradingName = profile?.business_name || profile?.name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || email;

  const required = [
    { label: 'Trading name', done: !!tradingName },
    { label: 'First name',   done: !!firstName },
    { label: 'Last name',    done: !!lastName },
    { label: 'Bank details', done: !!(profile?.sort_code && profile?.account_number) || !!profile?.bankDetails },
    { label: 'Email',        done: !!email },
  ];
  const allRequiredDone = required.every(r => r.done);

  // ── Edit modal state ──────────────────────────────────────────────────────
  // activeEdit: null | { modal: string, ...props for EditFieldModal }
  const [activeEdit, setActiveEdit] = useState(null);
  const [saveToast, setSaveToast] = useState('');
  const toastTimerRef = useRef(null);
  // upgradeSheetOpen: controls ProUpgradeSheet on Settings.
  // upgradeSheetTrigger: the attribution trigger passed to ProUpgradeSheet.
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false);
  const [upgradeSheetTrigger, setUpgradeSheetTrigger] = useState(UPGRADE_TRIGGERS.SETTINGS);

  const openUpgradeSheet = useCallback((trigger = UPGRADE_TRIGGERS.SETTINGS) => {
    setUpgradeSheetTrigger(trigger);
    setUpgradeSheetOpen(true);
  }, []);

  // ── Import sheet state ────────────────────────────────────────────────────
  // showImportSheet: opens SpreadsheetImporter in a modal from Settings → Data & Privacy.
  // Free — no Pro gate (data portability is always free).
  const [showImportSheet, setShowImportSheet] = useState(false);

  async function handleSettingsImport(jobs) {
    const results = await Promise.allSettled(jobs.map(job => addJobToCloud(job)));
    const imported = results.filter(r => r.status === 'fulfilled').length;
    const failed   = jobs.filter((_, i) => results[i].status === 'rejected');
    return { imported, failed };
  }

  function closeImportSheet() {
    setShowImportSheet(false);
  }

  // ── Export state ──────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  // exportSheetContext: null | { section: 'records' | 'everything' }
  const [exportSheetContext, setExportSheetContext] = useState(null);

  const dateStamp = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  const handleExportFormatPick = async (format) => {
    // Capture section before clearing the sheet context
    const section = exportSheetContext?.section;
    setExportSheetContext(null);
    if (exporting) return;
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    const safeReceipts = Array.isArray(receipts) ? receipts : [];
    if (safeJobs.length === 0) {
      showSavedToast('No jobs to export yet');
      return;
    }
    setExporting(true);
    try {
      const stamp = dateStamp();
      const isEverything = section === 'everything';
      if (format === 'csv') {
        // "Export everything" includes the account/profile section at the top.
        // "Export records" is the jobs ledger only — accountant-friendly, unchanged.
        const csv = isEverything
          ? buildEverythingCsv(safeJobs, safeReceipts, profile, session)
          : buildJobsCsv(safeJobs, safeReceipts);
        await downloadOrShareCsv(csv, `jobprofit-export-${stamp}.csv`);
      } else if (format === 'pdf') {
        const exportTitle = isEverything ? 'Everything export' : 'Records export';
        const businessName = profile?.business_name || profile?.businessName || '';
        const blob = await buildJobsPdf(safeJobs, safeReceipts, {
          title: exportTitle,
          businessName,
          isPro: isPro(profile),
          // "Export everything" adds the Account block above the totals strip.
          includeAccount: isEverything,
          profile,
          session,
        });
        await downloadOrShare(blob, `jobprofit-export-${stamp}.pdf`, 'application/pdf');
      } else if (format === 'xlsx') {
        // xlsx export is jobs ledger only (same as CSV "records").
        // The "Export everything" section includes account profile fields in CSV/PDF
        // but not in xlsx — the jobs sheet is the accountant-useful part.
        await buildJobsXlsx(safeJobs, safeReceipts, `jobprofit-export-${stamp}.xlsx`);
      }
    } catch {
      showSavedToast('Export failed — try again');
    } finally {
      setExporting(false);
    }
  };

  const openExportSheet = (section) => {
    if (exporting) return;
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    if (safeJobs.length === 0) {
      showSavedToast('No jobs to export yet');
      return;
    }
    setExportSheetContext({ section });
  };

  // ── CIS setup sheet state ─────────────────────────────────────────────────
  const [showCisSheet, setShowCisSheet] = useState(false);

  // ── Trade type setup sheet state ──────────────────────────────────────────
  const [showTradeSheet, setShowTradeSheet] = useState(false);

  // ── Chase reminders state ─────────────────────────────────────────────────
  const [showChaseList, setShowChaseList] = useState(false);

  const chaseRows = showChaseList
    ? buildChaseList(Array.isArray(jobs) ? jobs : [])
    : [];

  const showSavedToast = (msg = 'Saved') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setSaveToast(msg);
    toastTimerRef.current = setTimeout(() => setSaveToast(''), 2500);
  };

  const handleShare = async () => {
    const data = buildShareData();
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare(data)) {
      try {
        await navigator.share(data);
      } catch {
        // User cancelled or share failed — fall through to clipboard
        try {
          await navigator.clipboard.writeText(data.url);
          showSavedToast('Link copied');
        } catch {
          // Clipboard also unavailable — silently do nothing
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(data.url);
        showSavedToast('Link copied');
      } catch {
        // Clipboard unavailable — silently do nothing
      }
    }
  };

  const handleWhatsApp = () => {
    window.open(buildWhatsAppSupportUrl(), '_blank', 'noopener');
  };

  const handleSendFeedback = () => {
    window.location.href = 'mailto:getjobprofit@gmail.com?subject=OHNAR%20feedback';
  };

  const handleSendBugReport = () => {
    const version = APP_VERSION || 'unknown';
    const ua = navigator.userAgent || 'unknown';
    const plan = profile?.plan || 'unknown';
    const userRef = session?.user?.id?.slice(0, 8) || 'anonymous';
    const body = encodeURIComponent(
      `What happened:\n\n\nWhat you expected:\n\n\n---\nApp: ${version} | Plan: ${plan} | Ref: ${userRef}\nDevice: ${ua}`,
    );
    window.location.href = `mailto:getjobprofit@gmail.com?subject=OHNAR%20bug%20report%20v${version}&body=${body}`;
  };

  const handleSave = async (patch) => {
    if (!onProfileUpdate) throw new Error('onProfileUpdate not wired');
    await onProfileUpdate(patch);
    showSavedToast('Saved');
  };

  const closeEdit = () => setActiveEdit(null);

  // ── Edit openers ──────────────────────────────────────────────────────────

  const openEditName = () => setActiveEdit({
    modal: 'name',
    title: 'Your name',
    fields: [
      {
        key: 'first_name',
        label: 'First name',
        value: firstName,
        validate: validateNonEmpty,
      },
      {
        key: 'last_name',
        label: 'Last name',
        value: lastName,
        validate: validateNonEmpty,
      },
    ],
  });

  const openEditBusinessName = () => setActiveEdit({
    modal: 'business_name',
    fieldKey: 'business_name',
    fieldLabel: 'Business / trading name',
    currentValue: tradingName,
    validate: validateNonEmpty,
  });

  const openEditLogo = () => setShowLogoModal(true);

  const openEditBankDetails = () => setActiveEdit({
    modal: 'bank',
    title: 'Bank details',
    fields: [
      {
        key: 'account_name',
        label: 'Account name',
        value: profile?.account_name || '',
        validate: validateNonEmpty,
        placeholder: 'e.g. Alan Aranda',
      },
      {
        key: 'sort_code',
        label: 'Sort code',
        value: profile?.sort_code || '',
        validate: (v) => {
          const digits = v.replace(/\D/g, '');
          return digits.length === 6 ? null : 'Must be 6 digits (XX-XX-XX)';
        },
        formatOnBlur: formatSortCode,
        placeholder: 'XX-XX-XX',
        helpText: 'Auto-formats on blur',
      },
      {
        key: 'account_number',
        label: 'Account number',
        value: profile?.account_number || '',
        validate: validateAccountNumber,
        placeholder: '8 digits',
        inputType: 'number',
      },
    ],
  });

  const openEditHourlyRate = () => setActiveEdit({
    modal: 'hourly_rate',
    fieldKey: 'hourly_rate',
    fieldLabel: 'Hourly rate',
    currentValue: profile?.hourly_rate ?? '',
    inputType: 'number',
    placeholder: '0.00',
    helpText: 'Your default rate in GBP. Used to calculate time cost on jobs.',
    validate: validateHourlyRate,
  });

  const openEditDefaultMarkup = () => setActiveEdit({
    modal: 'default_markup',
    fieldKey: 'default_markup',
    fieldLabel: 'Your standard markup %',
    currentValue: profile?.default_markup ?? 20,
    inputType: 'number',
    placeholder: '20',
    helpText: "We'll add this to material buy prices when you put them on a quote. You can change it per line.",
    validate: (v) => {
      const n = parseFloat(v);
      if (isNaN(n) || n < 0) return 'Enter a number like 20 for 20%';
      return null;
    },
  });

  const openEditAddress = () => setActiveEdit({
    modal: 'address',
    fieldKey: 'address',
    fieldLabel: 'Business address',
    currentValue: profile?.address || '',
    inputType: 'textarea',
    placeholder: 'e.g. 12 Trade Lane, Manchester, M1 2AB',
    helpText: 'Shown on invoices, quotes and receipts.',
    validate: null,
  });

  const openEditPhone = () => setActiveEdit({
    modal: 'phone',
    fieldKey: 'phone',
    fieldLabel: 'Business phone',
    currentValue: profile?.phone || '',
    inputType: 'tel',
    placeholder: 'e.g. 07800 100200',
    helpText: 'Shown next to your email on documents.',
    validate: null,
  });

  const openEditEmail = () => setActiveEdit({
    modal: 'email',
    fieldKey: 'email',
    fieldLabel: 'Business email',
    currentValue: profile?.email || '',
    inputType: 'email',
    placeholder: 'e.g. you@yourbusiness.co.uk',
    helpText: 'Shown on invoices and quotes.',
    validate: null,
  });

  const openEditUtr = () => setActiveEdit({
    modal: 'utr_number',
    fieldKey: 'utr_number',
    fieldLabel: 'UTR number',
    currentValue: profile?.utr_number || '',
    placeholder: 'e.g. 1234567890',
    helpText: 'Unique Taxpayer Reference. Shown on invoices when set. Required for CIS.',
    validate: null,
  });

  const openEditVat = () => setActiveEdit({
    modal: 'vat_number',
    fieldKey: 'vat_number',
    fieldLabel: 'VAT number',
    currentValue: profile?.vat_number || '',
    placeholder: 'GB 123 4567 89',
    helpText: 'Optional. Appears on invoices when set.',
    validate: null,
  });

  const openEditTaxSetAside = () => setActiveEdit({
    modal: 'tax_set_aside_pct',
    fieldKey: 'tax_set_aside_pct',
    fieldLabel: 'Tax set-aside %',
    currentValue: profile?.tax_set_aside_pct ?? 20,
    inputType: 'number',
    placeholder: '20',
    helpText: 'Percentage of monthly profit to ring-fence for tax. Shown on your Money tab.',
    validate: validateTaxSetAsidePct,
  });

  const openEditStripeLink = () => setActiveEdit({
    modal: 'stripe_payment_link',
    fieldKey: 'stripe_payment_link',
    fieldLabel: 'Stripe Payment Link',
    currentValue: profile?.stripe_payment_link || '',
    placeholder: 'https://buy.stripe.com/...',
    helpText: 'Paste your Stripe Payment Link here. Customers tap to pay by card on every invoice.',
    validate: (v) => isValidStripePaymentLink(v) ? null : 'Must be a valid https://buy.stripe.com/... URL',
  });

  const openEditPaymentTerms = () => setActiveEdit({
    modal: 'payment_terms_days',
    fieldKey: 'payment_terms_days',
    fieldLabel: 'Default payment terms (days)',
    currentValue: profile?.payment_terms_days ?? 14,
    inputType: 'number',
    placeholder: '14',
    helpText: 'Invoices will show a due date this many days after issue. You can override per invoice.',
    validate: (v) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = parseInt(v, 10);
      return (isNaN(n) || n < 0 || n > 365) ? 'Must be a whole number between 0 and 365' : null;
    },
  });

  const openEditQuoteValidity = () => setActiveEdit({
    modal: 'quote_validity_days',
    fieldKey: 'quote_validity_days',
    fieldLabel: 'Quote validity (days)',
    currentValue: profile?.quote_validity_days ?? 30,
    inputType: 'number',
    placeholder: '30',
    helpText: 'Quotes will show "Valid until <date>" this many days from the issue date.',
    validate: (v) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = parseInt(v, 10);
      return (isNaN(n) || n < 1 || n > 365) ? 'Must be a whole number between 1 and 365' : null;
    },
  });

  const openEditWebsite = () => setActiveEdit({
    modal: 'website',
    fieldKey: 'website',
    fieldLabel: 'Website',
    currentValue: profile?.website || '',
    inputType: 'url',
    placeholder: 'https://yoursite.co.uk',
    helpText: 'Shown on quotes, invoices, and receipts next to your phone and email.',
    validate: null,
  });

  const openEditTermsText = () => setActiveEdit({
    modal: 'terms_text',
    fieldKey: 'terms_text',
    fieldLabel: 'Terms & conditions',
    currentValue: profile?.terms_text || '',
    inputType: 'textarea',
    rows: 6,
    placeholder: 'e.g. Payment due within 14 days. All work guaranteed for 12 months...',
    helpText: 'Shown in the footer of your quotes and invoices. Leave blank to omit.',
    validate: null,
  });

  // ── Shared computed values (used by sub-screens AND hub) ──────────────────
  // Hoisted above all sub-screen renders so they're available everywhere.
  const chaseCount = buildChaseList(Array.isArray(jobs) ? jobs : []).length;
  const notificationsHint = chaseCount > 0 ? `${chaseCount} to chase` : 'All clear';
  const themeWord = themePref.charAt(0).toUpperCase() + themePref.slice(1);

  // ── Render ─────────────────────────────────────────────────────────────────
  // Shared modal layer (rendered on all views so modals work from sub-screens too)

  const modalLayer = (
    <>
      {/* ── Edit field modal ─────────────────────────────────────────────── */}
      {activeEdit && (
        <EditFieldModal
          open
          title={activeEdit.title}
          fields={activeEdit.fields}
          fieldKey={activeEdit.fieldKey}
          fieldLabel={activeEdit.fieldLabel}
          currentValue={activeEdit.currentValue}
          inputType={activeEdit.inputType}
          placeholder={activeEdit.placeholder}
          helpText={activeEdit.helpText}
          validate={activeEdit.validate}
          formatOnBlur={activeEdit.formatOnBlur}
          onSave={handleSave}
          onClose={closeEdit}
        />
      )}

      {/* ── Chase reminders sheet ────────────────────────────────────────── */}
      {showChaseList && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Chase reminders"
          onClick={() => setShowChaseList(false)}
        >
          <div
            className="modal chase-list-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="chase-list-header">
              <h2 className="modal-title" style={{ marginBottom: 4 }}>Chase reminders</h2>
              <button
                type="button"
                className="chase-list-close"
                onClick={() => setShowChaseList(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {chaseRows.length === 0 ? (
              <div className="chase-list-empty">
                <p className="chase-list-empty-icon">&#x1F389;</p>
                <p className="chase-list-empty-text">Nothing to chase — you&rsquo;re all caught up</p>
              </div>
            ) : (
              <div className="chase-list-rows">
                {chaseRows.map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className="chase-list-row"
                    onClick={() => {
                      setShowChaseList(false);
                      if (onOpenJob && row.id) onOpenJob(row.id);
                    }}
                  >
                    <div className="chase-list-row-main">
                      <span className="chase-list-row-customer">{row.customer}</span>
                      {row.summary ? (
                        <span className="chase-list-row-summary">{row.summary}</span>
                      ) : null}
                    </div>
                    <div className="chase-list-row-meta">
                      <span className="chase-list-row-amount">
                        £{Number(row.outstanding).toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                      </span>
                      <span className={`chase-list-row-days chase-list-row-days--tier${row.tier}`}>
                        {row.daysPastDue}d overdue
                      </span>
                    </div>
                    <span className="chase-list-row-chevron">›</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CIS setup sheet ──────────────────────────────────────────────── */}
      {showCisSheet && (
        <CisSetupSheet
          profile={profile}
          onProfileUpdate={handleSave}
          onClose={() => setShowCisSheet(false)}
        />
      )}

      {/* ── Trade type setup sheet ───────────────────────────────────────── */}
      {showTradeSheet && (
        <TradeSetupSheet
          profile={profile}
          onProfileUpdate={handleSave}
          onClose={() => setShowTradeSheet(false)}
        />
      )}

      {/* ── What's new sheet ─────────────────────────────────────────────── */}
      {showWhatsNew && (
        <WhatsNewModal onClose={() => setShowWhatsNew(false)} />
      )}

      {/* ── Logo upload modal ────────────────────────────────────────────── */}
      {showLogoModal && (
        <LogoModal
          currentUrl={profile?.logo_url || ''}
          session={session}
          onSave={async (patch) => {
            await handleSave(patch);
            setShowLogoModal(false);
          }}
          onClose={() => setShowLogoModal(false)}
        />
      )}

      {/* ── Delete account modal ─────────────────────────────────────────── */}
      {showDeleteAccount && (
        <DeleteAccountModal
          session={session}
          onClose={() => setShowDeleteAccount(false)}
          onDeleted={handleAccountDeleted}
        />
      )}

      {/* ── Pro upgrade sheet ────────────────────────────────────────────── */}
      <ProUpgradeSheet
        open={upgradeSheetOpen}
        trigger={upgradeSheetTrigger}
        onClose={() => setUpgradeSheetOpen(false)}
      />

      {/* ── Import sheet ─────────────────────────────────────────────────── */}
      {showImportSheet && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Import jobs"
          onClick={closeImportSheet}
        >
          <div
            className="modal import-settings-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="import-settings-modal__header">
              <h2 className="modal-title">Import jobs</h2>
              <button
                type="button"
                className="chase-list-close"
                onClick={closeImportSheet}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <SpreadsheetImporter
              onImport={handleSettingsImport}
              onDone={closeImportSheet}
              onSkip={closeImportSheet}
              logTelemetry={logTelemetry}
            />
          </div>
        </div>
      )}

      {/* ── Export format sheet ──────────────────────────────────────────── */}
      {exportSheetContext && (() => {
        const isRecords = exportSheetContext.section === 'records';
        const sheetTitle = isRecords ? 'Export records' : 'Export everything';
        const csvFirst = isRecords;
        const pdfSublabel = isRecords
          ? 'A clean sheet you can send'
          : 'A clean sheet you can read or send';
        const csvOption  = { id: 'csv',  icon: 'bar-chart',        label: 'Spreadsheet (CSV)', sublabel: 'For your accountant or Excel' };
        const xlsxOption = { id: 'xlsx', icon: 'file-spreadsheet', label: 'Excel (.xlsx)',      sublabel: 'Opens in Excel or Google Sheets' };
        const pdfOption  = { id: 'pdf',  icon: 'pdf',               label: 'PDF summary',        sublabel: pdfSublabel };
        const options    = csvFirst ? [csvOption, xlsxOption, pdfOption] : [pdfOption, csvOption, xlsxOption];
        return (
          <ExportFormatSheet
            open
            title={sheetTitle}
            subtitle="Pick a format. All three download straight to your phone."
            options={options}
            onPick={handleExportFormatPick}
            onClose={() => setExportSheetContext(null)}
          />
        );
      })()}

      {/* ── Saved toast ──────────────────────────────────────────────────── */}
      {saveToast && (
        <div className="toast" role="status" aria-live="polite">
          {saveToast}
        </div>
      )}
    </>
  );

  // ── Sub-screen: Invoices & quotes ─────────────────────────────────────────
  if (settingsView === 'invoices') {
    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader title="Invoices & Quotes" onBack={navigateToHub} />

        <SectionCard title="Invoices &amp; quotes">
          <Row
            label="Logo"
            value={profile?.logo_url ? 'Set' : 'None'}
            onTap={openEditLogo}
          />
          {/* Trading name uses the same business_name field as Account & business —
              intentional cross-linking; both call openEditBusinessName. */}
          <Row
            label="Trading name"
            value={tradingName || '—'}
            onTap={openEditBusinessName}
          />
          <Row
            label="Business address"
            value={profile?.address ? profile.address.split(/\n|,/)[0].trim() : '—'}
            onTap={openEditAddress}
          />
          <Row
            label="Business phone"
            value={profile?.phone || '—'}
            onTap={openEditPhone}
          />
          <Row
            label="Business email"
            value={profile?.email || '—'}
            onTap={openEditEmail}
          />
          <Row
            label="Website"
            value={profile?.website || '—'}
            onTap={openEditWebsite}
          />
          <Row
            label="Bank details"
            value={(profile?.sort_code && profile?.account_number) ? 'Set' : '—'}
            onTap={openEditBankDetails}
          />
          <Row
            label="Hourly rate"
            value={profile?.hourly_rate ? `£${profile.hourly_rate}/hr` : '—'}
            onTap={openEditHourlyRate}
          />
          <Row
            label="Standard markup %"
            value={profile?.default_markup != null ? `${profile.default_markup}%` : '20%'}
            onTap={openEditDefaultMarkup}
          />
          <Row
            label="Materials"
            value="Your price list & saved items"
            onTap={onBrowseMaterials}
          />
          <Row
            label="VAT"
            value={profile?.vat_number ? 'Registered' : 'Not set'}
            onTap={openEditVat}
          />
          <Row
            label="UTR number"
            value={profile?.utr_number || '—'}
            onTap={openEditUtr}
          />
          <Row
            label="Tax set-aside %"
            value={`${profile?.tax_set_aside_pct ?? 20}%`}
            onTap={openEditTaxSetAside}
          />
          <Row
            label="CIS subcontractor"
            value={
              profile?.is_cis_subcontractor
                ? `On · ${profile.cis_default_rate ?? 20}%`
                : 'Off'
            }
            onTap={() => setShowCisSheet(true)}
          />
          <Row
            label="Default payment terms"
            value={`${profile?.payment_terms_days ?? 14} days`}
            onTap={openEditPaymentTerms}
          />
          <Row
            label="Quote validity"
            value={`${profile?.quote_validity_days ?? 30} days`}
            onTap={openEditQuoteValidity}
          />
          <Row
            label="Card payment link"
            value={profile?.stripe_payment_link ? 'Set' : 'Not set'}
            onTap={openEditStripeLink}
          />
          <Row
            label="Terms & conditions"
            value={profile?.terms_text ? 'Set' : '—'}
            onTap={openEditTermsText}
          />
          <ItemiseDocumentsRow
            profile={profile}
            onProfileUpdate={handleSave}
          />
        </SectionCard>

        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Sub-screen: Get paid ──────────────────────────────────────────────────
  if (settingsView === 'getpaid') {
    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader title="Get Paid" onBack={navigateToHub} />

        <SectionCard title="Get Paid">
          <Row
            label="Card payments"
            value={
              profile?.stripe_connect_status === 'connected' && profile?.stripe_user_id
                ? (() => {
                    const name =
                      profile?.business_name ||
                      [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
                    return name ? `Connected · ${name}` : 'Connected';
                  })()
                : 'Not connected'
            }
            onTap={onNavigateToCardPayments}
          />
          <DefaultDepositRow profile={profile} onProfileUpdate={handleSave} />
        </SectionCard>

        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Sub-screen: Costs ─────────────────────────────────────────────────────
  if (settingsView === 'costs') {
    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader title="Costs" onBack={navigateToHub} />

        {/* Monthly bills — internal DB key remains `overheads` (migration name) */}
        <SectionCard
          title="Monthly bills"
          subline="The bills you pay every month whether you work or not — van, insurance, phone, tools."
        >
          <MonthlyOverheadsSection
            overheads={Array.isArray(profile?.overheads) ? profile.overheads : []}
            onSave={handleSave}
          />
        </SectionCard>

        <SectionCard
          title="Job costs"
          subline="When you mark a job paid with nothing logged, we'll ask once. Off if you'd rather we didn't."
        >
          <RemindJobCostsRow
            profile={profile}
            onProfileUpdate={handleSave}
          />
        </SectionCard>

        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Sub-screen: Voice input language (nested under Account) ─────────────
  if (settingsView === 'voice') {
    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader
          title="Voice input language"
          onBack={() => {
            setSettingsView('account');
            requestAnimationFrame(() => {
              if (screenRef.current) screenRef.current.scrollTop = 0;
            });
          }}
        />
        <SectionCard title="Voice input language">
          <VoiceLanguageSection session={session} />
        </SectionCard>
        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Sub-screen: Account & business ───────────────────────────────────────
  if (settingsView === 'account') {
    const voiceLangLabel = (() => {
      const code = typeof localStorage !== 'undefined'
        ? (localStorage.getItem('jp.voiceLang') || 'en-GB')
        : 'en-GB';
      const found = VOICE_LANGS.find(l => l.code === code);
      return found ? found.label : 'English (UK)';
    })();

    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader title="Account & Business" onBack={navigateToHub} />

        <SectionCard title="Account &amp; business">
          <Row label="Name" value={displayName || '—'} onTap={openEditName} />
          {/* Email is passive — no chevron, no tap handler */}
          <Row label="Email" value={email || '—'} chevron={false} />
          {/* Business name uses the same field as Trading name in Invoices & quotes —
              intentional cross-link; both call openEditBusinessName. */}
          <Row label="Business name" value={tradingName || '—'} onTap={openEditBusinessName} />
          <Row
            label="Your trade"
            value={deriveTradeRowValue(profile) ?? 'Not set'}
            onTap={() => setShowTradeSheet(true)}
          />
          <Row
            label="Re-run setup wizard"
            onTap={() => {
              sessionStorage.removeItem('jp.wizardActive');
              onOpenWizard?.();
            }}
            chevron
          />
          {/* Voice input language is re-homed here from the old standalone section.
              Opens a nested 'voice' sub-view rather than rendering the list inline. */}
          <Row
            label="Voice input language"
            value={voiceLangLabel}
            onTap={() => navigateToSubScreen('voice')}
          />
          <Row label="Sign out" danger onTap={onSignOut} chevron={false} />
        </SectionCard>

        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Sub-screen: Notifications ─────────────────────────────────────────────
  if (settingsView === 'notifications') {
    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader title="Notifications" onBack={navigateToHub} />

        <SectionCard title="Notifications">
          <NotificationsSection session={session} />
          <Row
            label="Chase reminders"
            action={notificationsHint}
            chevron
            onTap={() => setShowChaseList(true)}
          />
          <WeeklyDigestRow session={session} profile={profile} onProfileUpdate={onProfileUpdate} />
          <AutoChaseRow
            profile={profile}
            onProfileUpdate={onProfileUpdate}
            onUpgrade={() => openUpgradeSheet(UPGRADE_TRIGGERS.AUTO_CHASE_LOCKED)}
          />
        </SectionCard>

        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Sub-screen: Data & privacy ────────────────────────────────────────────
  if (settingsView === 'privacy') {
    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader title="Data &amp; Privacy" onBack={navigateToHub} />

        <SectionCard title="Data &amp; Privacy">
          {/* Retention copy — DO NOT EDIT. Pending solicitor sign-off on retention
              period decision (DATA-PROTECTION-DECISIONS-FOR-SOLICITOR.md).
              This block is moved verbatim from the inline section. */}
          <p className="settings-section-subtitle">
            Your data is yours. Export it or delete it anytime — no email to support, no waiting.
          </p>
          <p className="settings-section-subtitle" style={{ marginTop: 4 }}>
            We keep your job and invoice records for as long as you do — your accountant and HMRC may need them for up to 6 years. Old leads that never turned into work get tidied away after 6 months.
          </p>
          {/* Export records folded in from the old standalone "Accountant" section.
              Placed above "Export everything" so the accountant-facing export is found first. */}
          <Row
            label="Import jobs"
            value="CSV or Excel"
            onTap={() => setShowImportSheet(true)}
            chevron
          />
          <Row
            label="Export records"
            value={exporting ? 'Preparing…' : 'Choose format'}
            onTap={() => openExportSheet('records')}
            chevron
          />
          <Row label="Privacy Policy" onTap={() => window.open('/privacy', '_blank', 'noopener')} />
          <Row label="Terms of Service" onTap={() => window.open('/terms', '_blank', 'noopener')} />
          <Row label="Cookie Policy" onTap={() => window.open('/cookies', '_blank', 'noopener')} />
          {/* CookieSettingsRow — compliance-sensitive. Pure move; consent toggle still
              wires to getConsent/setConsent inside the component itself. */}
          <CookieSettingsRow />
          <Row
            label="Export everything"
            value={exporting ? 'Preparing…' : 'Choose format'}
            onTap={() => openExportSheet('everything')}
            chevron
          />
          <Row label="Delete account" danger onTap={() => setShowDeleteAccount(true)} chevron />
        </SectionCard>

        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Sub-screen: Help & FAQ ────────────────────────────────────────────────
  if (settingsView === 'help') {
    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader title="Help &amp; FAQ" onBack={navigateToHub} />

        <SectionCard title="Help">
          <Row label="Chat with us" value="WhatsApp" onTap={handleWhatsApp} />
          <Row label="Send feedback" value="Email" onTap={handleSendFeedback} />
          <Row label="Report a bug" value="Email" onTap={handleSendBugReport} />
          <ReferralRow
            session={session}
            profile={profile}
            onGenericShare={handleShare}
          />
          <button
            className={`settings-row${whatsNewDot ? ' settings-row--has-dot' : ''}`}
            type="button"
            onClick={handleOpenWhatsNew}
          >
            <span className="settings-row-label">
              What&rsquo;s new
              {whatsNewDot && <span className="settings-new-dot" aria-label="New updates available" />}
            </span>
            <span className="settings-row-right">
              <span className="settings-row-chevron">›</span>
            </span>
          </button>
        </SectionCard>

        <SectionCard title="FAQ">
          <FaqItem question="How do I send an invoice?">
            <p>Log a job, set the amount, then tap the job to open it and hit "Send invoice". Your customer gets a link they can open in any browser — no app needed. They can also pay by card if you&rsquo;ve connected Stripe in Settings &rarr; Card payments.</p>
          </FaqItem>
          <FaqItem question="How does the free trial work? What happens after 14 days?">
            <p>You get 14 days of Pro free — no card required to start. After that, you drop to the free tier: the full Get Paid loop (quotes, invoices, receipts) stays unlimited forever, and your documents carry a &ldquo;Sent with OHNAR&rdquo; footer. Upgrade to Pro for £12/mo at any time from Settings &rarr; Subscription to remove the footer, unlock the Insight Layer, and get the automatic chase ladder.</p>
          </FaqItem>
          <FaqItem question="How do I cancel or change my plan?">
            <p>Go to Settings &rarr; Subscription &rarr; Manage billing. That opens the Stripe billing portal where you can cancel or update your card. Cancellation takes effect at the end of your current billing period — no pro-rata charge.</p>
          </FaqItem>
          <FaqItem question="Is my data safe? Who can see my jobs?">
            <p>Only you. Your jobs are locked to your account using Supabase Row Level Security — other users cannot read your data even if they tried. Public quote and invoice links are single-use tokens that only reveal what you choose to share with the customer.</p>
          </FaqItem>
          <FaqItem question="How does a customer accept a quote and pay?">
            <p>Send them the quote link. They open it in their browser, review the breakdown, sign with their finger, tick the T&amp;Cs checkbox, and tap Confirm. If you&rsquo;ve set a deposit, they can pay it via Stripe right there. You get a push notification the moment they accept.</p>
          </FaqItem>
          <FaqItem question="How do I import, export, or delete my data?">
            <p>Settings &rarr; Data &amp; privacy &rarr; Import jobs lets you bring existing jobs across from a CSV or Excel spreadsheet. Export everything downloads all your jobs as a spreadsheet (CSV) or a PDF summary. Delete account wipes everything immediately — no email to support, no waiting.</p>
          </FaqItem>
        </SectionCard>

        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Sub-screen: App ───────────────────────────────────────────────────────
  if (settingsView === 'app') {
    return (
      <div className="screen settings-screen" ref={screenRef}>
        <SubScreenHeader title="App" onBack={navigateToHub} />

        <SectionCard title="App">
          <div className="settings-row settings-row--passive settings-row--theme">
            <span className="settings-row-label">Theme</span>
            <div className="theme-picker" role="group" aria-label="Choose theme">
              {[
                { value: 'light',  label: 'Light'  },
                { value: 'dark',   label: 'Dark'   },
                { value: 'system', label: 'System' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`theme-option${themePref === value ? ' theme-option--active' : ''}`}
                  onClick={() => handleThemePref(value)}
                  aria-pressed={themePref === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Row label="Version" value={APP_VERSION} chevron={false} />
        </SectionCard>

        <div style={{ height: 32 }} />
        {modalLayer}
      </div>
    );
  }

  // ── Hub view ──────────────────────────────────────────────────────────────
  // Derive hint values for hub category rows
  const depositHint = (() => {
    const pct = profile?.default_deposit_percent ?? 25;
    const cardOn = profile?.stripe_connect_status === 'connected' && profile?.stripe_user_id;
    return cardOn ? `Card on · Deposit ${pct}%` : `Deposit ${pct}%`;
  })();

  const overheadTotal = getOverheadTotal(
    Array.isArray(profile?.overheads) ? profile.overheads : []
  );
  const costsHint = (Array.isArray(profile?.overheads) && profile.overheads.length > 0)
    ? `£${overheadTotal.toFixed(0)}/mo bills`
    : 'Add your bills';

  return (
    <div className="screen settings-screen" ref={screenRef}>
      <div className="screen-header">
        <h1 className="screen-title">Settings</h1>
        <span className="screen-header-wordmark" aria-hidden="true">OHNAR</span>
      </div>

      {/* ── Pinned block 1: Identity card ─────────────────────────────────── */}
      <div className="settings-identity">
        <SettingsAvatar profile={profile} session={session} />
        <div className="settings-identity-text">
          <div className="settings-identity-name">{displayName}</div>
          {tradingName && <div className="settings-identity-trading">{tradingName}</div>}
          <div className="settings-identity-email">{email}</div>
        </div>
      </div>

      {/* ── Pinned block 2: Profile completion banner ─────────────────────── */}
      {!allRequiredDone && (
        <button
          className="settings-complete-banner"
          onClick={onOpenWizard}
          type="button"
        >
          <span>Profile incomplete — tap to finish setup</span>
          <span>›</span>
        </button>
      )}

      {/* ── Pinned block 3: Subscription slot ─────────────────────────────
          SEAM: foundingEligible ? <FoundingMemberCard/> : <SubscriptionCard/>
          Add the foundingEligible check here when feat/founding-member-price-lock
          merges. SubscriptionCard handles free / trial / Pro branching internally. */}
      <SubscriptionCard profile={profile} openUpgradeSheet={openUpgradeSheet} />

      {/* ── Hub category rows ─────────────────────────────────────────────── */}
      <SectionCard title="Settings">
        <HubCategoryRow
          label="Invoices & Quotes"
          iconName="invoice"
          hint="Logo, bank, VAT, terms"
          onTap={() => navigateToSubScreen('invoices')}
        />
        <HubCategoryRow
          label="Get Paid"
          iconName="money"
          hint={depositHint}
          onTap={() => navigateToSubScreen('getpaid')}
        />
        <HubCategoryRow
          label="Costs"
          iconName="materials"
          hint={costsHint}
          onTap={() => navigateToSubScreen('costs')}
        />
        {/* Rows 4–8: Phase 2 sub-screens — all routed via navigateToSubScreen. */}
        <HubCategoryRow
          label="Account & Business"
          iconName="user"
          hint={displayName}
          onTap={() => navigateToSubScreen('account')}
        />
        <HubCategoryRow
          label="Notifications"
          iconName="bell"
          hint={notificationsHint}
          onTap={() => navigateToSubScreen('notifications')}
        />
        <HubCategoryRow
          label="Data & Privacy"
          iconName="lock"
          onTap={() => navigateToSubScreen('privacy')}
        />
        <HubCategoryRow
          label="Help & FAQ"
          iconName="help"
          dot={whatsNewDot}
          onTap={() => navigateToSubScreen('help')}
        />
        <HubCategoryRow
          label="App"
          iconName="settings"
          hint={themeWord}
          onTap={() => navigateToSubScreen('app')}
        />
      </SectionCard>

      <div style={{ height: 32 }} />
      {modalLayer}
    </div>
  );
}
