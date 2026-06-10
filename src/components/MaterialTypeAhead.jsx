/**
 * MaterialTypeAhead — inline dropdown for material suggestions.
 *
 * Renders beneath the line-item description input when the user types.
 * Shows up to 5 matching materials ranked by score then use_count.
 *
 * CONTEXT-AWARE PRICING (moat rule):
 *   context='quote'   → fills cost with SELL price (buy * (1 + markup/100))
 *                        and stashes buyPrice + materialId on the line item.
 *   context='receipt' → fills cost with BUY price only.
 *
 * Props:
 *   materials       {object[]}  — full library (passed from parent, not fetched here)
 *   query           {string}    — current desc input value
 *   context         {'quote'|'receipt'}
 *   defaultMarkup   {number}    — profile default_markup
 *   onSelect        {Function({ desc, cost, unit, buyPrice?, materialId?, provenance? })}
 *   onBrowseAll     {Function}  — opens MaterialsScreen
 *   onSaveItem      {Function({ desc, buyPrice, unit })} — bookmark tap
 */

import { useMemo, useState } from 'react';
import { filterMaterials, resolveMarkup, sellPrice } from '../lib/materials';
import Icon from './Icon';

export default function MaterialTypeAhead({
  materials = [],
  query = '',
  context = 'quote',
  defaultMarkup = 20,
  onSelect,
  onBrowseAll,
  onSaveItem,
}) {
  const [savedId, setSavedId] = useState(null); // flash feedback for save bookmark

  const suggestions = useMemo(
    () => filterMaterials(materials, query),
    [materials, query]
  );

  if (suggestions.length === 0 && !query.trim()) return null;

  function handleSelect(material) {
    const markup = resolveMarkup(material.default_markup, defaultMarkup);
    const buy    = Number(material.cost) || 0;

    if (context === 'quote') {
      const sell = sellPrice(buy, markup);
      onSelect?.({
        desc:       material.desc,
        cost:       sell,           // sell price → customer charge
        unit:       material.unit || '',
        buyPrice:   buy,            // stashed, not shown to customer
        materialId: material.id,
        provenance: 'material',
      });
    } else {
      // receipt / cost context: fill with buy price
      onSelect?.({
        desc:       material.desc,
        cost:       buy,
        unit:       material.unit || '',
        buyPrice:   buy,
        materialId: material.id,
        provenance: 'material',
      });
    }
  }

  function handleSave(e, material) {
    e.stopPropagation();
    onSaveItem?.({ desc: material.desc, buyPrice: material.cost, unit: material.unit });
    setSavedId(material.id);
    setTimeout(() => setSavedId(null), 1800);
  }

  const isEmpty = suggestions.length === 0;

  return (
    <div className="mta-dropdown" role="listbox" aria-label="Material suggestions">
      {isEmpty && query.trim() && (
        <div className="mta-empty">
          No saved materials match. Type the item and tap the bookmark to save it for next time.
        </div>
      )}

      {suggestions.map(m => {
        const markup   = resolveMarkup(m.default_markup, defaultMarkup);
        const buy      = Number(m.cost) || 0;
        const sell     = context === 'quote' ? sellPrice(buy, markup) : buy;
        const isSaved  = savedId === m.id;

        return (
          <button
            key={m.id}
            type="button"
            className="mta-row"
            role="option"
            aria-selected="false"
            onClick={() => handleSelect(m)}
          >
            <div className="mta-row-text">
              <span className="mta-row-desc">{m.desc}</span>
              <span className="mta-row-meta">
                {m.unit && <span className="mta-row-unit">{m.unit}</span>}
                {m.unit && ' · '}
                <span className="mta-row-buy">buy £{buy.toFixed(2)}</span>
                {context === 'quote' && (
                  <span className="mta-row-sell"> · <span className="mta-row-sell-price">£{sell.toFixed(2)}</span></span>
                )}
              </span>
            </div>
            {isSaved ? (
              <span className="mta-saved-flash" aria-label="Saved">
                <Icon name="check" size={14} variant="success" />
              </span>
            ) : (
              <button
                type="button"
                className="mta-save-btn"
                aria-label="Save for next time"
                title="Save for next time"
                onClick={(e) => handleSave(e, m)}
                tabIndex={-1}
              >
                <Icon name="star" size={14} variant="muted" />
              </button>
            )}
          </button>
        );
      })}

      {/* Browse all — always shown when there are materials or a query */}
      <button
        type="button"
        className="mta-browse-all"
        onClick={onBrowseAll}
        aria-label="Browse all saved materials"
      >
        Browse all
        <Icon name="arrow-right" size={14} className="mta-browse-icon" />
      </button>
    </div>
  );
}
