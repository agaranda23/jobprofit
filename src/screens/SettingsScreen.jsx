/**
 * SettingsScreen — Slice-3 replacement for the top-right AccountDrawer.
 *
 * When jp.navSlice3 is active, this screen renders as the 4th tab.
 * The AccountDrawer and HeaderAvatar are NOT mounted when slice 3 is active
 * (suppressed in AppShell) — this screen is the single account entry point.
 *
 * Section structure:
 *   Account          — real (folds in AccountDrawer logic)
 *   Invoice settings — real labels, all editable via EditFieldModal
 *   Notifications    — push toggle + placeholders
 *   Subscription     — placeholder
 *   Accountant       — placeholder
 *   Data & privacy   — placeholder
 *   Help             — placeholder
 *   App              — theme toggle (placeholder) + version read from package.json
 *
 * Judgement calls documented here:
 *   1. "Re-run setup wizard" row is a manual escape hatch — always available at
 *      the bottom of Account, regardless of completion status.
 *   2. Logo row opens a text-input modal for v1 (URL only). A proper upload
 *      flow is deferred to a follow-up — noted in this file.
 *   3. Theme toggle is a visual placeholder only (dark mode is hard-coded in
 *      index.css via prefers-color-scheme). A real toggle is a follow-up task.
 *   4. Version is imported from package.json using Vite's JSON import — zero
 *      runtime overhead, no fetch needed.
 *   5. Editable rows use EditFieldModal (single or composite). Saves bubble
 *      up via onProfileUpdate — AppShell writes to Supabase + updates profile.
 */
import { useEffect, useRef, useState } from 'react';
import pkg from '../../package.json';
import { supabase } from '../lib/supabase.js';
import EditFieldModal from '../components/EditFieldModal.jsx';
import {
  isPushSupported,
  getSubscriptionStatus,
  subscribe as pushSubscribe,
  unsubscribe as pushUnsubscribe,
} from '../lib/pushSubscribe.js';
import { OVERHEAD_CATEGORIES } from '../lib/overheads.js';
import { getOverheadTotal } from '../lib/cashflow.js';
import { isPro, isTrialActive, trialDaysLeft, UNLOCK_PRO_FOR_ALL } from '../lib/plan.js';
import { startCheckout, openBillingPortal } from '../lib/billing.js';
import { isValidStripePaymentLink } from '../lib/bizValidation.js';
import { buildJobsCsv, downloadOrShareCsv } from '../lib/exportCsv.js';
import { buildChaseList } from '../lib/chaseList.js';

const APP_VERSION = pkg.version;

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
            {selected === code && <span className="settings-row-check">✓</span>}
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

  // Keep local items in sync if the parent profile reloads
  useEffect(() => {
    setItems(Array.isArray(overheads) ? overheads : []);
  }, [overheads]);

  const persist = async (next) => {
    setSaving(true);
    setError('');
    try {
      await onSave({ overheads: next });
      setItems(next);
    } catch {
      setError('Could not save — try again');
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

  const handleAdd = () => {
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
    persist([...items, newItem]).then(() => setAddState(null));
  };

  const handleEditSave = (id) => {
    if (!editState) return;
    const name = (editState.name || '').trim();
    const amount = parseFloat(editState.amount);
    if (!name) { setError('Name is required'); return; }
    if (isNaN(amount) || amount < 0) { setError('Enter a valid amount'); return; }
    const next = items.map(i =>
      i.id === id ? { ...i, name, amount, category: editState.category || i.category } : i
    );
    persist(next).then(() => { setEditId(null); setEditState(null); });
  };

  const activeTotal = getOverheadTotal(items);
  const activeCount = items.filter(i => i.is_active !== false).length;

  return (
    <div className="overheads-section">
      {items.length > 0 && (
        <div className="overheads-summary">
          {activeCount > 0
            ? `£${activeTotal.toFixed(2)}/mo across ${activeCount} cost${activeCount === 1 ? '' : 's'}`
            : 'No active running costs'}
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
        <button
          type="button"
          className="overheads-add-btn"
          onClick={() => setAddState({ name: '', amount: '', category: 'Other' })}
        >
          + Add running cost
        </button>
      )}

      {error && <p className="settings-row-error">{error}</p>}
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

  // ── Edit modal state ──────────────────────────────────────────────────────
  // activeEdit: null | { modal: string, ...props for EditFieldModal }
  const [activeEdit, setActiveEdit] = useState(null);
  const [saveToast, setSaveToast] = useState('');
  const toastTimerRef = useRef(null);

  // ── Export state ──────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    const safeReceipts = Array.isArray(receipts) ? receipts : [];
    if (safeJobs.length === 0) {
      showSavedToast('No jobs to export yet');
      return;
    }
    setExporting(true);
    try {
      const csv = buildJobsCsv(safeJobs, safeReceipts);
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      await downloadOrShareCsv(csv, `jobprofit-${stamp}.csv`);
    } catch {
      showSavedToast('Export failed — try again');
    } finally {
      setExporting(false);
    }
  };

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

  const openEditLogo = () => setActiveEdit({
    modal: 'logo_url',
    fieldKey: 'logo_url',
    fieldLabel: 'Logo URL',
    currentValue: profile?.logo_url || '',
    placeholder: 'https://yourdomain.com/logo.png',
    helpText: 'Paste a public image URL. A full upload flow is coming soon.',
    // Logo URL is optional — no required validation
    validate: null,
  });

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

  // ── Render ─────────────────────────────────────────────────────────────────

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
          <span>Profile incomplete — tap to finish setup</span>
          <span>›</span>
        </button>
      )}

      {/* Account section */}
      <SectionCard title="Account">
        <Row
          label="Name"
          value={displayName || '—'}
          onTap={openEditName}
        />
        <Row
          label="Email"
          value={email || '—'}
          chevron={false}
        />
        <Row
          label="Business name"
          value={tradingName || '—'}
          onTap={openEditBusinessName}
        />
        <Row
          label="Re-run setup wizard"
          onTap={() => {
            // Remove the once-per-session guard so the wizard can open again
            sessionStorage.removeItem('jp.wizardActive');
            onOpenWizard?.();
          }}
          chevron
        />
        <Row
          label="Sign out"
          danger
          onTap={onSignOut}
          chevron={false}
        />
      </SectionCard>

      {/* Invoice settings */}
      <SectionCard title="Invoice settings">
        <Row
          label="Logo"
          value={profile?.logo_url ? 'Set' : 'None'}
          onTap={openEditLogo}
        />
        {/* Trading name here is the same business_name field — same edit modal */}
        <Row
          label="Trading name"
          value={tradingName || '—'}
          onTap={openEditBusinessName}
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
          label="VAT"
          value={profile?.vat_number ? 'Registered' : 'Not set'}
          onTap={openEditVat}
        />
        <Row
          label="Tax set-aside %"
          value={`${profile?.tax_set_aside_pct ?? 20}%`}
          onTap={openEditTaxSetAside}
        />
        <Row
          label="Card payment link"
          value={profile?.stripe_payment_link ? 'Set' : 'Not set'}
          onTap={openEditStripeLink}
        />
      </SectionCard>

      {/* Monthly running costs */}
      <SectionCard title="Monthly running costs">
        <MonthlyOverheadsSection
          overheads={Array.isArray(profile?.overheads) ? profile.overheads : []}
          onSave={handleSave}
        />
      </SectionCard>

      {/* Voice input language */}
      <SectionCard title="Voice input language">
        <VoiceLanguageSection session={session} />
      </SectionCard>

      {/* Notifications */}
      <SectionCard title="Notifications">
        <NotificationsSection session={session} />
        <Row
          label="Chase reminders"
          action={(() => {
            const safeJobs = Array.isArray(jobs) ? jobs : [];
            const count = buildChaseList(safeJobs).length;
            return count > 0 ? `${count} to chase` : 'All clear';
          })()}
          chevron
          onTap={() => setShowChaseList(true)}
        />
        <PlaceholderRow label="Weekly profit digest" />
      </SectionCard>

      {/* Subscription */}
      <SectionCard title="Subscription">
        {/* Trial state — shown only when override is off and user is on an active trial */}
        {!UNLOCK_PRO_FOR_ALL && isTrialActive(profile) ? (
          <>
            <Row
              label="Current plan"
              value={`Free trial · ${trialDaysLeft(profile)} day${trialDaysLeft(profile) === 1 ? '' : 's'} left`}
              chevron={false}
            />
            <Row
              label="Add card to stay Pro"
              action="£12/mo"
              onTap={async () => {
                const { error } = await startCheckout();
                if (error) setSaveToast(error);
              }}
            />
          </>
        ) : isPro(profile) ? (
          <>
            <Row
              label="Current plan"
              value="Pro"
              chevron={false}
            />
            <Row
              label="Manage billing"
              onTap={async () => {
                const { error } = await openBillingPortal();
                if (error) setSaveToast(error);
              }}
            />
          </>
        ) : (
          <>
            <Row
              label="Current plan"
              value="Free"
              chevron={false}
            />
            <Row
              label="Upgrade to Pro"
              action="£12/mo"
              onTap={async () => {
                const { error } = await startCheckout();
                if (error) setSaveToast(error);
              }}
            />
          </>
        )}
      </SectionCard>

      {/* Accountant */}
      <SectionCard title="Accountant">
        <PlaceholderRow label="Invite by email" />
        <Row
          label="Export records"
          value={exporting ? 'Preparing…' : 'CSV'}
          onTap={exporting ? undefined : handleExport}
          chevron={false}
        />
      </SectionCard>

      {/* Data & privacy */}
      <SectionCard title="Data &amp; privacy">
        <Row
          label="Export everything"
          value={exporting ? 'Preparing…' : 'CSV'}
          onTap={exporting ? undefined : handleExport}
          chevron={false}
        />
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

      {/* ── Saved toast ──────────────────────────────────────────────────── */}
      {saveToast && (
        <div className="toast" role="status" aria-live="polite">
          {saveToast}
        </div>
      )}

      {/* ── Edit field modal ─────────────────────────────────────────────── */}
      {activeEdit && (
        <EditFieldModal
          open
          // Composite mode (name / bank)
          title={activeEdit.title}
          fields={activeEdit.fields}
          // Single-field mode
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
                      // Navigate to the job in the Jobs tab
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
    </div>
  );
}
