/**
 * BottomNav — supports three nav layouts:
 *   1. legacy 3-tab (Today / Insights / Business) — default
 *   2. newNav 4-tab (Today / Jobs / Schedule / Money) — newNav prop
 *   3. slice3 4-tab (Today / Jobs / Money / Settings) — slice3 prop
 *
 * Selection order: slice3 > newNav > legacy.
 *
 * Badge props:
 *   financeBadge — used by slice-3 Money tab (alias of legacy moneyBadge).
 *   moneyBadge   — used by newNav Money tab (kept for back-compat).
 */
export default function BottomNav({
  view,
  onChange,
  newNav = false,
  slice3 = false,
  moneyBadge = 0,
  financeBadge = 0,
}) {
  // Back-compat: financeBadge aliases moneyBadge when slice3 is active.
  const resolvedFinanceBadge = financeBadge > 0 ? financeBadge : moneyBadge > 0 ? moneyBadge : 0;

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

  const slice3Tabs = [
    { id: 'today',    label: 'Today',    icon: '●' },
    { id: 'work',     label: 'Jobs',     icon: '⊞' },
    { id: 'finance',  label: 'Money',    icon: '£', badge: resolvedFinanceBadge > 0 ? resolvedFinanceBadge : 0 },
    { id: 'settings', label: 'Settings', icon: '⚙' },
  ];

  const tabs = slice3 ? slice3Tabs : newNav ? newTabs : legacyTabs;

  const handleTap = (tabId) => {
    // Telemetry — wire to real analytics when infrastructure exists
    // TODO: replace console.log with posthog/mixpanel/etc
    console.log('[telemetry] tab_tap', { tab: tabId, nav: slice3 ? 'slice3' : newNav ? 'newNav' : 'legacy' });
    onChange(tabId);
  };

  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`nav-tab ${view === t.id ? 'active' : ''}`}
          onClick={() => handleTap(t.id)}
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
