/**
 * InvoiceSentMoment — small overlay shown for ~900ms right after an invoice
 * successfully sends (see ReviewSheet.jsx's handleInvoiceWhatsApp).
 *
 * "Invoice sent" is the habit the app most wants to reinforce (mark-paid
 * already gets the biggest moment via PaidCelebration — money in — but the
 * *send* that leads there used to slip by with a plain toast). This overlay
 * is deliberately smaller and quieter than PaidCelebration:
 *   - shorter dwell (~900ms vs ~1.3s)
 *   - smaller card, no ring-burst/sheen
 *   - brand blue (--accent), never the green reserved for money-in
 * so a trader never mistakes "sent" for "paid".
 *
 * Motion: a paper-plane icon arcs up and to the right while the card fades
 * in/out. Under prefers-reduced-motion: static badge, no arc, no animation
 * (mirrors PaidCelebration's reduced-motion handling).
 *
 * Rendered locally inside ReviewSheet (single call site today — invoice
 * send only) rather than lifted to AppShell like PaidCelebration, which
 * needs to be shared across several mark-paid entry points.
 */

import { useEffect, useRef } from 'react';
import Icon from './Icon';

export default function InvoiceSentMoment({ active, customerName, onDone }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onDone?.();
    }, 900);
    return () => clearTimeout(timerRef.current);
  }, [active, onDone]);

  if (!active) return null;

  const label = customerName
    ? `On its way to ${customerName}! ✈️`
    : 'On its way to your customer ✈️';

  return (
    <div className="invoice-sent-moment" role="status" aria-live="polite" aria-label="Invoice sent">
      <div className="invoice-sent-moment__card">
        <div className="invoice-sent-moment__plane" aria-hidden="true">
          <Icon name="send" size={28} variant="brand" />
        </div>
        <p className="invoice-sent-moment__label">{label}</p>
      </div>
    </div>
  );
}
