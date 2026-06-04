import { logTelemetry } from '../lib/telemetry';
import Icon from './Icon';

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
 *
 * Icon system (Wave 1): Unicode glyphs replaced with <Icon> from Icon.jsx.
 * Active tab = brand-green filled icon + brand label.
 * Inactive tabs = muted outline icon.
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
    { id: 'today',   label: 'Today',    icon: 'today' },
    { id: 'history', label: 'Insights', icon: 'bar-chart' },
    { id: 'manage',  label: 'Business', icon: 'more-h' },
  ];

  const newTabs = [
    { id: 'today',    label: 'Today',    icon: 'today' },
    { id: 'jobs',     label: 'Jobs',     icon: 'jobs' },
    { id: 'schedule', label: 'Schedule', icon: 'schedule' },
    { id: 'money',    label: 'Money',    icon: 'money', badge: moneyBadge > 0 ? moneyBadge : 0 },
  ];

  const slice3Tabs = [
    { id: 'today',    label: 'Today',    icon: 'today' },
    { id: 'work',     label: 'Jobs',     icon: 'jobs' },
    { id: 'finance',  label: 'Money',    icon: 'money', badge: resolvedFinanceBadge > 0 ? resolvedFinanceBadge : 0 },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const tabs = slice3 ? slice3Tabs : newNav ? newTabs : legacyTabs;

  const handleTap = (tabId) => {
    logTelemetry('tab_tap', { tab: tabId, nav: slice3 ? 'slice3' : newNav ? 'newNav' : 'legacy' });
    onChange(tabId);
  };

  return (
    <nav className="bottom-nav">
      {tabs.map(t => {
        const isActive = view === t.id;
        return (
          <button
            key={t.id}
            className={`nav-tab ${isActive ? 'active' : ''}`}
            onClick={() => handleTap(t.id)}
          >
            <Icon
              name={t.icon}
              size={24}
              variant={isActive ? 'brand' : 'muted'}
              label={t.label}
            />
            <span className="nav-label">
              {t.label}
              {t.badge > 0 && (
                <span className="nav-badge" aria-label={`${t.badge} overdue`}>{t.badge}</span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
