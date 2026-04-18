// Hides duplicate metrics from the legacy CRM that are now owned by Today screen.
// Runs on every Manage visit; uses a MutationObserver to catch re-renders.

const TARGETS = ['TODAY YOU MADE'];

function hideMatchingElements(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const toHide = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').trim().toUpperCase();
    if (TARGETS.some(t => text === t || text.includes(t))) {
      // Walk up to find the card-level container (closest ancestor with explicit padding/border-radius)
      let el = node.parentElement;
      let hops = 0;
      while (el && hops < 6) {
        const style = el.getAttribute('style') || '';
        if (style.includes('linear-gradient') || style.includes('border-radius') || style.includes('background')) {
          toHide.add(el);
          break;
        }
        el = el.parentElement;
        hops++;
      }
    }
  }
  for (const el of toHide) el.style.display = 'none';
}

let observer = null;

export function startHidingLegacyDupes(root) {
  if (!root) return;
  hideMatchingElements(root);
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => hideMatchingElements(root));
  observer.observe(root, { childList: true, subtree: true });
}

export function stopHidingLegacyDupes() {
  if (observer) { observer.disconnect(); observer = null; }
}
