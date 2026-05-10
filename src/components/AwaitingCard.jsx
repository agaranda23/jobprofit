import { useState } from 'react';
import { daysSinceInvoice } from '../lib/jobStatus';
import { gbp } from '../lib/today';

export default function AwaitingCard({ job, onMarkPaid }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const days = daysSinceInvoice(job);
  const amount = job.total ?? job.amount ?? 0;
  const customer = job.customer || job.customerName || 'Customer';

  const metaClass =
    days != null && days >= 14 ? 'awaiting-job-meta awaiting-job-meta-late' :
    days != null && days >= 7  ? 'awaiting-job-meta awaiting-job-meta-warn' :
    'awaiting-job-meta';

  const metaText =
    days == null ? 'Invoice sent' :
    days === 0   ? 'Sent today' :
    `${days} day${days === 1 ? '' : 's'} ago`;

  return (
    <div className="awaiting-job-card">
      <div className="awaiting-job-card-row">
        <div className="awaiting-job-customer-col">
          <div className="awaiting-job-customer">{customer}</div>
          <div className={metaClass}>{metaText}</div>
        </div>
        <div className="awaiting-job-amount">{gbp(amount)}</div>
      </div>
      {pickerOpen ? (
        <div className="awaiting-job-picker">
          <div className="awaiting-job-picker-label">How were you paid?</div>
          <div className="awaiting-job-picker-grid">
            <button type="button" className="awaiting-job-method-btn awaiting-job-method-bank"
              onClick={() => { onMarkPaid?.(job, 'bank transfer'); setPickerOpen(false); }}>💳 Bank</button>
            <button type="button" className="awaiting-job-method-btn awaiting-job-method-cash"
              onClick={() => { onMarkPaid?.(job, 'cash'); setPickerOpen(false); }}>💵 Cash</button>
            <button type="button" className="awaiting-job-method-btn awaiting-job-method-card"
              onClick={() => { onMarkPaid?.(job, 'card'); setPickerOpen(false); }}>💳 Card</button>
          </div>
          <button type="button" className="awaiting-job-picker-cancel"
            onClick={() => setPickerOpen(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="awaiting-job-paid-btn"
          onClick={() => setPickerOpen(true)}>💷 Mark Paid</button>
      )}
    </div>
  );
}
