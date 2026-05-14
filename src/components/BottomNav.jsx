/**
 * BottomNav — supports both the legacy 3-tab layout and the new 4-tab layout.
 * Switched by the `newNav` prop (controlled by the NEW_NAV feature flag in AppShell).
 * badgeCount on Money tab shows overdue invoice count (slice 4 wires this up;
 * for now it renders if a positive number is passed).
 */
export default function BottomNav({ view, onChange, newNav = false, moneyBadge = 0 }) {
  const legacyTabs = [
    { id: 'today',   label: 'Today',    icon: '●' },
    { id: 'history', label: 'Insights', icon: '≡' },
    { id: 'manage',  label: 'Business', icon: '⋯' },
  ];

  const newTabs = [
    { id: 'today',    label: 'Today',    icon: '●' },
    { id: 'jobs',     label: 'Jobs',     icon: '⊞' },
    { id: 'schedule', label: 'Schedule', icon: '◫' },
    { id: 'money',    label: 'Money',    icon: '£', badge: moneyBadge > 0 ? moneyBadge : 0 },
  ];

  const tabs = newNav ? newTabs : legacyTabs;

  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`nav-tab ${view === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span className="nav-icon">{t.icon}</span>
          <span className="nav-label">
            {t.label}
            {t.badge > 0 && (
              <span className="nav-badge" aria-label={`${t.badge} overdue`}>{t.badge}</span>
            )}
          </span>
        </button>
      ))}
    </nav>
  );
}
