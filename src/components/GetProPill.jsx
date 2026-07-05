/**
 * GetProPill — slim upsell/engagement row for the top of Today screen.
 *
 * 2026-07-05 (Today-alive, item 5): repointed from "sell" to "use it" for the
 * duration of an active trial — a trader who is ALREADY on Pro doesn't need
 * to be sold Pro, they need to be shown what it does before it lapses. Only
 * the free (no trial) state still exists to convert a non-trial visitor.
 *
 * Three states driven by plan helpers from lib/plan.js:
 *
 *   settled   isTrialActive && daysLeft > 3
 *     Copy:   "Pro trial · {N} days left — {see your true profit|remove your
 *             footer|see your tax pot}" — the suggested perk ROTATES across
 *             mounts (see lib/proPillRotation.js) so a multi-day trial
 *             touches more than one perk instead of repeating the same line.
 *     CTA:    onNavigateToMoney() — deep-links straight to the Money tab,
 *             where every one of those perks actually lives. Falls back to
 *             onOpen() (ProUpgradeSheet) if onNavigateToMoney isn't wired, so
 *             this never dead-ends.
 *     Dismissible: yes (session)
 *
 *   urgency   isTrialActive && daysLeft <= 3 (folds in the old "last day"
 *             case — trialDaysLeft() ceils, so a sub-24h trial already reads
 *             as 1 day, which is <= 3)
 *     Copy:   "{N} days of Pro left — after that, chasing's back on you"
 *     CTA:    onOpen() — opens ProUpgradeSheet (the actual checkout surface).
 *             Previously this state called startCheckoutImmediate() directly;
 *             reverted to opening the sheet so the trader sees what they'd
 *             lose before being asked to pay.
 *     Dismissible: NO (urgency must survive a prior dismiss)
 *
 *   free      !isPro && !isTrialActive
 *     Copy:   "Get Pro — auto-chase late payers, remove OHNAR branding & see
 *             your true profit"
 *     CTA:    onOpen() — opens ProUpgradeSheet
 *     Dismissible: yes (session)
 *
 * Dismissal: only settled and free states write to sessionStorage. Urgency
 * ignores the dismiss flag so a user who dismissed early still sees the
 * day-12/13/14 nudge.
 *
 * Never shown when isPro (paid plan, not trial) — see the two early guards.
 *
 * Props:
 *   profile           — Supabase profiles row (may be null while loading)
 *   onOpen            — opens ProUpgradeSheet (urgency / free states)
 *   onNavigateToMoney — deep-links to the Money tab (settled state)
 */

import { useState } from 'react';
import { isPro, isTrialActive, trialDaysLeft } from '../lib/plan';
import { nextPillPerk } from '../lib/proPillRotation';
import Icon from './Icon';

const SESSION_KEY = 'jp.getproPillDismissed';

function isDismissed() {
  try { return !!sessionStorage.getItem(SESSION_KEY); } catch { return false; }
}

function setDismissed() {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* sessionStorage unavailable */ }
}

// Resolve which of the 3 display states applies.
// Returns: 'settled' | 'urgency' | 'free'
function resolveState(profile) {
  if (!isTrialActive(profile)) return 'free';
  return trialDaysLeft(profile) <= 3 ? 'urgency' : 'settled';
}

// Settled-state perk copy — rotated by lib/proPillRotation.js so a trader
// sees more than one Pro perk over the life of the trial.
const PERK_COPY = {
  'true-profit':   { icon: 'insights', text: 'see your true profit' },
  'remove-footer': { icon: 'sparkles', text: 'remove your footer' },
  'tax-pot':       { icon: 'tip',      text: 'see your tax pot' },
};

export default function GetProPill({ profile, onOpen, onNavigateToMoney }) {
  const [dismissed, setDismissedState] = useState(isDismissed);
  const state = resolveState(profile);
  // Only consume a rotation slot when we're actually about to show the
  // settled state — a mount that ends up free/urgency/hidden shouldn't burn
  // through the perk order. Lazy initializer → computed once per mount, so
  // the perk stays fixed for the component's lifetime ("across loads", not
  // across every re-render while the trial ticks down).
  const [perk] = useState(() => (state === 'settled' ? nextPillPerk() : null));

  // Paid Pro: never show
  if (isPro(profile) && !isTrialActive(profile)) return null;
  // Fully paid (plan=pro) never shows
  if (profile?.plan === 'pro') return null;

  // Urgency must NOT respect dismissal — it re-appears even if the user
  // dismissed during the settled window.
  const isDismissible = state === 'settled' || state === 'free';
  if (isDismissible && dismissed) return null;

  const daysLeft = trialDaysLeft(profile);
  const dayWord = daysLeft === 1 ? 'day' : 'days';

  let copy;
  let iconName;
  let pillModifier;

  switch (state) {
    case 'settled': {
      const perkCopy = PERK_COPY[perk] ?? PERK_COPY['true-profit'];
      copy = `Pro trial · ${daysLeft} ${dayWord} left — ${perkCopy.text}`;
      iconName = perkCopy.icon;
      pillModifier = 'get-pro-pill--settled';
      break;
    }
    case 'urgency':
      copy = `${daysLeft} ${dayWord} of Pro left — after that, chasing's back on you`;
      iconName = 'clock';
      pillModifier = 'get-pro-pill--urgency';
      break;
    case 'free':
    default:
      copy = 'Get Pro — auto-chase late payers, remove OHNAR branding & see your true profit';
      iconName = 'sparkles';
      pillModifier = '';
      break;
  }

  const handleDismiss = (e) => {
    e.stopPropagation();
    setDismissed();
    setDismissedState(true);
  };

  const handleTap = () => {
    // Settled deep-links to Money when wired; falls back to the upgrade
    // sheet rather than dead-ending if a caller forgets to pass it.
    if (state === 'settled' && onNavigateToMoney) {
      onNavigateToMoney();
      return;
    }
    onOpen?.();
  };

  return (
    <div className={`get-pro-pill${pillModifier ? ` ${pillModifier}` : ''}`}>
      <button
        type="button"
        className="get-pro-pill__body"
        onClick={handleTap}
        aria-label={`${copy} — tap to ${state === 'settled' ? 'view' : 'learn more'}`}
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
