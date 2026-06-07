/**
 * TrialBanner — slim countdown strip shown near the top of Today screen.
 *
 * Render rules:
 *   - Hidden entirely while UNLOCK_PRO_FOR_ALL is true (everyone is Pro,
 *     no trial copy makes sense).
 *   - Shown only when the user is on an active trial (plan='trial',
 *     trial_ends_at in the future).
 *   - When ≤ 2 days left the text is slightly emphasised (bold + amber tint)
 *     — still inline, never a modal.
 *
 * The "Add a card to stay Pro" CTA calls startCheckout() from billing.js.
 */
import { UNLOCK_PRO_FOR_ALL, isTrialActive, trialDaysLeft } from '../lib/plan.js';
import { startCheckout } from '../lib/billing.js';
import { logTelemetry, setLastUpgradeTrigger, UPGRADE_TRIGGERS } from '../lib/telemetry.js';

export default function TrialBanner({ profile, onError }) {
  // While the global override is on, show nothing — everyone is already Pro.
  if (UNLOCK_PRO_FOR_ALL) return null;
  if (!isTrialActive(profile)) return null;

  const days = trialDaysLeft(profile);
  const urgent = days <= 2;
  const dayLabel = days === 1 ? '1 day' : `${days} days`;

  const handleUpgrade = async () => {
    // TrialBanner skips ProUpgradeSheet and calls checkout directly.
    // Set trigger in sessionStorage so subscription_active.last_trigger is correct
    // after the Stripe redirect, and fire checkout_started for funnel visibility.
    setLastUpgradeTrigger(UPGRADE_TRIGGERS.TRIAL_BANNER);
    logTelemetry('checkout_started', { trigger: UPGRADE_TRIGGERS.TRIAL_BANNER });
    const { error } = await startCheckout();
    if (error) onError?.(error);
  };

  return (
    <div className={`trial-banner${urgent ? ' trial-banner--urgent' : ''}`} role="status" aria-live="polite">
      <span className="trial-banner__text">
        Pro trial &middot; {dayLabel} left
      </span>
      <button
        type="button"
        className="trial-banner__cta"
        onClick={handleUpgrade}
      >
        Add a card to stay Pro
      </button>
    </div>
  );
}
