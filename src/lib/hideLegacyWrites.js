// Hide legacy write UI in Manage. These sections still write to
// localStorage only; Today screen provides the cloud-backed path.
//
// Sections to hide:
//  - "Create detailed job" tab button in the Manage toolbar
//  - QUICK ACTIONS section in Overview (contains New Job + Add Receipt buttons)
//  - QUICK SCAN section in Materials (contains Snap Receipt + Manual buttons)

let observer = null;

function sweep(root) {
  if (!root) return;

  // --- Hide "Create detailed job" tab button ---
  for (const btn of root.querySelectorAll('button')) {
    const text = (btn.textContent || '').trim();
    if (text.includes('Create detailed job')) {
      btn.style.display = 'none';
    }
  }

  // --- Hide sections whose header text matches ---
  const HEADER_MATCHERS = [
    'QUICK ACTIONS',
    'QUICK SCAN',
  ];

  for (const el of root.querySelectorAll('*')) {
    const text = (el.textContent || '').trim();
    // Only consider nodes whose OWN direct text (ignoring descendants) is a header
    // Simplest check: element has no children elements, just text
    if (el.children.length === 0) {
      for (const needle of HEADER_MATCHERS) {
        if (text === needle || text.startsWith(needle + '\n') || text === '📷 ' + needle || text.startsWith('📷 ' + needle)) {
          // Hide the header's *nearest containing card*: walk up until we find a sibling 
          // structure or a card-like container. Simplest: hide the parent of the header.
          const card = el.closest('div');
          if (card && card !== root) {
            // Hide the card (the direct parent div — should be the whole section)
            let target = card;
            // If the card contains ONLY the header + one button row, the card is fine
            // If the card is too nested, go one level up
            if (card.parentElement && card.parentElement !== root && card.children.length <= 2) {
              target = card.parentElement;
            }
            target.style.display = 'none';
          }
        }
      }
    }
  }
}

export function startHidingLegacyWrites(root) {
  stopHidingLegacyWrites();
  if (!root) return;
  // Run a few times to catch async renders
  sweep(root);
  setTimeout(() => sweep(root), 100);
  setTimeout(() => sweep(root), 400);
  observer = new MutationObserver(() => sweep(root));
  observer.observe(root, { childList: true, subtree: true });
}

export function stopHidingLegacyWrites() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
