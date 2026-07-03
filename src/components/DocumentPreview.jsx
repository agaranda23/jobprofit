/**
 * DocumentPreview — tappable document facsimile for ReviewSheet
 * ("Preview & Edit — slice 1").
 *
 * Replaces the old PreviewTable summary card with something that reads like the
 * real customer-facing quote/invoice: header (logo + business identity),
 * doc-type title + meta, recipient block, line items, totals (VAT-aware,
 * deposit-aware), and the locked "Sent with OHNAR" footer with its Pro upsell.
 *
 * Brand regions (logo / business name & contact) are tappable and persist to
 * the PROFILE (not per-document) — every future quote/invoice/receipt picks up
 * the same edit. Reuses the existing LogoModal + EditFieldModal editors —
 * no second logo/field-edit implementation.
 *
 * Line items are read-only here — tapping one routes back through the EXISTING
 * onEdit → handleReviewEdit → maybeReopenReview bridge the "Edit quote/invoice"
 * ghost button in ReviewSheet already uses. No new price editor in this slice
 * (full field-map — editable invoice number/due date, tappable customer,
 * full-screen preview — is a later slice per the founder brief).
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
 *   mode             'quote' | 'invoice'
 *   job              full job object
 *   biz              legacy biz settings object (as already threaded through ReviewSheet)
 *   profile          Supabase profiles row — pass the SHEET's localProfile so a
 *                    brand edit made mid-session is reflected immediately, both
 *                    in this header and in the PDF/message the sheet is about to send.
 *   depositPercent   current deposit picker value (quote mode only)
 *   invoiceNumber    invoice mode meta
 *   dueDate          invoice mode meta
 *   onEdit           () => void — same handler as the "Edit quote/invoice" button;
 *                    tapping a line item calls this instead of opening a new editor.
 *   onProfileUpdate  optional async (patch) => void — the app's central profile-update
 *                    pipeline (e.g. AppShell.handleProfileUpdate). When omitted, falls
 *                    back to a direct Supabase write — mirrors BankGateSheet.jsx.
 *   onProfileSaved   (patch) => void — called after ANY successful save (central
 *                    pipeline or fallback) so the caller can refresh its own
 *                    optimistic profile copy (ReviewSheet's localProfile bridge).
 *   flash            (msg) => void — toast callback
 */
import { useState } from 'react';
import Icon from './Icon';
import EditFieldModal from './EditFieldModal';
import LogoModal from './LogoModal';
import PoweredByJobProfit from './PoweredByJobProfit';
import ProUpgradeSheet from './ProUpgradeSheet';
import { resolveBusinessIdentity } from '../lib/resolveBusinessIdentity';
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

// Normalises line items the same way invoicePDF.js / the old PreviewTable do:
// a single "Work" row when the job has no structured line items yet.
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
  onEdit,
  onProfileUpdate,
  onProfileSaved,
  flash,
}) {
  const isInvoice = mode === 'invoice';
  const identity = resolveBusinessIdentity(biz, profile);
  const logo = identity.logoUrl || identity.logo_url;
  const contactLine = [identity.phone, identity.email].filter(Boolean).join('  ·  ');

  // editingField: null | 'logo' | 'identity'
  const [editingField, setEditingField] = useState(null);
  const [showUpgradeSheet, setShowUpgradeSheet] = useState(false);

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

  // ── Totals — VAT-inclusive (locked decision); reuses the shared
  // splitVatInclusive() helper so the preview matches invoicePDF.js /
  // generateQuotePDF to the penny — never re-derive the VAT formula here. ────
  const showVat = !!identity.vatRegistered;
  const { net, vat } = showVat ? splitVatInclusive(total) : { net: total, vat: 0 };

  // Deposit — quote mode only. Mirrors sendQuote.js's send-time clamp exactly
  // (lockedDepositPence = Math.min(pct × total, total), see sendQuote.js) so
  // the number shown here always equals the number actually sent.
  const depositPence = !isInvoice && depositPercent > 0 && total > 0
    ? Math.min(Math.round(total * (depositPercent / 100) * 100), Math.round(total * 100))
    : 0;
  const depositAmount = depositPence / 100;

  // ── Doc-type meta (read-only in this slice) ──────────────────────────────
  let metaRows;
  if (isInvoice) {
    const issued = new Date().toLocaleDateString('en-GB');
    const due = dueDate ? new Date(dueDate).toLocaleDateString('en-GB') : '';
    metaRows = [
      invoiceNumber ? ['Invoice no', invoiceNumber] : null,
      ['Issued', issued],
      due ? ['Due', due] : null,
    ].filter(Boolean);
  } else {
    const quoteNumber = job?.quoteNumber || (job?.id ? `Q-${String(job.id).slice(-4).toUpperCase()}` : '');
    const validityDays = Number(profile?.quote_validity_days ?? 30);
    const issueDate = job?.date
      ? new Date(job.date.length === 10 ? `${job.date}T00:00:00` : job.date)
      : new Date();
    const validUntil = new Date(issueDate);
    validUntil.setDate(validUntil.getDate() + validityDays);
    metaRows = [
      quoteNumber ? ['Ref', quoteNumber] : null,
      ['Date', issueDate.toLocaleDateString('en-GB')],
      ['Valid until', validUntil.toLocaleDateString('en-GB')],
    ].filter(Boolean);
  }

  const customerName    = job?.customer || job?.customerName || job?.name || '';
  const customerPhone   = job?.customerPhone || job?.phone || '';
  const customerAddress = job?.address || '';

  return (
    <div className="dp-root">
      {/* ── Header band — tappable brand regions ───────────────────────────── */}
      <div className="dp-header">
        <button
          type="button"
          className="dp-logo-tap"
          onClick={() => setEditingField('logo')}
          aria-label="Edit logo"
        >
          {logo ? (
            <img src={logo} alt="" className="dp-logo-img" />
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

      <p className="dp-hint">This is what your customer sees. Tap anything to change it.</p>

      {/* ── Doc-type title + meta (read-only in this slice) ─────────────────── */}
      <div className="dp-doctitle">
        <div className="dp-doctitle-label">{isInvoice ? 'INVOICE' : 'QUOTE'}</div>
        <div className="dp-doctitle-meta">
          {metaRows.map(([label, value]) => (
            <span key={label}>{label}: {value}</span>
          ))}
        </div>
      </div>

      {/* ── Recipient block (read-only in this slice) ───────────────────────── */}
      <div className="dp-recipient">
        <div className="dp-recipient-label">{isInvoice ? 'Bill to' : 'Prepared for'}</div>
        <div className="dp-recipient-name">
          {customerName || <span className="dp-placeholder-text">+ Add customer</span>}
        </div>
        {customerPhone && <div className="dp-recipient-line">{customerPhone}</div>}
        {customerAddress && <div className="dp-recipient-line">{customerAddress}</div>}
      </div>

      {/* ── Line items — tap routes to the EXISTING price editor ───────────── */}
      <div className="dp-lineitems" role="list" aria-label="Line items">
        {lineItems.map(li => {
          const Row = onEdit ? 'button' : 'div';
          return (
            <Row
              key={li.key}
              {...(onEdit ? { type: 'button' } : {})}
              className="dp-lineitem-row"
              onClick={onEdit ? () => onEdit() : undefined}
              aria-label={onEdit ? `Edit ${li.desc}` : undefined}
            >
              <span className="dp-li-desc">{li.desc}</span>
              {li.showRate && li.rate != null && (
                <span className="dp-li-qty">{li.qty} × {gbp(li.rate)}</span>
              )}
              <span className="dp-li-amount">{gbp(li.cost)}</span>
            </Row>
          );
        })}
      </div>

      {/* ── Totals ───────────────────────────────────────────────────────────── */}
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
        <div className="dp-totals-row dp-totals-row--total">
          <span>Total payable</span><span>{gbp(total)}</span>
        </div>
      </div>

      {/* ── Locked footer + Pro upsell ───────────────────────────────────────
          Single source of truth: showJobProfitFooter(profile) === !isPro(profile).
          No second inline check, no per-document flag. Fail-safe default: a
          missing/undefined profile resolves to "not Pro" (see plan.js isPro),
          so the footer defaults to SHOWN — it never silently disappears. ──── */}
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

      {/* ── Brand editors — reuse the exact Settings editors, no rebuild ────── */}
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

      {/* ── Pro upsell — opened only by the footer "Remove →" chip ─────────── */}
      <ProUpgradeSheet
        open={showUpgradeSheet}
        trigger={UPGRADE_TRIGGERS.WHITELABEL_FOOTER}
        onClose={() => setShowUpgradeSheet(false)}
      />
    </div>
  );
}
