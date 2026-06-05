/**
 * marginForecast.js — Forward-looking profit/margin/markup calculator.
 *
 * TRADER-ONLY. These figures must never appear in customer-facing outputs
 * (PreviewTable, quote PDF, public quote page, WhatsApp message).
 *
 * Terminology (important — do not confuse with the existing job `cost` field):
 *   price    — the quote total the customer pays (ex-VAT in V1).
 *   estCost  — what the trader will spend: materials, parts, hire.
 *              Does NOT include the trader's own labour time — a sole trader's
 *              time is the profit, not a cost.
 *   profit   — price − estCost
 *   margin%  — profit / price × 100
 *   markup%  — profit / estCost × 100  (undefined when estCost = 0)
 *
 * FIN reference examples (V1 spec):
 *   £1000 price / £400 cost → £600 profit / 60% margin / 150% markup
 *   £600  price / £400 cost → £200 profit / 33% margin / 50%  markup
 *   £350  price / £400 cost → −£50 profit (loss case)
 */

/**
 * Calculates the profit, margin, and markup for a quote.
 *
 * @param {number} price    – quote total in pounds (ex-VAT). Must be > 0.
 * @param {number} estCost  – trader spend in pounds. Must be ≥ 0.
 * @returns {{
 *   profit:   number,   – price − estCost (may be negative)
 *   margin:   number,   – profit / price × 100 (rounded to 1dp)
 *   markup:   number | null, – profit / estCost × 100 (null when estCost = 0)
 * }}
 */
export function calcMarginForecast(price, estCost) {
  const p = Number(price)   || 0;
  const c = Number(estCost) || 0;

  if (p <= 0) {
    return { profit: 0, margin: 0, markup: null };
  }

  const profit = p - c;
  const margin = Math.round((profit / p) * 1000) / 10; // 1dp
  const markup = c > 0
    ? Math.round((profit / c) * 1000) / 10  // 1dp
    : null; // undefined when no cost entered

  return { profit, margin, markup };
}

/**
 * Returns the display state for the margin forecast section.
 *
 * States:
 *   'empty'   — no cost entered yet; show nudge, no numbers.
 *   'loss'    — estCost > price; show amber warning.
 *   'thin'    — margin 0–14.9%; show quiet amber advisory.
 *   'ok'      — margin ≥ 15%; show the full readout normally.
 *
 * @param {number|null} estCost
 * @param {number} price
 * @returns {'empty' | 'loss' | 'thin' | 'ok'}
 */
export function marginForecastState(estCost, price) {
  const c = Number(estCost);
  const p = Number(price);

  if (!estCost && estCost !== 0) return 'empty';
  if (isNaN(c) || isNaN(p) || p <= 0) return 'empty';

  const { margin } = calcMarginForecast(p, c);

  if (margin < 0) return 'loss';
  if (margin < 15) return 'thin';
  return 'ok';
}

/**
 * Builds the one-tap markup teach copy string.
 *
 * Example output:
 *   "You added 150% (markup) — that's a 60% margin. Three fifths of the price is yours."
 *   "You added 50% (markup) — that's a 33% margin. A third of the price is yours."
 *
 * @param {number} markup  – the markup % (already rounded)
 * @param {number} margin  – the margin % (already rounded)
 * @returns {string}
 */
export function markupTeachCopy(markup, margin) {
  const fractionPhrase = marginToFractionPhrase(margin);
  return `You added ${fmt1dp(markup)}% (markup) — that's a ${fmt1dp(margin)}% margin. ${fractionPhrase}`;
}

/** Formats a number to 1dp, removing trailing '.0' for clean display. */
function fmt1dp(n) {
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1);
}

/**
 * Maps a margin % to a human-readable fraction phrase.
 * Used in the markup teach copy.
 *
 * Snap points (within 3pp):
 *   ~100%  → "All of the price is yours."
 *   ~75%   → "Three quarters of the price is yours."
 *   ~67%   → "Two thirds of the price is yours."
 *   ~60%   → "Three fifths of the price is yours."
 *   ~50%   → "Half the price is yours."
 *   ~33%   → "A third of the price is yours."
 *   ~25%   → "A quarter of the price is yours."
 *   other  → "{margin}% of the price is yours."
 */
export function marginToFractionPhrase(margin) {
  const m = Math.round(margin);
  if (m >= 97) return 'Almost all of the price is yours.';
  if (m >= 72 && m <= 78) return 'Three quarters of the price is yours.';
  if (m >= 64 && m <= 70) return 'Two thirds of the price is yours.';
  if (m >= 57 && m <= 63) return 'Three fifths of the price is yours.';
  if (m >= 47 && m <= 53) return 'Half the price is yours.';
  if (m >= 30 && m <= 36) return 'A third of the price is yours.';
  if (m >= 22 && m <= 28) return 'A quarter of the price is yours.';
  return `${fmt1dp(margin)}% of the price is yours.`;
}
