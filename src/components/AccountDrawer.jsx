import { useEffect, useRef } from 'react';

/**
 * AccountDrawer — slide-in panel from the right.
 * Replaces the old "Sign out" button in the Business header.
 * Contains: user identity, required-fields checklist, optional fields, sign-out.
 * Slice 2 will wire required-fields completion status to the real profile data.
 */
export default function AccountDrawer({ open, session, profile, onClose, onSignOut }) {
  const drawerRef = useRef(null);

  // Trap focus and close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Derive display values
  const email = session?.user?.email || '';
  const firstName = profile?.first_name || '';
  const lastName = profile?.last_name || '';
  const tradingName = profile?.business_name || profile?.name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || email;

  // Required-field completion (slice 2 will make these real)
  const required = [
    { label: 'Trading name', done: !!tradingName },
    { label: 'First name',   done: !!firstName },
    { label: 'Last name',    done: !!lastName },
    { label: 'Bank details', done: !!(profile?.sort_code && profile?.account_number) || !!profile?.bankDetails },
    { label: 'Email',        done: !!email },
  ];
  const allRequiredDone = required.every(r => r.done);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={drawerRef}
        className="account-drawer"
        role="dialog"
        aria-label="Account"
        aria-modal="true"
      >
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-avatar">
            <span>{deriveInitials(profile, session)}</span>
          </div>
          <div className="drawer-identity">
            <div className="drawer-name">{displayName}</div>
            {tradingName && <div className="drawer-trading">{tradingName}</div>}
            <div className="drawer-email">{email}</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Required fields */}
        <div className="drawer-section-label" style={{ color: allRequiredDone ? 'var(--jp-green)' : 'var(--jp-amber)' }}>
          {allRequiredDone ? '✓ REQUIRED — COMPLETE' : '⚠ REQUIRED — INCOMPLETE'}
        </div>
        <div className="drawer-card">
          {required.map(r => (
            <div key={r.label} className="drawer-row">
              <span className="drawer-row-label">{r.label}</span>
              <span style={{ color: r.done ? 'var(--jp-green)' : 'var(--jp-amber)', fontSize: 13 }}>
                {r.done ? '✓' : '–'}
              </span>
            </div>
          ))}
        </div>

        {/* Optional fields */}
        <div className="drawer-section-label" style={{ color: 'var(--text-dim)', marginTop: 16 }}>
          OPTIONAL
        </div>
        <div className="drawer-card">
          {[
            { label: '+ Add logo',         done: !!profile?.logo_url || !!profile?.logoUrl },
            { label: '+ Add address',      done: !!profile?.address },
            { label: '+ Set hourly rate',  done: !!profile?.hourly_rate || !!profile?.hourlyRate },
            { label: 'Notifications',      done: null },
            { label: 'VAT settings',       done: null },
          ].map(r => (
            <div key={r.label} className="drawer-row">
              <span
                className="drawer-row-label"
                style={{ color: r.done === false ? 'var(--jp-green)' : 'inherit' }}
              >
                {r.label}
              </span>
              <span style={{ color: 'var(--text-dim)', fontSize: 16 }}>›</span>
            </div>
          ))}
        </div>

        {/* Sign out */}
        <button className="drawer-signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </>
  );
}

function deriveInitials(profile, session) {
  const firstName = profile?.first_name?.trim();
  const lastName = profile?.last_name?.trim();
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
