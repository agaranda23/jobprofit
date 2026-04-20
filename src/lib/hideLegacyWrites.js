// Hide legacy write buttons in Manage (Create detailed job tab,
// Snap Receipt / Manual on Materials tab). These still write to
// localStorage only; Today screen provides the cloud-backed path.

const HIDE_TEXTS = [
  'Create detailed job',
  'Snap Receipt',
  'Manual',  // careful - generic; we'll scope to Materials section
];

function matchText(el, texts) {
  const t = (el.textContent || '').trim();
  return texts.some(x => t === x || t.startsWith(x));
}

let observer = null;

function sweep(root) {
  if (!root) return;
  // Hide the "Create detailed job" tab button
  const tabButtons = root.querySelectorAll('button');
  for (const btn of tabButtons) {
    const text = (btn.textContent || '').trim();
    if (text.includes('Create detailed job')) {
      btn.style.display = 'none';
    }
    if (text === 'Snap Receipt' || text.trim() === 'Manual') {
      // Only hide if inside a section that looks like Quick Scan
      let p = btn.parentElement;
      while (p && p !== root) {
        if ((p.textContent || '').includes('QUICK SCAN')) {
          btn.style.display = 'none';
          break;
        }
        p = p.parentElement;
      }
    }
  }
  // Also hide the whole "Quick Scan" card on Materials
  const allDivs = root.querySelectorAll('div');
  for (const d of allDivs) {
    const t = (d.textContent || '').trim();
    // Exact-ish match — the quick scan card contains just a handful of text nodes
    if (t.startsWith('📷 QUICK SCAN') && t.length < 300) {
      d.style.display = 'none';
    }
  }
}

export function startHidingLegacyWrites(root) {
  stopHidingLegacyWrites();
  if (!root) return;
  sweep(root);
  observer = new MutationObserver(() => sweep(root));
  observer.observe(root, { childList: true, subtree: true });
}

export function stopHidingLegacyWrites() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
