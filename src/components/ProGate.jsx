/**
 * ProGate — per-card locked-preview chrome for free users.
 *
 * Responsibilities (intentionally narrow):
 *   - When locked AND hasValue: blur `.pro-gate__figure` children and show a
 *     small corner lock badge (top-right). Never overlaps body text.
 *   - When locked AND !hasValue (empty/setup state): render children plain —
 *     the setup prompt is useful to everyone and must not look locked.
 *   - When !locked (Pro user): render children plain, no chrome.
 *
 * The upgrade CTA (UpgradeBanner) is NOT rendered here. FinanceScreen renders
 * it once, at the top of the gated section, so it never repeats per-card.
 *
 * Props:
 *   locked     — true when the viewing user is on the free plan
 *   hasValue   — true when the card has a real number to protect (default: true)
 *                Pass false when the card is in its empty/setup state.
 *   onUpgrade  — optional callback; when provided the lock badge becomes a button
 *                that calls this to open ProUpgradeSheet (trigger='insight_locked')
 *   children   — card content; add `pro-gate__figure` to the number element
 */
export default function ProGate({ locked, hasValue = true, onUpgrade, children }) {
  if (!locked || !hasValue) return children;

  return (
    <div className="pro-gate" aria-label="Pro feature — upgrade to see this">
      <div className="pro-gate__inner">
        {children}
        {onUpgrade ? (
          <button
            type="button"
            className="pro-gate__lock-badge pro-gate__lock-badge--btn"
            onClick={onUpgrade}
            aria-label="Upgrade to Pro to unlock this"
          >
            <span className="pro-gate__lock-icon">&#x1F512;</span>
            <span className="pro-gate__lock-label">Pro</span>
          </button>
        ) : (
          <div className="pro-gate__lock-badge" aria-hidden="true">
            <span className="pro-gate__lock-icon">&#x1F512;</span>
            <span className="pro-gate__lock-label">Pro</span>
          </div>
        )}
      </div>
    </div>
  );
}
