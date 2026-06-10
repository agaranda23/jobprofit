/**
 * MaterialsScreen — the Materials Library full-screen view.
 *
 * Accessible from the type-ahead "Browse all" row and from Settings (future).
 * Renders the full library with search, sorted Frequent → A–Z.
 * Swipe-left (long-press on mobile) to archive. Manual "Add an item" CTA.
 *
 * Props:
 *   materials        {object[]}  — current library (from parent state)
 *   defaultMarkup    {number}    — profile default_markup (for display only)
 *   onClose          {Function}  — back / close
 *   onAdd            {Function}  — open AddMaterialModal
 *   onArchive        {Function(id)} — soft-delete a row
 *   onEdit           {Function(material)} — open edit sheet for a row
 */

import { useState } from 'react';
import Icon from '../components/Icon';

export default function MaterialsScreen({
  materials = [],
  defaultMarkup = 20,
  onClose,
  onAdd,
  onArchive,
  onEdit,
}) {
  const [query, setQuery] = useState('');
  const [swipedId, setSwipedId] = useState(null); // which row has the swipe-action revealed

  const filtered = materials.filter(m => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (m.desc || '').toLowerCase().includes(q) ||
      (m.supplier_code || '').toLowerCase().includes(q) ||
      (m.supplier || '').toLowerCase().includes(q)
    );
  });

  // Sort: Frequent (use_count > 0) → A–Z
  const sorted = [...filtered].sort((a, b) => {
    if ((b.use_count || 0) !== (a.use_count || 0)) return (b.use_count || 0) - (a.use_count || 0);
    return (a.desc || '').localeCompare(b.desc || '');
  });

  function handleArchive(id) {
    setSwipedId(null);
    onArchive?.(id);
  }

  return (
    <div className="screen ml-screen">
      {/* ── Header ── */}
      <div className="ml-header">
        <button
          className="ml-back-btn"
          type="button"
          onClick={onClose}
          aria-label="Back"
        >
          <Icon name="arrow-left" size={20} />
        </button>
        <h2 className="ml-title">Materials</h2>
        <button
          className="ml-add-header-btn"
          type="button"
          onClick={onAdd}
          aria-label="Add material"
        >
          <Icon name="add" size={20} />
        </button>
      </div>

      {/* ── Search bar ── */}
      <div className="ml-search-wrap">
        <Icon name="search" size={16} className="ml-search-icon" />
        <input
          type="text"
          className="ml-search-input"
          placeholder="Search materials or code"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {query && (
          <button
            type="button"
            className="ml-search-clear"
            onClick={() => setQuery('')}
            aria-label="Clear search"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {/* ── Default markup hint ── */}
      {!query && materials.length > 0 && (
        <p className="ml-markup-hint">
          Standard markup: <strong>{defaultMarkup}%</strong> — change in Settings
        </p>
      )}

      {/* ── Empty state ── */}
      {materials.length === 0 && (
        <div className="ml-empty">
          <p className="ml-empty-title">Your price list, built as you go</p>
          <p className="ml-empty-body">
            Every line you save here drops onto your next quote in one tap — at your price.
          </p>
          <button className="btn-primary ml-empty-cta" onClick={onAdd}>
            Add an item
          </button>
        </div>
      )}

      {/* ── No search results ── */}
      {materials.length > 0 && sorted.length === 0 && (
        <p className="ml-no-results">No saved materials match.</p>
      )}

      {/* ── Library list ── */}
      {sorted.length > 0 && (
        <ul className="ml-list">
          {sorted.map(m => {
            const isRevealed = swipedId === m.id;
            return (
              <li
                key={m.id}
                className={`ml-row${isRevealed ? ' ml-row--revealed' : ''}`}
              >
                {/* Main row content */}
                <button
                  type="button"
                  className="ml-row-content"
                  onClick={() => onEdit?.(m)}
                  aria-label={`Edit ${m.desc}`}
                >
                  <div className="ml-row-main">
                    <span className="ml-row-desc">{m.desc}</span>
                    {(m.unit || m.supplier_code) && (
                      <span className="ml-row-meta">
                        {[m.unit, m.supplier_code].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <div className="ml-row-prices">
                    <span className="ml-row-buy">buy £{Number(m.cost).toFixed(2)}</span>
                    {m.use_count > 0 && (
                      <span className="ml-row-uses">{m.use_count}×</span>
                    )}
                  </div>
                </button>

                {/* Swipe-reveal archive action */}
                <button
                  type="button"
                  className="ml-row-archive-btn"
                  onClick={() => handleArchive(m.id)}
                  aria-label={`Archive ${m.desc}`}
                >
                  Archive
                </button>

                {/* Swipe affordance toggle (long press / explicit tap on mobile) */}
                <button
                  type="button"
                  className="ml-row-swipe-toggle"
                  onClick={() => setSwipedId(isRevealed ? null : m.id)}
                  aria-label={isRevealed ? 'Cancel' : 'More options'}
                >
                  <Icon name={isRevealed ? 'close' : 'more'} size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Add item CTA (when library has items) ── */}
      {materials.length > 0 && (
        <div className="ml-footer">
          <button className="btn-secondary ml-footer-add" onClick={onAdd}>
            <Icon name="add" size={16} /> Add an item
          </button>
        </div>
      )}
    </div>
  );
}
