// Hash-routing helpers for back-button reliability.
// Hash format:
//   #/today                       → top-level view
//   #/history                     → top-level view
//   #/manage                      → top-level view (inner tab defaults to Overview)
//   #/manage/<innerTab>           → manage view + specific inner tab (slugified)
//
// Inner-tab slugs match App.jsx TABS, lowercased and dashed:
//   "Overview" → overview
//   "Create detailed job" → create-detailed-job
//   "Jobs" → jobs
//   "Schedule" → schedule
//   "Materials" → materials
//   "Settings" → settings

export const TOP_VIEWS = ['today', 'history', 'manage', 'jobs', 'schedule', 'money'];

export const INNER_TAB_TO_SLUG = {
  'Overview': 'overview',
  'Create detailed job': 'create-detailed-job',
  'Jobs': 'jobs',
  'Schedule': 'schedule',
  'Materials': 'materials',
  'Settings': 'settings',
};

export const SLUG_TO_INNER_TAB = Object.fromEntries(
  Object.entries(INNER_TAB_TO_SLUG).map(([k, v]) => [v, k])
);

function buildHash(view, innerTab) {
  if (view === 'manage' && innerTab && innerTab !== 'Overview') {
    const slug = INNER_TAB_TO_SLUG[innerTab];
    if (slug) return `#/manage/${slug}`;
  }
  return `#/${view}`;
}

export function pushHistory(state, hash) {
  window.history.pushState(state, '', hash);
}

export function replaceHistory(state, hash) {
  window.history.replaceState(state, '', hash);
}

// Push a top-level view change (today/history/manage).
export function navigateToView(view) {
  if (!TOP_VIEWS.includes(view)) return;
  const hash = buildHash(view);
  if (window.location.hash === hash) return;
  pushHistory({ view }, hash);
}

// Push an inner App.jsx tab change. Inner tabs only exist under view='manage'.
export function navigateToInnerTab(innerTab) {
  if (!INNER_TAB_TO_SLUG[innerTab]) return;
  const hash = buildHash('manage', innerTab);
  if (window.location.hash === hash) return;
  pushHistory({ view: 'manage', innerTab }, hash);
}

export function goBack() {
  window.history.back();
}

// Parse a hash string into { view, innerTab } with sensible defaults.
export function parseHash(hash = window.location.hash) {
  if (!hash || hash === '#' || hash === '#/') {
    return { view: 'today', innerTab: null };
  }
  // Strip leading "#/" or "#"
  const path = hash.replace(/^#\/?/, '');
  const [head, sub] = path.split('/');
  if (!TOP_VIEWS.includes(head)) {
    return { view: 'today', innerTab: null };
  }
  if (head === 'manage') {
    const innerTab = sub ? SLUG_TO_INNER_TAB[sub] || null : null;
    return { view: 'manage', innerTab };
  }
  return { view: head, innerTab: null };
}
