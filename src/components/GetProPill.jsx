/**
 * GetProPill — slim upsell row for the top of Today screen.
 *
 * Show when:
 *   - Free user (!isPro): "Get Pro — unlock true profit, tax pot, chase ladder & more"
 *   - Active trial (isTrialActive): "N days left on your free Pro trial — add a card to keep Pro"
 *
 * Never shown when isPro (paid plan, not trial).
 *
 * Dismissible for the session via sessionStorage flag 'jp.getproPillDismissed'.
 * On tap → opens ProUpgradeSheet.
 *
 * Props:
 *   profile    — Supabase profiles row (may be null while loading)
 *   onOpen     — called when the pill is tapped (opens ProUpgradeSheet with trigger='today_pill')
 */

import { useState } from 'react';
import { isTrialActive, trialDaysLeft, planAllowsPro } from '../lib/plan';

const SESSION_KEY = 'jp.getproPillDismissed';

function isDismissed() {
  try { return !!sessionStorage.getItem(SESSION_KEY); } catch { return false; }
}

function setDismissed() {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* sessionStorage unavailable */ }
}

export default function GetProPill({ profile, onOpen }) {
  const [dismissed, setDismissedState] = useState(isDismissed);

  // Don't show for paid Pro users (plan=pro). Show for trial and free.
  const paid = planAllowsPro(profile);
  const onTrial = isTrialActive(profile);
  const daysLeft = trialDaysLeft(profile);

  // Paid Pro: never show
  if (paid) return null;
  // Dismissed this session: don't show
  if (dismissed) return null;

  const handleDismiss = (e) => {
    e.stopPropagation();
    setDismissed();
    setDismissedState(true);
  };

  const copy = onTrial
    ? `Trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — add a card to keep Pro`
    : 'Get Pro — unlock true profit, tax pot, chase ladder & more';

  const icon = onTrial ? '⏳' : '💎'; // ⏳ or 💎

  return (
    <div className="get-pro-pill">
      <button
        type="button"
        className="get-pro-pill__body"
        onClick={onOpen}
        aria-label={copy + ' — tap to learn more'}
      >
        <span className="get-pro-pill__icon" aria-hidden="true">{icon}</span>
        <span className="get-pro-pill__copy">{copy}</span>
        <span className="get-pro-pill__chevron" aria-hidden="true">&#8250;</span>
      </button>
      <button
        type="button"
        className="get-pro-pill__dismiss"
        aria-label="Dismiss"
        onClick={handleDismiss}
      >
        &times;
      </button>
    </div>
  );
}
