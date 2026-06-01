/**
 * PublicReceiptView — hosted receipt page at /r/<token>.
 *
 * Customer-facing, read-only receipt view. No authentication required.
 * Mirrors PublicInvoiceView's structure — same fetch mechanism, same loading
 * and error states, same forced-light .pqv-card treatment.
 *
 * What renders:
 *   - Business logo + name (branding)
 *   - "RECEIPT" heading + paid date
 *   - Customer name + job summary
 *   - Amount paid
 *   - "PAID IN FULL" stamp
 *   - Thank-you line
 *
 * What is NOT rendered:
 *   - Bank details (receipt confirms payment, not requests it)
 *   - Internal notes, profit data, linked expense receipts, photos
 *   - Any trader-side UI (no editing, no status changes)
 *
 * Design: mobile-first, max-width 600px, no auth shell, forced light theme.
 */

import { useState, useEffect } from 'react';
import { fetchPublicJob } from '../lib/store';
import { isValidToken } from '../lib/publicReceiptToken';
import { resolvePaidDate, resolveAmountPaid, formatReceiptDate } from '../lib/receiptMessage';

const FETCH_PROFILE_URL = '/.netlify/functions/fetch-public-receipt';

const GREEN       = '#2bc48a';
const PAID_BG     = '#0e6b43';
const PAID_FG     = '#dcffee';
const DARK        = '#141414';
const MID         = '#505050';
const LIGHT       = '#969696';

function gbp(n) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0);
}

// ── Loading / error states — reuse .pqv-* class names ─────────────────────────

function LoadingState() {
  return (
    <div className="pqv-wrap" aria-busy="true" aria-label="Loading receipt">
      <div className="pqv-card">
        <div className="pqv-skeleton pqv-skeleton--title" />
        <div className="pqv-skeleton pqv-skeleton--line" />
        <div className="pqv-skeleton pqv-skeleton--line pqv-skeleton--short" />
        <div className="pqv-skeleton pqv-skeleton--line" />
      </div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="pqv-wrap">
      <div className="pqv-card pqv-card--error">
        <div className="pqv-error-icon" aria-hidden="true">&#x26A0;</div>
        <h1 className="pqv-error-title">Receipt not found</h1>
        <p className="pqv-error-body">
          {message || 'This link may be invalid or the receipt has been removed. Contact your trader for a new link.'}
        </p>
      </div>
    </div>
  );
}

// ── Branded receipt card ───────────────────────────────────────────────────────

function ReceiptCard({ job, profile }) {
  const amountPaid   = resolveAmountPaid(job);
  const paidDate     = resolvePaidDate(job);
  const paidDateLabel = formatReceiptDate(paidDate);
  const jobTotal     = Number(job?.total ?? job?.amount ?? 0);

  const lineItems =
    Array.isArray(job?.lineItems) && job.lineItems.length > 0
      ? job.lineItems
      : [{ desc: job?.summary || 'Work completed', cost: jobTotal }];

  const logoUrl    = profile?.logoUrl || '';
  const bizName    = profile?.businessName || '';
  const bizAddress = profile?.address || '';

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 8,
        border: '1px solid #e0e0e0',
        padding: 16,
        boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: DARK,
      }}
      aria-label="Receipt"
    >
      {/* Business header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ width: 48, height: 48, flexShrink: 0 }}>
          {logoUrl && (
            <img src={logoUrl} alt="Logo" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 4 }} />
          )}
        </div>
        <div style={{ textAlign: 'right', flex: 1, paddingLeft: 10 }}>
          {bizName && (
            <div style={{ fontWeight: 800, fontSize: 15, color: DARK, marginBottom: 2 }}>{bizName}</div>
          )}
          {bizAddress && (
            <div style={{ fontSize: 11, color: MID }}>{bizAddress}</div>
          )}
        </div>
      </div>

      <div style={{ borderTop: '1.5px solid #e0e0e0', marginBottom: 12 }} />

      {/* RECEIPT heading + date */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: GREEN, letterSpacing: '-0.5px' }}>RECEIPT</div>
        <div style={{ fontSize: 12, color: MID }}>{paidDateLabel}</div>
      </div>

      {/* Customer */}
      <div style={{ background: '#f8f8f8', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: LIGHT, letterSpacing: '0.06em', marginBottom: 4 }}>
          RECEIVED FROM
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, color: DARK }}>
          {job?.customer || job?.customerName || 'Customer'}
        </div>
      </div>

      {/* Line items */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ background: GREEN, color: '#fff', fontWeight: 700, padding: '6px 8px', textAlign: 'left' }}>Description</th>
            <th style={{ background: GREEN, color: '#fff', fontWeight: 700, padding: '6px 8px', textAlign: 'right', width: 80 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((li, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
              <td style={{ padding: '6px 8px', color: DARK, borderBottom: '1px solid #eee' }}>{li.desc || 'Item'}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: DARK, fontWeight: 600, borderBottom: '1px solid #eee' }}>
                {gbp(li.cost || 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals panel */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <div style={{ background: '#f8f8f8', borderRadius: 6, padding: '6px 0', minWidth: 160 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: 12 }}>
            <span style={{ color: MID }}>Subtotal</span>
            <span style={{ color: DARK }}>{gbp(jobTotal)}</span>
          </div>
          <div style={{ borderTop: `1.5px solid ${GREEN}`, margin: '4px 8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px 4px', fontSize: 13, fontWeight: 800 }}>
            <span style={{ color: DARK }}>Amount paid</span>
            <span style={{ color: DARK }}>{gbp(amountPaid)}</span>
          </div>
        </div>
      </div>

      {/* PAID IN FULL stamp */}
      <div
        style={{
          background: PAID_BG,
          borderRadius: 6,
          padding: '12px 16px',
          textAlign: 'center',
          marginBottom: 12,
        }}
        aria-label="Paid in full"
      >
        <div style={{ color: PAID_FG, fontWeight: 900, fontSize: 15, letterSpacing: '0.04em' }}>PAID IN FULL</div>
        {paidDateLabel && (
          <div style={{ color: 'rgba(220,255,238,0.75)', fontSize: 11, marginTop: 3 }}>
            Payment received: {paidDateLabel}
          </div>
        )}
      </div>

      {/* Thank-you */}
      <div style={{ fontSize: 11, color: MID, fontStyle: 'italic', textAlign: 'center' }}>
        Thank you for your business.
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * @param {{ token: string }} props
 */
export default function PublicReceiptView({ token }) {
  const [jobState,     setJobState]     = useState({ status: 'loading', job: null, errorMsg: '' });
  const [profileState, setProfileState] = useState({ status: 'loading', profile: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isValidToken(token)) {
        setJobState({ status: 'error', job: null, errorMsg: 'This link is not valid. Ask your trader for an updated link.' });
        setProfileState({ status: 'ok', profile: null });
        return;
      }

      const [jobResult, profileResult] = await Promise.allSettled([
        fetchPublicJob(token),
        fetch(FETCH_PROFILE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (cancelled) return;

      const job = jobResult.status === 'fulfilled' ? jobResult.value : null;
      if (!job) {
        setJobState({ status: 'error', job: null, errorMsg: 'Receipt not found. The link may have expired or been removed.' });
        setProfileState({ status: 'ok', profile: null });
        return;
      }

      setJobState({ status: 'ok', job, errorMsg: '' });
      setProfileState({ status: 'ok', profile: profileResult.status === 'fulfilled' ? profileResult.value : null });
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  const { status, job, errorMsg } = jobState;

  if (status === 'loading' || (status === 'ok' && profileState.status === 'loading')) {
    return <LoadingState />;
  }

  if (status === 'error') {
    return <ErrorState message={errorMsg} />;
  }

  const profile = profileState.profile || {};

  return (
    <div className="pqv-wrap">
      <div className="pqv-card">
        <div className="pqv-header">
          {profile.businessName && (
            <div className="pqv-business-name">{profile.businessName}</div>
          )}
          <div className="pqv-quote-label">Receipt</div>
        </div>

        <ReceiptCard job={job} profile={profile} />

        <div className="pqv-footer">
          <p className="pqv-footer-note">
            Questions about this receipt? Contact your trader directly.
          </p>
        </div>
      </div>
    </div>
  );
}
