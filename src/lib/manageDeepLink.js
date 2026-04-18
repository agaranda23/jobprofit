// Click the legacy "Create detailed job" tab inside the Manage view.
// Used when user taps "Create detailed job in Manage" from the AddJobModal.
// Same pattern as hideLegacyDupes — DOM-level, no App.jsx state edits.

export function clickCreateDetailedJobTab(root, attempts = 10) {
  if (!root) return;
  const tryClick = (remaining) => {
    const buttons = root.querySelectorAll('button, [role="tab"]');
    for (const b of buttons) {
      const txt = (b.textContent || '').trim();
      if (txt === 'Create detailed job' || txt.includes('Create detailed job')) {
        b.click();
        return true;
      }
    }
    if (remaining > 0) {
      setTimeout(() => tryClick(remaining - 1), 80);
    }
    return false;
  };
  tryClick(attempts);
}
