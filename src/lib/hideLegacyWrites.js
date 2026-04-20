// Hide legacy write UI in Manage. These sections still write to
// localStorage only; Today screen provides the cloud-backed path.
//
// Sections to hide:
//  - "Create detailed job" tab button in the Manage toolbar
//  - "Quick Actions" section in Overview (contains New Job + Add Receipt buttons)
//  - "Quick Scan" section in Materials (contains Snap Receipt + Manual buttons)
//
// Note: The visual ALL-CAPS labels are CSS text-transform, real DOM text is title case.

let observer = null;

// Find the "section card" that starts with a label element.
// Strategy: find the label element, then hide it + all its siblings until we hit
// another label-like element. Cleanest is to hide the grandparent section wrapper.
function hideSectionContainingLabel(labelEl) {
  if (!labelEl) return;
  // Walk up until we find a container that looks like a "section wrapper" -
  // typically the parent has siblings for each section.
  // Heuristic: hide labelEl + every following sibling until next heading-like element.
  let el = labelEl;
  while (el && el.parentElement) {
    // If this node has other children that look like buttons/cards, we've got the section
    if (el.tagName === 'DIV' || el.tagName === 'SECTION') {
      const hasButtons = el.querySelectorAll('button').length > 0;
      if (hasButtons) {
        el.style.display = 'none';
        return;
      }
    }
    el = el.parentElement;
  }
  // Fallback: hide labelEl + next sibling
  labelEl.style.display = 'none';
  if (labelEl.nextElementSibling) {
    labelEl.nextElementSibling.style.display = 'none';
  }
}

function sweep(root) {
  if (!root) return;

  // 1) Hide "Create detailed job" tab button
  for (const btn of root.querySelectorAll('button')) {
    const text = (btn.textContent || '').trim();
    if (text.includes('Create detailed job')) {
      btn.style.display = 'none';
    }
  }

  // 2) Find "Quick Actions" and "Quick Scan" labels (title case in DOM)
  //    Hide the enclosing section that contains the buttons.
  const LABELS = ['Quick Actions', 'Quick Scan'];
  const all = root.querySelectorAll('*');
  for (const el of all) {
    const text = (el.textContent || '').trim();
    // Must contain no other "heading"-like siblings in same text
    // We look for elements with length short enough to be a label-only node
    if (el.children.length === 0 && LABELS.includes(text)) {
      // el is the label. Find the section wrapper (closest ancestor that also contains the buttons)
      let section = el.parentElement;
      // Walk up until the ancestor contains a <button>
      while (section && !section.querySelector('button')) {
        section = section.parentElement;
        if (section === root) break;
      }
      if (section && section !== root && section.querySelector('button')) {
        section.style.display = 'none';
      }
    }
  }
}

export function startHidingLegacyWrites(root) {
  stopHidingLegacyWrites();
  if (!root) return;
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
