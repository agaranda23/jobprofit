import React, { useState, useRef, useEffect } from 'react';
import { marginState } from '../lib/profitThresholds';
import { gbp } from '../lib/today';
import { getOverheadTotal } from '../lib/cashflow';

/**
 * ProfitBreakdownSheet — half-sheet modal for the profit breakdown.
 *
 * Design A Step 2 (PRD 2026-05-30):
 *   - Half-sheet (60% screen height), draggable to full
 *   - Two entry points: ribbon tap, viewProfitBreakdown from hero card
 *   - Hero line: £{profit} profit on £{quote} ({margin}% margin)
 *   - Quote breakdown: line items grouped by category (labour / materials / sundries)
 *   - Job costs section: receipts by category (Materials, Fuel, Subbie, Other)
 *     - Tappable category row expands to per-receipt list inline
 *   - Monthly bills estimate: shown only when bills are configured, greyed, by-count
 *   - Close: top-right X, tap outside, drag down, Escape
 *
 * Props:
 *   open         – boolean
 *   onClose      – function
 *   job          – full job object
 *   receipts     – flat receipts array from AppShell
 *   overheads    – profile.overheads array (optional — hides the estimate when absent)
 *   jobCountThisMonth – number of paid jobs this month (optional — used for by-count allocation)
 *   onGoToSettings – optional fn to navigate to settings (for the "Add monthly bills" link)
 */

// ── Receipt category heuristic ─────────────────────────────────────────────
// Trades think in these four buckets. We map receipt labels heuristically.
const RECEIPT_CATEGORIES = [
  {
    id: 'materials',
    label: 'Materials',
    match: (r) => {
      const l = (r.label || r.category || '').toLowerCase();
      return (
        l.includes('material') ||
        l.includes('wickes') ||
        l.includes('screwfix') ||
        l.includes('travis') ||
        l.includes('jewson') ||
        l.includes('toolstation') ||
        l.includes('selco') ||
        l.includes('parts') ||
        l.includes('pipe') ||
        l.includes('tile') ||
        l.includes('timber') ||
        l.includes('cable') ||
        l.includes('cement')
      );
    },
  },
  {
    id: 'fuel',
    label: 'Fuel',
    match: (r) => {
      const l = (r.label || r.category || '').toLowerCase();
      return l.includes('fuel') || l.includes('petrol') || l.includes('diesel') || l.includes('bp') || l.includes('shell');
    },
  },
  {
    id: 'subbie',
    label: 'Subcontractor',
    match: (r) => {
      const l = (r.label || r.category || '').toLowerCase();
      return l.includes('subbie') || l.includes('sub-contract') || l.includes('subcontract') || l.includes('labour-only') || l.includes('labor');
    },
  },
];

function categoriseReceipt(r) {
  for (const cat of RECEIPT_CATEGORIES) {
    if (cat.match(r)) return cat.id;
  }
  return 'other';
}

// ── Line item categorisation (quote breakdown) ────────────────────────────
function categoriseLineItem(item) {
  const d = (item.desc || '').toLowerCase();
  if (d.includes('labour') || d.includes('labor') || d.includes('call out') || d.includes('callout') || d.includes('fitting')) return 'Labour';
  if (d.includes('material') || d.includes('parts') || d.includes('supply') || d.includes('pipe') || d.includes('tile') || d.includes('timber')) return 'Materials';
  return 'Other';
}

function groupLineItems(lineItems) {
  const groups = {};
  for (const item of lineItems) {
    const cat = categoriseLineItem(item);
    if (!groups[cat]) groups[cat] = { label: cat, items: [], subtotal: 0 };
    const cost = Number(item.cost || 0);
    groups[cat].items.push(item);
    groups[cat].subtotal += cost;
  }
  return Object.values(groups);
}

function groupReceipts(receipts) {
  const groups = {
    materials:   { id: 'materials',  label: 'Materials',       items: [], subtotal: 0 },
    fuel:        { id: 'fuel',       label: 'Fuel',            items: [], subtotal: 0 },
    subbie:      { id: 'subbie',     label: 'Subcontractor',   items: [], subtotal: 0 },
    other:       { id: 'other',      label: 'Other',           items: [], subtotal: 0 },
  };
  for (const r of receipts) {
    const cat = categoriseReceipt(r);
    const amt = Number(r.amount || 0);
    groups[cat].items.push(r);
    groups[cat].subtotal += amt;
  }
  return Object.values(groups).filter(g => g.items.length > 0);
}

// ── Drag-to-dismiss ──────────────────────────────────────────────────────
function useDrag(onClose) {
  const sheetRef = useRef(null);
  const startY = useRef(null);
  const startH = useRef(null);

  const onPointerDown = (e) => {
    startY.current = e.clientY || e.touches?.[0]?.clientY;
    startH.current = sheetRef.current?.getBoundingClientRect().height;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    if (startY.current == null) return;
    const y = e.clientY;
    const delta = y - startY.current;
    if (delta > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${delta}px)`;
    }
  };

  const onPointerUp = (e) => {
    const delta = (e.clientY || 0) - (startY.current || 0);
    if (sheetRef.current) sheetRef.current.style.transform = '';
    if (delta > 80) onClose();
    startY.current = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  };

  return { sheetRef, onPointerDown };
}

export default function ProfitBreakdownSheet({ open, onClose, job, receipts = [], overheads, jobCountThisMonth, onGoToSettings }) {
  const [expandedCats, setExpandedCats] = useState(new Set());
  const { sheetRef, onPointerDown } = useDrag(onClose);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset expanded categories when sheet closes
  useEffect(() => {
    if (!open) setExpandedCats(new Set());
  }, [open]);

  if (!open) return null;

  const quote = Number(job.total ?? job.amount ?? 0);
  const jobReceipts = receipts.filter(r => {
    if (!r.jobId) return false;
    return String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId);
  });
  const costs = jobReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
  const profit = quote - costs;
  const margin = quote > 0 ? Math.round((profit / quote) * 100) : 0;
  const state = marginState(margin);

  const lineItems = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];
  const quoteGroups = groupLineItems(lineItems);
  const costGroups = groupReceipts(jobReceipts);

  const toggleCat = (id) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const heroClass = `jd-pbs-hero jd-pbs-hero--${state}`;

  return (
    <>
      {/* Backdrop — tap to close */}
      <div
        className="jd-pbs-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Half-sheet panel */}
      <div
        ref={sheetRef}
        className="jd-pbs-sheet"
        role="dialog"
        aria-label="Profit breakdown"
        aria-modal="true"
      >
        {/* Drag handle */}
        <div
          className="jd-pbs-handle-area"
          onPointerDown={onPointerDown}
          aria-hidden="true"
        >
          <div className="jd-pbs-handle" />
        </div>

        {/* Header */}
        <div className="jd-pbs-header">
          <span className="jd-pbs-title">Profit breakdown</span>
          <button
            type="button"
            className="jd-pbs-close"
            onClick={onClose}
            aria-label="Close profit breakdown"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="jd-pbs-body">
          {/* Hero line */}
          <div className={heroClass}>
            <div className="jd-pbs-hero-profit">{gbp(profit)} profit</div>
            <div className="jd-pbs-hero-sub">
              on {gbp(quote)} quoted · {margin}% margin
            </div>
          </div>

          {/* Quote breakdown */}
          {quoteGroups.length > 0 && (
            <div className="jd-pbs-section">
              <div className="jd-pbs-section-header">Quote breakdown</div>
              {quoteGroups.map(g => (
                <div key={g.label} className="jd-pbs-group">
                  <div className="jd-pbs-group-row">
                    <span className="jd-pbs-group-label">{g.label}</span>
                    <span className="jd-pbs-group-total">{gbp(g.subtotal)}</span>
                  </div>
                  {g.items.map((item, i) => (
                    <div key={i} className="jd-pbs-item-row">
                      <span className="jd-pbs-item-desc">{item.desc || '—'}</span>
                      <span className="jd-pbs-item-cost">{gbp(Number(item.cost || 0))}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Job costs */}
          {costGroups.length > 0 ? (
            <div className="jd-pbs-section">
              <div className="jd-pbs-section-header">Job costs</div>
              {costGroups.map(g => (
                <div key={g.id} className="jd-pbs-group">
                  <button
                    type="button"
                    className="jd-pbs-cat-row"
                    onClick={() => toggleCat(g.id)}
                    aria-expanded={expandedCats.has(g.id)}
                  >
                    <span className="jd-pbs-group-label">{g.label}</span>
                    <span className="jd-pbs-cat-count">{g.items.length} receipt{g.items.length !== 1 ? 's' : ''}</span>
                    <span className="jd-pbs-group-total">{gbp(g.subtotal)}</span>
                    <span className="jd-pbs-cat-chev" aria-hidden="true">
                      {expandedCats.has(g.id) ? '▴' : '›'}
                    </span>
                  </button>
                  {expandedCats.has(g.id) && g.items.map((r, i) => (
                    <div key={r.id || i} className="jd-pbs-item-row">
                      <span className="jd-pbs-item-desc">{r.label || 'Receipt'}</span>
                      <span className="jd-pbs-item-cost">{gbp(Number(r.amount || 0))}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="jd-pbs-section">
              <div className="jd-pbs-section-header">Job costs</div>
              <div className="jd-pbs-empty">No costs logged yet.</div>
            </div>
          )}

          {/* Monthly bills estimate — only shown when bills are configured.
              By-count allocation: totalMonthlyBills / jobCountThisMonth.
              Never shows £0 — hides entirely when no bills set. */}
          {(() => {
            const totalBills = getOverheadTotal(overheads);
            if (!totalBills || totalBills <= 0) {
              // No bills configured — show a faint link only
              return onGoToSettings ? (
                <div className="jd-pbs-bills-nudge">
                  <button
                    type="button"
                    className="jd-pbs-bills-nudge-link"
                    onClick={onGoToSettings}
                  >
                    Add monthly bills in Settings
                  </button>
                </div>
              ) : null;
            }
            const jobCount = jobCountThisMonth && jobCountThisMonth > 0 ? jobCountThisMonth : 1;
            const perJobBills = totalBills / jobCount;
            return (
              <div className="jd-pbs-bills-estimate">
                <span className="jd-pbs-bills-estimate-label">
                  Your monthly bills add ~{gbp(perJobBills)}/job this month
                </span>
                <span className="jd-pbs-bills-estimate-tag">(estimate)</span>
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}
