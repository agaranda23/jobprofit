/**
 * GetProPill — slim upsell row for the top of Today screen.
 *
 * Four states driven by plan helpers from lib/plan.js:
 *
 *   trial-settled  isTrialActive && daysLeft >= 4
 *     Copy: "Pro trial — {N} days of true-profit left"
 *     CTA:  opens ProUpgradeSheet (informational, low urgency)
 *     Tint: neutral/green (brand)
 *     Dismissible: yes (session)
 *
 *   trial-urgency  isTrialActive && daysLeft <= 3 (and not last day)
 *     Copy: "{N} days left — keep your true-profit view for £12/mo"
 *     CTA:  startCheckoutImmediate() direct (minimal friction, card required —
 *           this converts the already-running trial into a real £12/mo sub,
 *           it does NOT start a new trial)
 *     Tint: amber
 *     Dismissible: NO (urgency must survive a prior dismiss)
 *
 *   last-day       isTrialLastDay
 *     Copy: "Last day of Pro — keep it for £12/mo"
 *     CTA:  startCheckoutImmediate() direct (card required)
 *     Tint: amber
 *     Dismissible: NO
 *
 *   free/expired   !isPro && !isTrialActive
 *     Copy: "Get Pro — see your true profit, tax pot & auto-chasing"
 *     CTA:  opens ProUpgradeSheet
 *     Tint: gold (--gold-gradient, matches the existing base style)
 *     Dismissible: yes (session)
 *
 * Dismissal: only settled-trial and free states write to sessionStorage.
 * Urgency and last-day states ignore the dismiss flag so a user who dismissed
 * early still sees the day-12/13/14 nudge.
 *
 * Never shown when isPro (paid plan, not trial).
 *
 * Props:
 *   profile    — Supabase profiles row (may be null while loading)
 *   onOpen     — called when the pill opens ProUpgradeSheet (settled / free states)
 *   onError    — called with an error string if startCheckoutImmediate() fails (urgency / last-day states)
 */

import { useState } from 'react';
import { isPro, isTrialActive, isTrialLastDay, trialDaysLeft } from '../lib/plan';
import { startCheckoutImmediate } from '../lib/billing';
import { logTelemetry, setLastUpgradeTrigger, UPGRADE_TRIGGERS } from '../lib/telemetry';
import Icon from './Icon';

const SESSION_KEY = 'jp.getproPillDismissed';

function isDismissed() {
  try { return !!sessionStorage.getItem(SESSION_KEY); } catch { return false; }
}

function setDismissed() {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* sessionStorage unavailable */ }
}

// Resolve which of the 4 display states applies.
// Returns: 'settled' | 'urgency' | 'last-day' | 'free'
function resolveState(profile) {
  const onTrial = isTrialActive(profile);
  if (onTrial) {
    if (isTrialLastDay(profile)) return 'last-day';
    const days = trialDaysLeft(profile);
    return days <= 3 ? 'urgency' : 'settled';
  }
  return 'free';
}

export default function GetProPill({ profile, onOpen, onError }) {
  const [dismissed, setDismissedState] = useState(isDismissed);

  // Paid Pro: never show
  if (isPro(profile) && !isTrialActive(profile)) return null;
  // Fully paid (plan=pro) never shows
  if (profile?.plan === 'pro') return null;

  const state = resolveState(profile);

  // Urgency and last-day states must NOT respect dismissal — they re-appear
  // even if the user dismissed during the settled window.
  const isDismissible = state === 'settled' || state === 'free';
  if (isDismissible && dismissed) return null;

  const daysLeft = trialDaysLeft(profile);
  const dayWord = daysLeft === 1 ? 'day' : 'days';

  let copy;
  let iconName;
  let pillModifier;
  let isDirectCheckout;

  switch (state) {
    case 'settled':
      copy = `Pro trial — ${daysLeft} ${dayWord} of true-profit left`;
      iconName = 'clock';
      pillModifier = 'get-pro-pill--settled';
      isDirectCheckout = false;
      break;
    case 'urgency':
      copy = `${daysLeft} ${dayWord} left — keep your true-profit view for £12/mo`;
      iconName = 'clock';
      pillModifier = 'get-pro-pill--urgency';
      isDirectCheckout = true;
      break;
    case 'last-day':
      copy = 'Last day of Pro — keep it for £12/mo';
      iconName = 'clock';
      pillModifier = 'get-pro-pill--urgency';
      isDirectCheckout = true;
      break;
    case 'free':
    default:
      copy = 'Get Pro — auto-chase late payers, remove OHNAR branding & see your true profit';
      iconName = 'sparkles';
      pillModifier = '';
      isDirectCheckout = false;
      break;
  }

  const handleDismiss = (e) => {
    e.stopPropagation();
    setDismissed();
    setDismissedState(true);
  };

  const handleTap = async () => {
    if (isDirectCheckout) {
      setLastUpgradeTrigger(UPGRADE_TRIGGERS.TRIAL_BANNER);
      logTelemetry('checkout_started', { trigger: UPGRADE_TRIGGERS.TRIAL_BANNER, state });
      // Converting an already-running trial → card required, no new trial.
      const { error } = await startCheckoutImmediate({ source: UPGRADE_TRIGGERS.TRIAL_BANNER });
      if (error) onError?.(error);
    } else {
      onOpen?.();
    }
  };

  return (
    <div className={`get-pro-pill${pillModifier ? ` ${pillModifier}` : ''}`}>
      <button
        type="button"
        className="get-pro-pill__body"
        onClick={handleTap}
        aria-label={copy + (isDirectCheckout ? ' — tap to subscribe' : ' — tap to learn more')}
      >
        <span className="get-pro-pill__icon" aria-hidden="true">
          <Icon name={iconName} size={16} />
        </span>
        <span className="get-pro-pill__copy">{copy}</span>
        <span className="get-pro-pill__chevron" aria-hidden="true">&#8250;</span>
      </button>
      {isDismissible && (
        <button
          type="button"
          className="get-pro-pill__dismiss"
          aria-label="Dismiss"
          onClick={handleDismiss}
        >
          &times;
        </button>
      )}
    </div>
  );
}
