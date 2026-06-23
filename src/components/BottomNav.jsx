import { logTelemetry } from '../lib/telemetry';
import Icon from './Icon';

/**
 * BottomNav — slice-3 nav (Today / Jobs / Money / Settings).
 *
 * Badge props:
 *   financeBadge — overdue count shown on the Money tab.
 *   workBadge    — count of jobs that need chasing (48h suppression applied),
 *                  shown on the Jobs tab.
 *
 * Icon system (Wave 1): Unicode glyphs replaced with <Icon> from Icon.jsx.
 * Active tab = brand-green filled icon + brand label.
 * Inactive tabs = muted outline icon.
 */
export default function BottomNav({
  view,
  onChange,
  financeBadge = 0,
  workBadge = 0,
}) {
  const tabs = [
    { id: 'today',    label: 'Today',    icon: 'today' },
    { id: 'work',     label: 'Jobs',     icon: 'jobs',  badge: workBadge > 0 ? workBadge : 0 },
    { id: 'finance',  label: 'Money',    icon: 'money', badge: financeBadge > 0 ? financeBadge : 0 },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const handleTap = (tabId) => {
    logTelemetry('tab_tap', { tab: tabId, nav: 'slice3' });
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
