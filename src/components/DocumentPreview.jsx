/**
 * DocumentPreview — tappable document facsimile for ReviewSheet
 * ("Preview & Edit — full-tap slice", built on slice 1).
 *
 * Reads like the real customer-facing quote/invoice: header (logo + business
 * identity), doc-type title + meta, recipient block, line items, totals
 * (VAT-aware, deposit-aware), and the locked "Sent with OHNAR" footer with its
 * Pro upsell. The hint says "Tap anything to change it" — every field below is
 * now wired to a small overlay editor that layers OVER this preview (the sheet
 * never unmounts, never closes) and saves live:
 *
 *   - Logo / business name & contact  → LogoModal / EditFieldModal, persist to
 *     the PROFILE (unchanged from slice 1 — every future document picks it up).
 *   - Customer / phone / address      → EditFieldModal (composite), persists to
 *     the JOB via onJobPatch. Never falls back to the job title — see
 *     `distinctCustomer` below, which mirrors JobDetailDrawer.jsx's own
 *     duplicate-guard for the exact same data-model quirk (Quick Add seeds
 *     job.customer from the job title when no separate customer was captured).
 *   - Line items (add / edit / delete) → QuoteLineEditorSheet, persists
 *     lineItems + total (+ amount, kept in lockstep per the app's
 *     total===sum(lineItems) invariant) via onJobPatch. A single-line job's
 *     "Total payable" row is also tappable — it opens the same one-line editor.
 *   - Invoice number / due date       → EditFieldModal (single field), persist
 *     via onInvoiceNumberChange/onDueDateChange (ReviewSheet-level state — see
 *     that file for why these aren't threaded through onJobPatch).
 *   - Quote "Valid until"             → EditFieldModal (date), persists
 *     job.quoteValidUntil (per-JOB override, JSONB meta field — see jobMeta.js)
 *     via onJobPatch. fix/quote-public-vat-validity: this used to write
 *     profile.quote_validity_days, which silently changed the validity window
 *     on EVERY future quote — a founder-flagged surprise side effect. Now only
 *     THIS quote's date changes; invoicePDF.js and PublicQuoteView.jsx both
 *     prefer job.quoteValidUntil and fall back to the profile default. Read-only
 *     (no tap) when onJobPatch is absent, matching the recipient/line-item gate.
 *
 * P0 fix (founder live-test, 2026-07): tapping ANY region inside this card —
 * including a region that isn't wired to anything — must never dismiss the
 * sheet or fall through to whatever is behind it. The root wrapper below stops
 * click propagation so only the sheet's own X / true backdrop can dismiss.
 *
 * Footer visibility is derived ONLY from showJobProfitFooter(profile) (i.e.
 * isPro()) — the same source of truth invoicePDF.js and the public doc pages
 * use. Fail-safe default: a missing/undefined profile resolves to "not Pro",
 * so the footer is SHOWN (never silently hidden). There is no per-document
 * override and no code path for a free user to remove it — the sole
 * affordance is the upsell tap → ProUpgradeSheet.
 *
 * VAT is VAT-INCLUSIVE (locked ACC decision, 2026-06-21) — this preview reuses
 * splitVatInclusive() from lib/vatUtils.js, the exact helper invoicePDF.js
 * uses, so the on-screen number never drifts from the sent PDF.
 *
 * Props:
 *   mode                 'quote' | 'invoice'
 *   job                  full job object — the CALLER's freshest copy (ReviewSheet
 *                        passes its own localJob mirror so an edit made here is
 *                        reflected immediately in what gets sent).
 *   biz                  legacy biz settings object (as already threaded through ReviewSheet)
 *   profile              Supabase profiles row — pass the SHEET's localProfile so a
 *                        brand edit made mid-session is reflected immediately, both
 *                        in this header and in the PDF/message the sheet is about to send.
 *   depositPercent        current deposit picker value (quote mode only)
 *   invoiceNumber         invoice mode meta
 *   dueDate               invoice mode meta ('YYYY-MM-DD')
 *   onJobPatch            (patch) => void — persist a job-content edit (line items,
 *                        total/amount, customer, customerPhone, address). Optional —
 *                        omitting it renders line items / the recipient block read-only
 *                        (mirrors the slice-1 "onEdit optional" convention).
 *   onInvoiceNumberChange (value) => void — invoice mode only.
 *   onDueDateChange       (value) => void — invoice mode only ('YYYY-MM-DD').
 *   onProfileUpdate       optional async (patch) => void — the app's central profile-update
 *                        pipeline (e.g. AppShell.handleProfileUpdate). When omitted, falls
 *                        back to a direct Supabase write — mirrors BankGateSheet.jsx.
 *   onProfileSaved        (patch) => void — called after ANY successful save (central
 *                        pipeline or fallback) so the caller can refresh its own
 *                        optimistic profile copy (ReviewSheet's localProfile bridge).
 *   flash                 (msg) => void — toast callback
 */
import { useState } from 'react';
import Icon from './Icon';
import EditFieldModal from './EditFieldModal';
import LogoModal from './LogoModal';
import QuoteLineEditorSheet from './QuoteLineEditorSheet';
import PoweredByJobProfit from './PoweredByJobProfit';
import ProUpgradeSheet from './ProUpgradeSheet';
import { resolveBusinessIdentity } from '../lib/resolveBusinessIdentity';
import { secureImageUrl } from '../lib/secureImageUrl';
import { splitVatInclusive } from '../lib/vatUtils';
import { showJobProfitFooter } from '../lib/plan';
import { UPGRADE_TRIGGERS } from '../lib/telemetry';
import { supabase } from '../lib/supabase';

// ── helpers ──────────────────────────────────────────────────────────────────

function gbp(n) {
  return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function validateNonEmpty(v) {
  return v.trim() ? null : 'This field is required';
}

function validateDateField(v) {
  if (!v || !v.trim()) return 'This field is required';
  return isNaN(new Date(`${v}T00:00:00`).getTime()) ? 'Enter a valid date' : null;
}

// Normalises line items the same way invoicePDF.js / the old PreviewTable do:
// a single "Work" row when the job has no structured line items yet. Kept in
// lockstep with the raw-selection condition below (rawLineItems) so UI index
// `key` always addresses the same underlying array element.
function normaliseLineItems(job) {
  const raw = Array.isArray(job?.lineItems) && job.lineItems.length > 0
    ? job.lineItems
    : [{ desc: job?.summary || 'Work', cost: job?.total ?? job?.amount ?? 0 }];
  return raw.map((li, i) => {
    const qty  = Number(li.qty ?? li.quantity ?? 1);
    const cost = Number(li.cost ?? 0);
    const rate = li.rate != null ? Number(li.rate) : (qty !== 1 ? cost / qty : null);
    return { key: i, desc: li.desc || '—', qty, cost, rate, showRate: qty > 1 || li.rate != null };
  });
}

export default function DocumentPreview({
  mode,
  job,
  biz,
  profile,
  depositPercent = 0,
  invoiceNumber,
  dueDate,
  onJobPatch,
  onInvoiceNumberChange,
  onDueDateChange,
  onProfileUpdate,
  onProfileSaved,
  flash,
}) {
  const isInvoice = mode === 'invoice';
  const identity = resolveBusinessIdentity(biz, profile);
  const logo = identity.logoUrl || identity.logo_url;
  const contactLine = [identity.phone, identity.email].filter(Boolean).join('  ·  ');

  // editingField: null | 'logo' | 'identity' | 'customer' | 'invoiceNumber' | 'dueDate' | 'validUntil'
  const [editingField, setEditingField] = useState(null);
  const [showUpgradeSheet, setShowUpgradeSheet] = useState(false);
  // lineSheetIdx: null = closed, -1 = add new, 0+ = editing that line index
  const [lineSheetIdx, setLineSheetIdx] = useState(null);

  // Persists a brand-edit patch to the profile — central pipeline first, direct
  // Supabase write as a fallback. Mirrors BankGateSheet.jsx's established pattern
  // so every entry point (Settings, bank-gate, this preview) behaves identically
  // regardless of whether the parent screen has wired onProfileUpdate yet.
  const handleBrandSave = async (patch) => {
    if (onProfileUpdate) {
      await onProfileUpdate(patch);
    } else {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('Not signed in');
      const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id);
      if (error) throw error;
    }
    onProfileSaved?.(patch);
    flash?.('Saved — it\'ll show on every document.');
  };

  const lineItems = normaliseLineItems(job);
  const total = Number(job?.total ?? job?.amount ?? 0);

  // Raw (un-normalised) line items — same "has real items" condition
  // normaliseLineItems uses, so `rawLineItems[idx]` and `lineItems[idx]`
  // always address the same element.
  const hasRealItems = Array.isArray(job?.lineItems) && job.lineItems.length > 0;
  const rawLineItems = hasRealItems ? job.lineItems : [];

  // canEditJob — computed early so metaRows (below) can gate the "Valid until"
  // tap affordance on it, same as the recipient block / line items.
  const canEditJob = !!onJobPatch;

  // ── Totals — VAT-inclusive (locked decision); reuses the shared
  // splitVatInclusive() helper so the preview matches invoicePDF.js /
  // generateQuotePDF to the penny — never re-derive the VAT formula here. ────
  const showVat = !!identity.vatRegistered;
  const { net, vat } = showVat ? splitVatInclusive(total) : { net: total, vat: 0 };

  // Deposit — quote mode only. Mirrors sendQuote.js's send-time clamp exactly
  // (lockedDepositPence = Math.min(pct × total, total), see sendQuote.js) so
  // the number shown here always equals the number actually sent. Because the
  // deposit is always a PERCENT of `total`, this clamp holds automatically —
  // no separate re-clamp is needed when a line-item edit changes the total.
  const depositPence = !isInvoice && depositPercent > 0 && total > 0
    ? Math.min(Math.round(total * (depositPercent / 100) * 100), Math.round(total * 100))
    : 0;
  const depositAmount = depositPence / 100;

  // ── Doc-type meta — invoice no / due date / valid-until are tappable ─────
  const issueDate = job?.date
    ? new Date(job.date.length === 10 ? `${job.date}T00:00:00` : job.date)
    : new Date();
  const validityDays = Number(profile?.quote_validity_days ?? 30);
  // Per-quote override (job.quoteValidUntil) wins over the profile default —
  // see the class-level doc comment above for why this must stay per-job.
  const defaultValidUntil = new Date(issueDate);
  defaultValidUntil.setDate(defaultValidUntil.getDate() + validityDays);
  const validUntil = job?.quoteValidUntil
    ? new Date(`${job.quoteValidUntil}T00:00:00`)
    : defaultValidUntil;
  const validUntilIso = job?.quoteValidUntil || defaultValidUntil.toISOString().slice(0, 10);

  let metaRows;
  if (isInvoice) {
    const issued = new Date().toLocaleDateString('en-GB');
    const due = dueDate ? new Date(dueDate).toLocaleDateString('en-GB') : '';
    metaRows = [
      // Gated on the SPECIFIC persist handler each row writes through (not
      // canEditJob/onJobPatch — these two persist via onInvoiceNumberChange/
      // onDueDateChange, a separate ReviewSheet-level state channel). Without
      // this gate a read-only caller (DocumentsHub) would still open the
      // editor and flash a false "Invoice number updated"/"Due date updated"
      // confirmation while saving nothing — mirrors the "Valid until" gate below.
      { key: 'invoiceNumber', label: 'Invoice no', value: invoiceNumber || '+ Add', onClick: onInvoiceNumberChange ? () => setEditingField('invoiceNumber') : undefined },
      { key: 'issued', label: 'Issued', value: issued },
      { key: 'due', label: 'Due', value: due || '+ Add', onClick: onDueDateChange ? () => setEditingField('dueDate') : undefined },
    ];
  } else {
    const quoteNumber = job?.quoteNumber || (job?.id ? `Q-${String(job.id).slice(-4).toUpperCase()}` : '');
    metaRows = [
      quoteNumber ? { key: 'ref', label: 'Ref', value: quoteNumber } : null,
      { key: 'date', label: 'Date', value: issueDate.toLocaleDateString('en-GB') },
      {
        key: 'validUntil',
        label: 'Valid until',
        value: validUntil.toLocaleDateString('en-GB'),
        onClick: canEditJob ? () => setEditingField('validUntil') : undefined,
      },
    ].filter(Boolean);
  }

  // ── Recipient block ──────────────────────────────────────────────────────
  // distinctCustomer mirrors JobDetailDrawer.jsx's own guard: job.customer
  // defaults to the job title in the Quick Add path (store.js addTodayJob), so
  // "customer === title" reads as "no customer set" rather than duplicating
  // the job title in both the bill-to block AND the line item. NEVER falls
  // back to job.name (the legacy job-title alias) per the founder's fix brief.
  const jobTitle = (job?.summary || '').trim();
  const rawCustomer = (job?.customer || '').trim();
  const customerName = rawCustomer && rawCustomer !== jobTitle ? rawCustomer : '';
  const customerPhone   = job?.customerPhone || job?.phone || '';
  const customerAddress = job?.address || '';

  // ── Line-item handlers — total always recomputed from lineItems (invariant
  // per JobDetailDrawer's Option A price-reconciliation PRD, 2026-06-13) ────
  const handleSaveLine = ({ desc, cost }) => {
    const idx = lineSheetIdx;
    let next;
    if (idx === -1) {
      next = [...rawLineItems, { desc, cost: Number(cost) }];
    } else if (hasRealItems) {
      next = rawLineItems.map((item, i) => i === idx ? { ...item, desc, cost: Number(cost) } : item);
    } else {
      // Editing the single synthetic placeholder row — seed the first real line.
      next = [{ desc, cost: Number(cost) }];
    }
    const newTotal = next.reduce((s, i) => s + Number(i.cost || 0), 0);
    onJobPatch?.({ lineItems: next, total: newTotal, amount: newTotal });
    flash?.(idx === -1 ? 'Line added' : 'Line updated');
    setLineSheetIdx(null);
  };

  const handleDeleteLine = () => {
    const idx = lineSheetIdx;
    const next = rawLineItems.filter((_, i) => i !== idx);
    const newTotal = next.reduce((s, i) => s + Number(i.cost || 0), 0);
    onJobPatch?.({ lineItems: next, total: newTotal, amount: newTotal });
    flash?.('Line removed');
    setLineSheetIdx(null);
  };

  const editingLineItem = lineSheetIdx != null && lineSheetIdx >= 0
    ? (hasRealItems ? rawLineItems[lineSheetIdx] : { desc: lineItems[0]?.desc, cost: lineItems[0]?.cost })
    : null;

  // ── Invoice number / due date — persisted via ReviewSheet-level state ────
  const handleInvoiceNumberSave = (patch) => {
    onInvoiceNumberChange?.(patch.invoiceNumber);
    flash?.('Invoice number updated');
  };
  const handleDueDateSave = (patch) => {
    onDueDateChange?.(patch.dueDate);
    flash?.('Due date updated');
  };

  // ── Quote "Valid until" — persists job.quoteValidUntil via onJobPatch
  // (per-JOB override, JSONB meta field — see jobMeta.js). fix/quote-public-
  // vat-validity: previously converted the picked date into
  // profile.quote_validity_days, which silently changed the validity window
  // on EVERY future quote — a founder-flagged surprise side effect. This is
  // the same persistence path as line-item/customer edits, so only THIS
  // quote's date changes; the trader's default window is untouched.
  const handleValidUntilSave = (patch) => {
    onJobPatch?.({ quoteValidUntil: patch.validUntil });
    flash?.('Valid until date updated');
  };

  return (
    <div className="dp-root" onClick={e => e.stopPropagation()}>
      {/* dp-paper — the actual document facsimile. Forced-light "real paper"
          card (see the CSS): white regardless of the app's dark/light theme,
          because a printed quote/invoice is always white paper. Every editor
          overlay below (LogoModal/EditFieldModal/QuoteLineEditorSheet/
          ProUpgradeSheet) renders OUTSIDE this div, on purpose — they must
          keep inheriting the app's REAL theme tokens, not this card's
          forced-light override (CSS custom properties inherit down the DOM
          tree regardless of position:fixed, so nesting them inside dp-paper
          would have silently forced them light too). */}
      <div className="dp-paper">
        {/* ── Letterhead — logo + business identity, then doc type + ref/date,
            grouped as ONE professional document header band (mirrors the
            actual PDF's layout in invoicePDF.js: brand row, then doc-title
            row, stacked — not a form full of separate boxes). ───────────── */}
        <div className="dp-letterhead">
          <div className="dp-header">
            <button
              type="button"
              className="dp-logo-tap"
              onClick={() => setEditingField('logo')}
              aria-label="Edit logo"
            >
              {logo ? (
                <img src={secureImageUrl(logo)} alt="" className="dp-logo-img" />
              ) : (
                <span className="dp-logo-placeholder">Add your logo</span>
              )}
              <Icon name="edit" size={12} className="dp-logo-pencil" />
            </button>

            <button
              type="button"
              className="dp-identity-tap"
              onClick={() => setEditingField('identity')}
              aria-label="Edit business details"
            >
              <div className="dp-business-name">
                {identity.name || <span className="dp-placeholder-text">Add your business name</span>}
              </div>
              {contactLine && <div className="dp-contact-line">{contactLine}</div>}
            </button>
          </div>

          {/* Doc-type title + meta — invoice no / due date / valid-until tap */}
          <div className="dp-doctitle">
            <div className="dp-doctitle-label">{isInvoice ? 'INVOICE' : 'QUOTE'}</div>
            <div className="dp-doctitle-meta">
              {metaRows.map(row => row.onClick ? (
                <button
                  key={row.key}
                  type="button"
                  className="dp-doctitle-meta-tap"
                  onClick={row.onClick}
                  // "Change" (not "Edit") — avoids an aria-label substring collision
                  // with the "Edit invoice"/"Edit quote" ghost button in ReviewSheet
                  // (e.g. "Edit Invoice no" would otherwise match /edit invoice/i).
                  aria-label={`Change ${row.label}`}
                >
                  {row.label}: {row.value}
                </button>
              ) : (
                <span key={row.key}>{row.label}: {row.value}</span>
              ))}
            </div>
          </div>
        </div>

        {/* State-aware — "Tap anything to change it" is only true when the
            caller wired onJobPatch (canEditJob). Read-only callers (e.g.
            DocumentsHub's view-first preview) omit it: most fields ARE NOT
            tappable there, so the full hint would be a false promise. */}
        <p className="dp-hint">
          {canEditJob
            ? 'This is what your customer sees. Tap anything to change it.'
            : 'This is what your customer sees.'}
        </p>

        {/* ── Recipient block — whole block tappable; never falls back to the
            job title (see distinctCustomer above) ──────────────────────────── */}
        {canEditJob ? (
          <button
            type="button"
            className="dp-recipient dp-recipient--tap"
            onClick={() => setEditingField('customer')}
            aria-label={customerName ? 'Edit customer' : 'Add customer'}
          >
            <div className="dp-recipient-label">{isInvoice ? 'Bill to' : 'Prepared for'}</div>
            <div className="dp-recipient-name">
              {customerName || <span className="dp-placeholder-text">+ Add customer</span>}
            </div>
            {customerPhone && <div className="dp-recipient-line">{customerPhone}</div>}
            {customerAddress && <div className="dp-recipient-line">{customerAddress}</div>}
          </button>
        ) : (
          <div className="dp-recipient">
            <div className="dp-recipient-label">{isInvoice ? 'Bill to' : 'Prepared for'}</div>
            <div className="dp-recipient-name">
              {customerName || <span className="dp-placeholder-text">No customer added</span>}
            </div>
            {customerPhone && <div className="dp-recipient-line">{customerPhone}</div>}
            {customerAddress && <div className="dp-recipient-line">{customerAddress}</div>}
          </div>
        )}

        {/* ── Line items — tap a row to edit; "+ Add line" always available ── */}
        <div className="dp-lineitems" role="list" aria-label="Line items">
          {lineItems.map(li => {
            const Row = canEditJob ? 'button' : 'div';
            return (
              <Row
                key={li.key}
                {...(canEditJob ? { type: 'button' } : {})}
                className="dp-lineitem-row"
                onClick={canEditJob ? () => setLineSheetIdx(li.key) : undefined}
                aria-label={canEditJob ? `Edit ${li.desc}` : undefined}
              >
                <span className="dp-li-desc">{li.desc}</span>
                {li.showRate && li.rate != null && (
                  <span className="dp-li-qty">{li.qty} × {gbp(li.rate)}</span>
                )}
                <span className="dp-li-amount">{gbp(li.cost)}</span>
              </Row>
            );
          })}
          {canEditJob && (
            <button
              type="button"
              className="dp-lineitem-add"
              onClick={() => setLineSheetIdx(-1)}
              aria-label="Add a line item"
            >
              <Icon name="add" size={14} /> Add line
            </button>
          )}
        </div>

        {/* ── Totals ────────────────────────────────────────────────────────── */}
        <div className="dp-totals">
          {showVat && (
            <div className="dp-totals-row">
              <span>Subtotal</span><span>{gbp(net)}</span>
            </div>
          )}
          {showVat && (
            <div className="dp-totals-row">
              <span>VAT (20%)</span><span>{gbp(vat)}</span>
            </div>
          )}
          {depositAmount > 0 && (
            <div className="dp-totals-row dp-totals-row--deposit">
              <span>Deposit due now ({depositPercent}%)</span><span>{gbp(depositAmount)}</span>
            </div>
          )}
          {canEditJob && lineItems.length === 1 ? (
            <button
              type="button"
              className="dp-totals-row dp-totals-row--total dp-totals-row--tap"
              onClick={() => setLineSheetIdx(0)}
              aria-label="Edit total"
            >
              <span>Total payable</span><span>{gbp(total)}</span>
            </button>
          ) : (
            <div className="dp-totals-row dp-totals-row--total">
              <span>Total payable</span><span>{gbp(total)}</span>
            </div>
          )}
        </div>

        {/* ── Locked footer + Pro upsell ─────────────────────────────────────
            Single source of truth: showJobProfitFooter(profile) === !isPro(profile).
            No second inline check, no per-document flag. Fail-safe default: a
            missing/undefined profile resolves to "not Pro" (see plan.js isPro),
            so the footer defaults to SHOWN — it never silently disappears. ── */}
        {showJobProfitFooter(profile) && (
          <div className="dp-footer-locked">
            <PoweredByJobProfit source={isInvoice ? 'invoice' : 'quote'} />
            <div className="dp-footer-lockrow">
              <Icon name="lock" size={12} variant="muted" />
              <span className="dp-footer-lock-copy">
                Your logo, not ours. Remove the OHNAR footer with Pro.
              </span>
              <button
                type="button"
                className="dp-footer-remove-chip"
                onClick={() => setShowUpgradeSheet(true)}
              >
                Remove →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Brand editors — reuse the exact Settings editors, no rebuild.
          Rendered OUTSIDE dp-paper — see the note above the opening tag. ──── */}
      {editingField === 'logo' && (
        <LogoModal
          currentUrl={logo || ''}
          userId={profile?.id}
          onSave={async (patch) => {
            await handleBrandSave(patch);
            setEditingField(null);
          }}
          onClose={() => setEditingField(null)}
        />
      )}

      <EditFieldModal
        open={editingField === 'identity'}
        title="Business details"
        fields={[
          { key: 'business_name', label: 'Business name', value: identity.name || '', validate: validateNonEmpty },
          { key: 'phone', label: 'Phone', value: identity.phone || '', inputType: 'tel' },
          { key: 'email', label: 'Email', value: identity.email || '', inputType: 'email' },
        ]}
        onSave={handleBrandSave}
        onClose={() => setEditingField(null)}
      />

      {/* ── Customer editor — persists to the JOB (not the profile) ─────────── */}
      <EditFieldModal
        open={editingField === 'customer'}
        title="Customer"
        fields={[
          { key: 'customer', label: 'Customer name', value: customerName },
          { key: 'customerPhone', label: 'Phone', value: customerPhone, inputType: 'tel' },
          { key: 'address', label: 'Address', value: customerAddress, inputType: 'textarea', rows: 2 },
        ]}
        onSave={(patch) => {
          onJobPatch?.(patch);
          flash?.('Customer updated');
        }}
        onClose={() => setEditingField(null)}
      />

      {/* ── Invoice number / due date editors ───────────────────────────────── */}
      <EditFieldModal
        open={editingField === 'invoiceNumber'}
        fieldKey="invoiceNumber"
        fieldLabel="Invoice number"
        currentValue={invoiceNumber || ''}
        validate={validateNonEmpty}
        onSave={handleInvoiceNumberSave}
        onClose={() => setEditingField(null)}
      />

      <EditFieldModal
        open={editingField === 'dueDate'}
        fieldKey="dueDate"
        fieldLabel="Due date"
        inputType="date"
        currentValue={dueDate || ''}
        validate={validateDateField}
        onSave={handleDueDateSave}
        onClose={() => setEditingField(null)}
      />

      {/* ── Quote "Valid until" editor ───────────────────────────────────────── */}
      <EditFieldModal
        open={editingField === 'validUntil'}
        fieldKey="validUntil"
        fieldLabel="Valid until"
        inputType="date"
        currentValue={validUntilIso}
        validate={validateDateField}
        onSave={handleValidUntilSave}
        onClose={() => setEditingField(null)}
      />

      {/* ── Line item add/edit/delete sheet ──────────────────────────────────── */}
      <QuoteLineEditorSheet
        open={lineSheetIdx !== null}
        item={editingLineItem}
        onSave={handleSaveLine}
        onDelete={hasRealItems && lineSheetIdx >= 0 ? handleDeleteLine : undefined}
        onCancel={() => setLineSheetIdx(null)}
      />

      {/* ── Pro upsell — opened only by the footer "Remove →" chip ─────────── */}
      <ProUpgradeSheet
        open={showUpgradeSheet}
        trigger={UPGRADE_TRIGGERS.WHITELABEL_FOOTER}
        onClose={() => setShowUpgradeSheet(false)}
      />
    </div>
  );
}
