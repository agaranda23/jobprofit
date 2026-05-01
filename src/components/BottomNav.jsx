export default function BottomNav({ view, onChange }) {
  const tabs = [
    { id: 'today', label: 'Today', icon: '●' },
    { id: 'history', label: 'Insights', icon: '≡' },
    { id: 'manage', label: 'Business', icon: '⋯' },
  ];
  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`nav-tab ${view === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span className="nav-icon">{t.icon}</span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
