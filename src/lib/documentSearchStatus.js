/**
 * documentSearchStatus — pure status/subtitle helpers for DocumentSearchOverlay.
 *
 * Split out of DocumentSearchOverlay.jsx (which must stay a component-only
 * export for React Fast Refresh — react-refresh/only-export-components) but
 * kept in the same shape so the overlay and its tests both import from here.
 */

import { gbp } from './today';
import { taxYearFor } from './taxYear';

/** Receipt status pill: Paid when the linked job (if any) is paid, else Unpaid. */
export function receiptStatus(receipt, job) {
  if (!job) return 'Unpaid';
  if (job.paid === true) return 'Paid';
  if ((job.paymentStatus || '').toLowerCase() === 'paid') return 'Paid';
  if ((job.status || '').toLowerCase() === 'paid') return 'Paid';
  return 'Unpaid';
}

/** Receipts-mode subtitle: match count while searching, else totals for the tax period. */
export function buildReceiptSubtitle(filteredReceipts, taxPeriod, query) {
  const n = filteredReceipts.length;
  if (query) {
    return n === 0 ? 'no matches' : n === 1 ? '1 match' : `${n} matches`;
  }
  if (n === 0) return '';

  const total = filteredReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
  const vat   = filteredReceipts.reduce((s, r) => s + Number(r.vat   || 0), 0);

  const totalStr = total >= 1000 ? `£${(total / 1000).toFixed(1).replace(/\.0$/, '')}k` : gbp(total);
  const vatStr   = gbp(vat);
  const label    = n === 1 ? 'receipt' : 'receipts';

  if (taxPeriod === 'all') {
    return `${n} ${label} · ${totalStr}`;
  }

  const year = taxYearFor(new Date());
  return `${n} ${label} · ${totalStr} · ${vatStr} VAT · ${year}`;
}
