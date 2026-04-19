// Hides duplicate UI from the legacy CRM that's now owned by the Today/Manage shell.
// Runs on every Manage visit; uses a MutationObserver to catch re-renders.

// Match against text nodes (uppercased before compare).
const TEXT_TARGETS = ['TODAY YOU MADE', 'BUILD WEALTH, NOT JUST JOBS'];

function hideTextMatch(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const toHide = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').trim().toUpperCase();
    if (!text) continue;
    if (!TEXT_TARGETS.some(t => text === t || text.includes(t))) continue;

    // Walk up to find the card-level container.
    let el = node.parentElement;
    let hops = 0;
    while (el && hops < 8) {
      const style = el.getAttribute('style') || '';
      // Accept: anything with a background, border-radius, or that's a clear flex/grid card,
      // OR the immediate parent if it's a small wrapper (header logo lockup).
      if (
        style.includes('linear-gradient') ||
        style.includes('border-radius') ||
        style.includes('background') ||
        (hops >= 1 && (style.includes('display: flex') || style.includes('display:flex')))
      ) {
        toHide.add(el);
        break;
      }
      el = el.parentElement;
      hops++;
    }
    // If we never found a styled wrapper, hide the immediate parent so brand
    // text + image disappear together.
    if (hops >= 8) {
      toHide.add(node.parentElement);
    }
  }
  for (const el of toHide) {
    if (el && el.style) el.style.display = 'none';
  }
}

let observer = null;

export function startHidingLegacyDupes(root) {
  if (!root) return;
  hideTextMatch(root);
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => hideTextMatch(root));
  observer.observe(root, { childList: true, subtree: true });
}

export function stopHidingLegacyDupes() {
  if (observer) { observer.disconnect(); observer = null; }
}
