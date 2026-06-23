// Hash-routing helpers for back-button reliability.
// Hash format:
//   #/today    → Today screen
//   #/work     → Work / Jobs screen
//   #/finance  → Finance / Money screen
//   #/settings → Settings screen
//
// Legacy aliases ('#/jobs', '#/money', '#/schedule') are mapped in parseHash()
// so old bookmarks and push-notification deep-links don't white-screen.

// All four slice-3 views must be listed here — parseHash() and navigateToView()
// use this set to validate view strings. Any view NOT in this list causes the
// Back button to break (navigateToView silently no-ops for unknown views).
export const TOP_VIEWS = ['today', 'work', 'finance', 'settings'];

// Legacy alias map — old deep-links and bookmarks that may exist in the wild.
// These are resolved by parseHash() so they never produce a white screen.
const LEGACY_ALIAS = {
  jobs:     'work',
  schedule: 'work',
  money:    'finance',
};

function buildHash(view) {
  return `#/${view}`;
}

export function pushHistory(state, hash) {
  window.history.pushState(state, '', hash);
}

export function replaceHistory(state, hash) {
  window.history.replaceState(state, '', hash);
}

// Push a top-level view change (today/work/finance/settings).
export function navigateToView(view) {
  if (!TOP_VIEWS.includes(view)) return;
  const hash = buildHash(view);
  if (window.location.hash === hash) return;
  pushHistory({ view }, hash);
}

export function goBack() {
  window.history.back();
}

// Parse a hash string into { view } with sensible defaults.
// Resolves legacy aliases ('jobs' → 'work', 'money' → 'finance', 'schedule' → 'work')
// so old bookmarks and push-notification links don't white-screen.
export function parseHash(hash = window.location.hash) {
  if (!hash || hash === '#' || hash === '#/') {
    return { view: 'today' };
  }
  // Strip leading "#/" or "#"
  const head = hash.replace(/^#\/?/, '').split('/')[0];
  if (LEGACY_ALIAS[head]) return { view: LEGACY_ALIAS[head] };
  if (TOP_VIEWS.includes(head)) return { view: head };
  return { view: 'today' };
}
