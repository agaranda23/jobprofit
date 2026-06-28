/**
 * PaidCelebration — full-screen overlay shown for ~1.2s after a job is marked paid.
 *
 * Rendered once at AppShell level and triggered via the `active` prop so every
 * mark-paid entry point (Today, Jobs drawer, Record Payment modal) shares the
 * same celebration without duplicating code.
 *
 * Motion:
 *   - ring burst + check icon fade/scale in → hold → fade out
 *   - Total duration ~1.2s, then `onDone` fires to let AppShell clear state.
 *   - Under prefers-reduced-motion: static badge, no burst, no animation.
 *
 * Design tokens used:
 *   --on-success (#fff on #16A34A)
 *   --fs-money-hero for the amount
 *   JetBrains Mono for the £ amount (data-font="mono")
 */

import { useEffect, useRef } from 'react';
import Icon from './Icon';

export default function PaidCelebration({ active, amount, onDone }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onDone?.();
    }, 1300);
    return () => clearTimeout(timerRef.current);
  }, [active, onDone]);

  if (!active) return null;

  const formattedAmount =
    amount != null
      ? `£${Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
      : null;

  return (
    <div className="paid-celebration" role="status" aria-live="polite" aria-label="Payment recorded">
      <div className="paid-celebration__card">
        <div className="paid-celebration__ring" aria-hidden="true">
          <div className="paid-celebration__check">
            <Icon name="paid" size={36} variant="success" />
          </div>
        </div>
        {formattedAmount && (
          <p className="paid-celebration__amount" data-font="mono">
            {formattedAmount} paid!
          </p>
        )}
        <p className="paid-celebration__label">Nice one</p>
      </div>
    </div>
  );
}
