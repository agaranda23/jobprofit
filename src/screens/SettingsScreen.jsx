/**
 * SettingsScreen — Slice-3 replacement for the top-right AccountDrawer.
 *
 * When jp.navSlice3 is active, this screen renders as the 4th tab.
 * The AccountDrawer and HeaderAvatar are NOT mounted when slice 3 is active
 * (suppressed in AppShell) — this screen is the single account entry point.
 *
 * Section structure:
 *   Account          — real (folds in AccountDrawer logic)
 *   Invoice settings — real labels, placeholder taps
 *   Notifications    — placeholder (wiring is out of scope for slice 3)
 *   Subscription     — placeholder
 *   Accountant       — placeholder
 *   Data & privacy   — placeholder
 *   Help             — placeholder
 *   App              — theme toggle (placeholder) + version read from package.json
 *
 * Judgement calls documented here:
 *   1. "Complete profile" wizard button is kept. It opens the existing wizard
 *      flow via onOpenWizard — same path as the AccountDrawer did.
 *   2. Theme toggle is a visual placeholder only (dark mode is hard-coded in
 *      index.css via prefers-color-scheme). A real toggle is a follow-up task.
 *   3. Version is imported from package.json using Vite's JSON import — zero
 *      runtime overhead, no fetch needed.
 *   4. Section rows that are "coming soon" show a "›" chevron but no tap handler,
 *      matching the AccountDrawer optional-fields pattern.
 */
import { useEffect, useRef, useState } from 'react';
import pkg from '../../package.json';
import { supabase } from '../lib/supabase.js';
import {
  isPushSupported,
  getSubscriptionStatus,
  subscribe as pushSubscribe,
  unsubscribe as pushUnsubscribe,
} from '../lib/pushSubscribe.js';

const APP_VERSION = pkg.version;

// ── Helpers (shared with AccountDrawer — duplicated intentionally to avoid
//    coupling SettingsScreen to a components/ file that may be refactored) ─────

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

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, children }) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">{title}</div>
      <div className="settings-card">{children}</div>
    </div>
  );
}

function Row({ label, value, action, onTap, danger = false, chevron = true }) {
  const handleClick = onTap || undefined;
  return (
    <button
      className={`settings-row ${danger ? 'settings-row--danger' : ''} ${!onTap ? 'settings-row--passive' : ''}`}
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

// ── NotificationsSection ──────────────────────────────────────────────────────
// Manages the push subscription toggle for the current device.
// Status values mirror getSubscriptionStatus() from pushSubscribe.js.

function NotificationsSection({ session }) {
  // 'loading' while we check, then one of the getSubscriptionStatus() values
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
        // 'default' or 'granted-unsubscribed'
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
    return (
      <Row label="Quote signed alerts" value="Checking..." chevron={false} />
    );
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

// ── Voice language picker ─────────────────────────────────────────────────────

const VOICE_LANGS = [
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'pl-PL', label: 'Polski' },
  { code: 'ro-RO', label: 'Română' },
  { code: 'pt-PT', label: 'Português' },
  { code: 'es-ES', label: 'Español' },
];

function VoiceLanguageSection({ session }) {
  const [selected, setSelected] = useState(
    () => localStorage.getItem('jp.voiceLang') || 'en-GB'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = async (code) => {
    const previous = selected;
    setSelected(code); // optimistic
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
      setSelected(previous); // revert
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
            {selected === code && <span className="settings-row-check">✓</span>}
          </span>
        </button>
      ))}
      {error && <p className="settings-row-error">{error}</p>}
    </>
  );
}

// ── SettingsScreen ────────────────────────────────────────────────────────────

export default function SettingsScreen({
  session,
  profile,
  onSignOut,
  onOpenWizard,
}) {
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

  return (
    <div className="screen settings-screen">
      <div className="screen-header">
        <h1 className="screen-title">Settings</h1>
      </div>

      {/* Account identity card */}
      <div className="settings-identity">
        <div className="settings-avatar">
          <span>{deriveInitials(profile, session)}</span>
        </div>
        <div className="settings-identity-text">
          <div className="settings-identity-name">{displayName}</div>
          {tradingName && <div className="settings-identity-trading">{tradingName}</div>}
          <div className="settings-identity-email">{email}</div>
        </div>
      </div>

      {/* Profile completion notice */}
      {!allRequiredDone && (
        <button
          className="settings-complete-banner"
          onClick={onOpenWizard}
          type="button"
        >
          <span>⚠ Profile incomplete — tap to finish setup</span>
          <span>›</span>
        </button>
      )}

      {/* Account section */}
      <SectionCard title="Account">
        <Row label="Name"          value={displayName || '—'} />
        <Row label="Email"         value={email        || '—'} />
        <Row label="Business name" value={tradingName  || '—'} />
        <Row
          label="Sign out"
          danger
          onTap={onSignOut}
          chevron={false}
        />
      </SectionCard>

      {/* Invoice settings */}
      <SectionCard title="Invoice settings">
        <Row label="Logo"         value={profile?.logo_url ? 'Set' : 'None'} />
        <Row label="Trading name" value={tradingName || '—'} />
        <Row label="Bank details" value={(profile?.sort_code && profile?.account_number) ? 'Set' : '—'} />
        <Row label="Hourly rate"  value={profile?.hourly_rate ? `£${profile.hourly_rate}/hr` : '—'} />
        <Row label="VAT"          value={profile?.vat_number ? `Registered` : 'Not set'} />
      </SectionCard>

      {/* Voice input language */}
      <SectionCard title="Voice input language">
        <VoiceLanguageSection session={session} />
      </SectionCard>

      {/* Notifications */}
      <SectionCard title="Notifications">
        <NotificationsSection session={session} />
        <PlaceholderRow label="Chase reminders" />
        <PlaceholderRow label="Weekly profit digest" />
      </SectionCard>

      {/* Subscription */}
      <SectionCard title="Subscription">
        <Row label="Current plan" value="Free" chevron={false} />
        <PlaceholderRow label="Manage billing" />
      </SectionCard>

      {/* Accountant */}
      <SectionCard title="Accountant">
        <PlaceholderRow label="Invite by email" />
        <PlaceholderRow label="Export records" />
      </SectionCard>

      {/* Data & privacy */}
      <SectionCard title="Data &amp; privacy">
        <PlaceholderRow label="Export everything" />
        <PlaceholderRow label="Delete account" />
      </SectionCard>

      {/* Help */}
      <SectionCard title="Help">
        <PlaceholderRow label="Chat with us" />
        <PlaceholderRow label="Send feedback" />
        <PlaceholderRow label="What's new" />
      </SectionCard>

      {/* App */}
      <SectionCard title="App">
        {/* Theme toggle is a visual placeholder — real dark/light toggle is a follow-up.
            The app currently follows system prefers-color-scheme from index.css. */}
        <Row label="Theme" value="System (auto)" />
        <Row label="Version" value={APP_VERSION} chevron={false} />
      </SectionCard>

      {/* Extra breathing room above bottom nav */}
      <div style={{ height: 32 }} />
    </div>
  );
}
