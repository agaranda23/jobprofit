/**
 * receiptItemsHelpers.js — pure helpers for the Itemise section of AddReceiptModal.
 *
 * No Supabase, no React — safe to import in unit tests without env vars.
 */

/** Count items that have a non-empty desc (OCR + manual; blank rows don't count). */
export function meaningfulItemCount(items) {
  return items.filter(it => it.desc?.trim()).length;
}

/** Sum the cost of all items (blank-desc rows included in sum if they have a cost). */
export function computeItemsSubtotal(items) {
  return items.reduce((acc, it) => acc + (Number(it.cost) || 0), 0);
}

/**
 * Compare two items arrays for the dirty-guard, ignoring blank-desc rows.
 * Returns true when the meaningful contents differ.
 *
 * Rationale: blank-desc rows are transient UI state (the user opened Itemise
 * and tapped "+ Add item" without filling anything in). We should not flag
 * that as a dirty change requiring a discard confirmation.
 */
export function itemsDirty(current, seedItems) {
  const normalise = arr => arr.filter(it => it.desc?.trim());
  return JSON.stringify(normalise(current)) !== JSON.stringify(normalise(seedItems));
}
