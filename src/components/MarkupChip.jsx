/**
 * MarkupChip — per-line markup override chip on material-sourced quote lines.
 *
 * Shows a "+{n}%" chip. Tapping opens a stepper sheet where the user can
 * adjust in ±5% steps or type a custom value. The sell price recalculates
 * live from buyPrice * (1 + markup/100).
 *
 * Only rendered in QUOTE context — never on invoice-of-actuals or receipt rows.
 *
 * Props:
 *   buyPrice      {number}   — the stored ex-VAT buy price
 *   markup        {number}   — current effective markup % for this line
 *   defaultMarkup {number}   — profile default (shown as hint)
 *   onChange      {Function(newMarkup: number, newSellPrice: number)}
 */

import { useState } from 'react';
import { sellPrice } from '../lib/materials';
import Icon from './Icon';

export default function MarkupChip({
  buyPrice,
  markup,
  defaultMarkup = 20,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [localMarkup, setLocalMarkup] = useState(markup);
  const [customInput, setCustomInput] = useState('');

  const buy  = Number(buyPrice) || 0;
  const sell = sellPrice(buy, localMarkup);

  function applyMarkup(pct) {
    const clamped = Math.max(0, Math.round(pct));
    setLocalMarkup(clamped);
    const newSell = sellPrice(buy, clamped);
    onChange?.(clamped, newSell);
  }

  function step(delta) {
    applyMarkup(localMarkup + delta);
  }

  function applyCustom() {
    const v = parseFloat(customInput);
    if (!isNaN(v) && v >= 0) {
      applyMarkup(v);
      setCustomInput('');
    }
  }

  function handleDone() {
    if (customInput.trim()) applyCustom();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="markup-chip"
        onClick={() => setOpen(true)}
        aria-label={`Markup on this line: ${localMarkup}%. Tap to change.`}
        title="Change markup on this line"
      >
        +{localMarkup}%
      </button>
    );
  }

  return (
    <div className="markup-sheet" role="dialog" aria-modal="true" aria-label="Markup on this line">
      <div className="markup-sheet-header">
        <span className="markup-sheet-title">Markup on this line</span>
        <button
          type="button"
          className="markup-sheet-close"
          onClick={handleDone}
          aria-label="Done"
        >
          <Icon name="check" size={18} />
        </button>
      </div>

      <p className="markup-sheet-helper">
        Buy £{buy.toFixed(2)} → charge £{sell.toFixed(2)}. Your standard markup is {defaultMarkup}%.
      </p>

      <div className="markup-sheet-stepper">
        <button
          type="button"
          className="markup-stepper-btn"
          onClick={() => step(-5)}
          aria-label="Decrease markup by 5%"
          disabled={localMarkup <= 0}
        >
          <Icon name="remove" size={20} />
        </button>
        <span className="markup-stepper-value">{localMarkup}%</span>
        <button
          type="button"
          className="markup-stepper-btn"
          onClick={() => step(5)}
          aria-label="Increase markup by 5%"
        >
          <Icon name="add" size={20} />
        </button>
      </div>

      <div className="markup-sheet-custom-row">
        <input
          type="number"
          inputMode="decimal"
          className="markup-sheet-custom-input"
          placeholder="Custom %"
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { applyCustom(); setOpen(false); } }}
          aria-label="Custom markup percentage"
        />
        <span className="markup-sheet-custom-unit">%</span>
      </div>

      <button className="btn-primary markup-sheet-done" onClick={handleDone}>
        Done — charge £{sell.toFixed(2)}
      </button>
    </div>
  );
}
