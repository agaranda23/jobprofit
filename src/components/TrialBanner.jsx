/**
 * TrialBanner — slim countdown strip shown near the top of Today screen.
 *
 * Render rules:
 *   - Hidden entirely while UNLOCK_PRO_FOR_ALL is true (everyone is Pro,
 *     no trial copy makes sense).
 *   - Shown only when the user is on an active trial (plan='trial',
 *     trial_ends_at in the future).
 *   - When > 2 days left: standard countdown copy.
 *   - When ≤ 2 days left (urgent): escalate to "keep it another month" framing
 *     + amber tint emphasis. The CTA still calls checkout directly (skips
 *     ProUpgradeSheet) to minimise friction on the last day.
 *
 * This banner only ever renders while isTrialActive(profile) is true — i.e.
 * the user is on the homegrown trial (plan='trial') and has NEVER been
 * through Stripe checkout yet (completing Stripe checkout flips plan='pro'
 * via the webhook, which hides this banner). So both states here are a
 * "convert my already-running trial → real subscription" action, never a
 * "start a trial" one — the CTA must collect a card. It calls
 * startCheckoutImmediate() (coupon_mode:'none', charged today) from
 * billing.js, the same card-required path DropToFreeScreen.jsx already uses.
 * (Not the trial_extension/coupon path either — that requires the user to
 * reach ProUpgradeSheet with variant='trial_end'.)
 */
import { UNLOCK_PRO_FOR_ALL, isTrialActive, trialDaysLeft } from '../lib/plan.js';
import { startCheckoutImmediate } from '../lib/billing.js';
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
    logTelemetry('checkout_started', { trigger: UPGRADE_TRIGGERS.TRIAL_BANNER, urgent });
    const { error } = await startCheckoutImmediate({ source: UPGRADE_TRIGGERS.TRIAL_BANNER });
    if (error) onError?.(error);
  };

  return (
    <div className={`trial-banner${urgent ? ' trial-banner--urgent' : ''}`} role="status" aria-live="polite">
      <span className="trial-banner__text">
        {urgent
          ? `Trial ends in ${dayLabel} — keep Pro free another month`
          : `Pro trial · ${dayLabel} left`}
      </span>
      <button
        type="button"
        className="trial-banner__cta"
        onClick={handleUpgrade}
      >
        {urgent ? 'Keep Pro free' : 'Add a card to stay Pro'}
      </button>
    </div>
  );
}
