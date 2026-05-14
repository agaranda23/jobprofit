/**
 * HeaderAvatar — top-right circle on every screen.
 * Shows user initials derived from profile first/last name (slice 2),
 * falling back to the email local-part until then.
 * Tapping opens the AccountDrawer.
 */
export default function HeaderAvatar({ session, profile, onClick }) {
  const initials = deriveInitials(profile, session);

  return (
    <button
      className="header-avatar"
      onClick={onClick}
      aria-label="Open account"
      title="Account"
    >
      {initials ? (
        <span className="header-avatar__initials">{initials}</span>
      ) : (
        <svg className="header-avatar__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

/**
 * Derive up to 2 uppercase initials.
 * Priority: profile.first_name + profile.last_name → email local-part → null.
 */
function deriveInitials(profile, session) {
  const firstName = profile?.first_name?.trim();
  const lastName = profile?.last_name?.trim();

  if (firstName && lastName) {
    return (firstName[0] + lastName[0]).toUpperCase();
  }
  if (firstName) {
    return firstName.slice(0, 2).toUpperCase();
  }

  // Fall back to email local-part (before @)
  const email = session?.user?.email || '';
  if (!email) return null;

  const local = email.split('@')[0]; // e.g. "alan.smith" or "asmith"
  const parts = local.split(/[._\-+]/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  // Single-part local — take first two alpha chars
  const alpha = local.replace(/[^a-zA-Z]/g, '');
  return alpha.slice(0, 2).toUpperCase() || null;
}
