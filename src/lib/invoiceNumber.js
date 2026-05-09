// Auto-generated invoice numbers in the JP-XXXX series, derived from
// existing jobs' invoiceNumber values. Editable on send.
//
// Note: the legacy `invoices` collection uses INV-XXXX (see nextInvNum
// in App.jsx). The new flow writes to `job.invoiceNumber` directly and
// uses a different prefix so the two series don't collide.

export function nextInvoiceNumber(jobs) {
  const used = (jobs || [])
    .map(j => j.invoiceNumber || '')
    .filter(n => /^JP-\d+$/.test(n))
    .map(n => parseInt(n.replace('JP-', ''), 10))
    .filter(n => !isNaN(n));
  const next = used.length > 0 ? Math.max(...used) + 1 : 1;
  return `JP-${String(next).padStart(4, '0')}`;
}
