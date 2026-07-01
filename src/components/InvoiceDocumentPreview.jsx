/**
 * InvoiceDocumentPreview — in-app document preview for the branded invoice.
 *
 * Renders the same logical sections as the invoicePDF.js output, but as a
 * white-card HTML document inside the Send Invoice modal. The founder asked for
 * "a proper document, not just a WhatsApp text" — this preview gives them
 * confidence the customer will receive something professional before they hit send.
 *
 * Sections (matching the PDF layout):
 *   1. Header: logo + business name, address, phone, email, UTR (if set)
 *   2. Invoice meta: number, issued date, due date
 *   3. Bill To: customer name, phone, address
 *   4. Line-items table: Description / Rate / Qty / Amount
 *   5. Summary: Labour, Materials (when > 0), VAT 20% (when VAT-registered),
 *               CIS Deduction (when CIS job, shown as negative), Total Payable
 *   6. Payment details: bank transfer + Pay-now link (when set)
 *
 * Props:
 *   job          – full job object
 *   biz          – business settings object (legacy camelCase fields)
 *   profile      – Supabase profiles row (snake_case fields), or null
 *   invoiceNumber – string, e.g. "JP-0001"
 *   dueDate      – YYYY-MM-DD string
 *   payNowUrl    – Stripe Pay-now URL when the trader is connected; empty otherwise
 *   receipts     – all receipts array (for materials cost used in CIS calc)
 */

import { resolveCisStatus } from '../lib/cashflow.js';

const GREEN = '#2563eb';
const DARK  = '#141414';
const MID   = '#505050';
const LIGHT = '#969696';

// ── helpers ───────────────────────────────────────────────────────────────────

function gbp(n) {
  return `£${Number(n || 0).toFixed(2)}`;
}

function fmtDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleDateString('en-GB');
  } catch {
    return str;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PreviewHeader({ effectiveBiz }) {
  const logo = effectiveBiz.logoUrl || effectiveBiz.logo_url;
  const contact = [effectiveBiz.phone, effectiveBiz.email].filter(Boolean).join('  •  ');

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
      {/* Logo (left) */}
      <div style={{ width: 56, height: 56, flexShrink: 0 }}>
        {logo
          ? <img src={logo} alt="Logo" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 4 }} />
          : null
        }
      </div>

      {/* Business details (right) */}
      <div style={{ textAlign: 'right', flex: 1, paddingLeft: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: DARK, marginBottom: 2 }}>
          {effectiveBiz.name || 'Your Business'}
        </div>
        {effectiveBiz.address && (
          <div style={{ fontSize: 11, color: MID, marginBottom: 1 }}>{effectiveBiz.address}</div>
        )}
        {contact && (
          <div style={{ fontSize: 11, color: MID, marginBottom: 1 }}>{contact}</div>
        )}
        {effectiveBiz.utr && (
          <div style={{ fontSize: 10, color: LIGHT }}>UTR: {effectiveBiz.utr}</div>
        )}
        {effectiveBiz.vatRegistered && effectiveBiz.vatNumber && (
          <div style={{ fontSize: 10, color: LIGHT }}>VAT Reg: {effectiveBiz.vatNumber}</div>
        )}
      </div>
    </div>
  );
}

function PreviewMeta({ invoiceNumber, dueDate, paymentTermsDays = 14 }) {
  const today = new Date().toLocaleDateString('en-GB');

  // Resolve due date: explicit value wins; otherwise auto-compute from payment terms.
  const resolvedDueDate = (() => {
    if (dueDate) return fmtDate(dueDate);
    const d = new Date();
    d.setDate(d.getDate() + paymentTermsDays);
    return d.toLocaleDateString('en-GB');
  })();

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: GREEN, letterSpacing: '-0.5px', marginBottom: 6 }}>
        INVOICE
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {invoiceNumber && (
          <div style={{ fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: DARK }}>Invoice no:</span>{' '}
            <span style={{ color: MID }}>{invoiceNumber}</span>
          </div>
        )}
        <div style={{ fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: DARK }}>Issued:</span>{' '}
          <span style={{ color: MID }}>{today}</span>
        </div>
        <div style={{ fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: DARK }}>Due:</span>{' '}
          <span style={{ color: MID }}>{resolvedDueDate}</span>
        </div>
      </div>
    </div>
  );
}

function PreviewBillTo({ job }) {
  const phone   = job?.customerPhone || job?.phone;
  const address = job?.address;
  return (
    <div style={{
      background: '#f8f8f8',
      borderRadius: 6,
      padding: '8px 12px',
      marginBottom: 14,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: LIGHT, letterSpacing: '0.06em', marginBottom: 4 }}>
        BILL TO
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: DARK, marginBottom: 2 }}>
        {job?.customer || job?.customerName || 'Customer'}
      </div>
      {phone && <div style={{ fontSize: 11, color: MID, marginBottom: 1 }}>{phone}</div>}
      {address && <div style={{ fontSize: 11, color: MID }}>{address}</div>}
    </div>
  );
}

function PreviewLineItems({ job }) {
  const rawItems = Array.isArray(job?.lineItems) ? job.lineItems : [];
  const hasItems = rawItems.some(li => li.desc || li.cost);

  const rows = hasItems
    ? rawItems.filter(li => li.desc || li.cost).map((li, i) => {
        const qty  = Number(li.qty ?? li.quantity ?? 1);
        const cost = Number(li.cost || 0);
        const rate = li.rate != null ? Number(li.rate) : (qty !== 1 ? cost / qty : null);
        return { key: i, desc: li.desc || '', rate, qty, cost, showRate: qty > 1 || li.rate != null };
      })
    : [{
        key: 0,
        desc: job?.summary || 'Work completed',
        rate: null,
        qty: 1,
        cost: Number(job?.total ?? job?.amount ?? 0),
        showRate: false,
      }];

  const colStyle = { padding: '6px 8px', fontSize: 11 };
  const headerStyle = { ...colStyle, background: GREEN, color: '#fff', fontWeight: 700 };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 11 }}>
      <thead>
        <tr>
          <th style={{ ...headerStyle, textAlign: 'left' }}>Description</th>
          <th style={{ ...headerStyle, textAlign: 'right', width: 52 }}>Rate</th>
          <th style={{ ...headerStyle, textAlign: 'center', width: 32 }}>Qty</th>
          <th style={{ ...headerStyle, textAlign: 'right', width: 56 }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.key} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
            <td style={{ ...colStyle, color: DARK, borderBottom: '1px solid #eee' }}>{row.desc}</td>
            <td style={{ ...colStyle, textAlign: 'right', color: MID, borderBottom: '1px solid #eee' }}>
              {row.showRate && row.rate != null ? gbp(row.rate) : ''}
            </td>
            <td style={{ ...colStyle, textAlign: 'center', color: MID, borderBottom: '1px solid #eee' }}>
              {row.showRate && row.qty !== 1 ? row.qty : ''}
            </td>
            <td style={{ ...colStyle, textAlign: 'right', color: DARK, fontWeight: 600, borderBottom: '1px solid #eee' }}>
              {gbp(row.cost)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// depositCreditAmount: pre-invoice deposit total (pounds, number) surfaced as a credit on
// the invoice. Reduces the balance due line. 0 = no credit line shown.
function PreviewSummary({ quote, materials, showVat, isCisJob, cisRate, itemiseDocuments = false, depositCreditAmount = 0 }) {
  const labour       = Math.max(0, quote - materials);
  const vat          = showVat ? Math.round(quote * 0.2 * 100) / 100 : 0;
  const grossTotal   = quote + vat;
  // CRITICAL: materials always feeds CIS calc regardless of itemiseDocuments
  const cisDeduction = (isCisJob && cisRate > 0)
    ? Math.round(labour * (cisRate / 100) * 100) / 100
    : 0;
  const totalPayable = grossTotal - cisDeduction;

  const rowStyle = { display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: 12 };

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
      <div style={{ background: '#f8f8f8', borderRadius: 6, padding: '6px 0', minWidth: 180, maxWidth: 220 }}>

        {/* Labour row — only when itemise toggle is ON */}
        {itemiseDocuments && (
          <div style={rowStyle}>
            <span style={{ color: MID }}>Labour</span>
            <span style={{ color: DARK }}>{gbp(labour)}</span>
          </div>
        )}

        {/* Materials row — only when itemise toggle is ON and materials > 0 */}
        {itemiseDocuments && materials > 0 && (
          <div style={rowStyle}>
            <span style={{ color: MID }}>Additional costs</span>
            <span style={{ color: DARK }}>{gbp(materials)}</span>
          </div>
        )}

        {showVat && (
          <div style={rowStyle}>
            <span style={{ color: MID }}>VAT (20%)</span>
            <span style={{ color: DARK }}>{gbp(vat)}</span>
          </div>
        )}

        {/* CIS Deduction — always shown when it applies (legal deduction) */}
        {isCisJob && cisDeduction > 0 && (
          <div style={rowStyle}>
            <span style={{ color: '#b43c3c' }}>CIS Deduction ({cisRate}%)</span>
            <span style={{ color: '#b43c3c' }}>−{gbp(cisDeduction)}</span>
          </div>
        )}

        <div style={{ borderTop: `1.5px solid ${GREEN}`, margin: '4px 8px 0' }} />

        <div style={{ ...rowStyle, fontWeight: 800, paddingTop: 6 }}>
          <span style={{ color: DARK }}>Total Payable</span>
          <span style={{ color: DARK }}>{gbp(totalPayable)}</span>
        </div>

        {/* Deposit credit line — shown when a pre-invoice deposit has been recorded
            in payments[]. Reduces the balance due shown on the invoice. */}
        {depositCreditAmount > 0 && (
          <>
            <div style={{ ...rowStyle, color: GREEN }}>
              <span>Deposit received</span>
              <span>−{gbp(depositCreditAmount)}</span>
            </div>
            <div style={{ borderTop: `1.5px solid ${GREEN}`, margin: '4px 8px 0' }} />
            <div style={{ ...rowStyle, fontWeight: 800, paddingTop: 6 }}>
              <span style={{ color: DARK }}>Balance due</span>
              <span style={{ color: DARK }}>{gbp(Math.max(0, totalPayable - depositCreditAmount))}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PreviewPaymentDetails({ effectiveBiz, invoiceNumber, payNowUrl }) {
  const hasBankFields = effectiveBiz.accountName || effectiveBiz.sortCode || effectiveBiz.accountNumber;
  const stripeLink    = !payNowUrl ? effectiveBiz.stripePaymentLink : '';

  if (!hasBankFields && !effectiveBiz.bankDetails && !stripeLink && !payNowUrl) return null;

  return (
    <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: LIGHT, letterSpacing: '0.06em', marginBottom: 8 }}>
        PAYMENT DETAILS
      </div>

      {payNowUrl && (
        <div style={{
          background: GREEN,
          borderRadius: 8,
          padding: '9px 16px',
          marginBottom: 10,
          textAlign: 'center',
        }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>
            Pay by card
          </div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, marginTop: 2 }}>
            Powered by Stripe · Secure
          </div>
        </div>
      )}

      {stripeLink && !payNowUrl && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: DARK, marginBottom: 2 }}>Pay by card:</div>
          <div style={{ fontSize: 11, color: '#005bcc', wordBreak: 'break-all' }}>{stripeLink}</div>
        </div>
      )}

      {(hasBankFields || effectiveBiz.bankDetails) && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 12, color: DARK, marginBottom: 4 }}>
            {(stripeLink || payNowUrl) ? 'Or pay by bank transfer:' : 'Bank details:'}
          </div>
          {hasBankFields ? (
            <div style={{ fontSize: 11, color: MID, lineHeight: 1.7 }}>
              {effectiveBiz.accountName && <div>Name: {effectiveBiz.accountName}</div>}
              {effectiveBiz.sortCode && <div>Sort code: {effectiveBiz.sortCode}</div>}
              {effectiveBiz.accountNumber && <div>Account: {effectiveBiz.accountNumber}</div>}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: MID, lineHeight: 1.7, whiteSpace: 'pre-line' }}>
              {effectiveBiz.bankDetails}
            </div>
          )}
          {invoiceNumber && (
            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: DARK }}>
              Reference: {invoiceNumber}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InvoiceDocumentPreview({
  job,
  biz,
  profile = null,
  invoiceNumber,
  dueDate,
  payNowUrl = '',
  receipts = [],
}) {
  // Build the same effectiveBiz merge used in invoicePDF.js so the preview
  // is guaranteed to show the same data as the generated PDF.
  const effectiveBiz = {
    name:          biz?.name          || profile?.business_name || '',
    address:       biz?.address       || profile?.address        || '',
    phone:         biz?.phone         || profile?.phone          || '',
    email:         biz?.email         || profile?.email          || '',
    logoUrl:       biz?.logoUrl       || profile?.logo_url       || '',
    logo_url:      biz?.logo_url      || profile?.logo_url       || '',
    utr:           biz?.utr           || profile?.utr_number     || '',
    vatRegistered: biz?.vatRegistered ?? biz?.vat_registered     ?? profile?.vat_registered ?? false,
    vatNumber:     biz?.vatNumber     || biz?.vat_number         || profile?.vat_number      || '',
    accountName:   biz?.accountName   || profile?.account_name   || '',
    sortCode:      biz?.sortCode      || biz?.sort_code          || profile?.sort_code       || '',
    accountNumber: biz?.accountNumber || biz?.account_number     || profile?.account_number  || '',
    bankDetails:   biz?.bankDetails   || profile?.bank_details   || '',
    stripePaymentLink: biz?.stripePaymentLink || biz?.stripe_payment_link
                     || profile?.stripe_payment_link || '',
  };

  // CIS status — mirrors the same logic in invoicePDF.js
  const cisProfile = profile || {
    is_cis_subcontractor: biz?.is_cis_subcontractor ?? false,
    cis_default_rate:     biz?.cis_default_rate ?? 20,
  };
  const { isCisJob, rate: cisRate } = resolveCisStatus(job || {}, cisProfile);

  // Materials = receipts linked to this job
  const safeReceipts = Array.isArray(receipts) ? receipts : [];
  const materials = safeReceipts
    .filter(r => r && r.jobId != null && (
      String(r.jobId) === String(job?.id) ||
      (job?.cloudId != null && String(r.jobId) === String(job.cloudId))
    ))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const quote = Number(job?.total ?? job?.amount ?? 0);
  const itemiseDocuments = (profile?.itemise_documents) ?? false;
  const paymentTermsDays = profile?.payment_terms_days ?? 14;

  // Deposit credit: sum payments that are structurally flagged as deposits
  // (type === 'deposit') OR whose note matches /deposit/i for back-compat.
  // The type flag is set by RecordPaymentModal in deposit mode since the bug
  // fix — existing deposits (including Stripe "Deposit on acceptance" webhook
  // payments) are caught by the note fallback.
  const depositCreditAmount = Array.isArray(job?.payments)
    ? job.payments
        .filter(p => p.type === 'deposit' || /deposit/i.test(p.note || ''))
        .reduce((sum, p) => sum + Number(p.amount || 0), 0)
    : 0;

  return (
    <div
      className="invoice-doc-preview"
      style={{
        background: '#fff',
        borderRadius: 8,
        border: '1px solid #e0e0e0',
        padding: 16,
        boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
        fontFamily: 'var(--font-sans)',
        color: DARK,
      }}
    >
      <PreviewHeader effectiveBiz={effectiveBiz} />

      <div style={{ borderTop: `1.5px solid #e0e0e0`, marginBottom: 14 }} />

      <PreviewMeta
        invoiceNumber={invoiceNumber}
        dueDate={dueDate}
        paymentTermsDays={paymentTermsDays}
      />

      <PreviewBillTo job={job} />

      <PreviewLineItems job={job} />

      <PreviewSummary
        quote={quote}
        materials={materials}
        showVat={effectiveBiz.vatRegistered}
        vatNumber={effectiveBiz.vatNumber}
        isCisJob={isCisJob}
        cisRate={cisRate}
        itemiseDocuments={itemiseDocuments}
        depositCreditAmount={depositCreditAmount}
      />

      <PreviewPaymentDetails
        effectiveBiz={effectiveBiz}
        invoiceNumber={invoiceNumber}
        payNowUrl={payNowUrl}
      />

      {/* Thank you line — mirrors the invoice PDF footer */}
      <div style={{ marginTop: 12, fontSize: 11, fontStyle: 'italic', color: MID }}>
        Thank you for your business.
      </div>
    </div>
  );
}
