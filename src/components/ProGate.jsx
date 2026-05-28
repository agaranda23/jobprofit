/**
 * ProGate — wraps a card in a locked-preview treatment for free users.
 *
 * When `locked` is false (user is Pro) the children render normally.
 * When `locked` is true, children render at full size but only the
 * `.pro-gate__figure` node receives a CSS blur, and a one-line upgrade
 * prompt is shown underneath the blurred figure.
 *
 * Usage:
 *
 *   <ProGate locked={!isPro(profile)} onUpgrade={onUpgrade}>
 *     <div className="money-card money-insight">
 *       <div className="money-insight__label">Est. Profit/Hour</div>
 *       <div className="money-insight__value pro-gate__figure">£42</div>
 *     </div>
 *   </ProGate>
 *
 * The caller must add the `pro-gate__figure` class to whichever element
 * contains the sensitive number. Everything else renders un-blurred.
 *
 * onUpgrade: called when the "Start free trial" button is tapped.
 *   - Wire to your paywall entry point.
 *   - If no upgrade flow exists yet, the button is still rendered as a
 *     placeholder (onUpgrade is optional; missing it is a no-op).
 */
export default function ProGate({ locked, onUpgrade, children }) {
  if (!locked) return children;

  return (
    <div className="pro-gate" aria-label="Pro feature — upgrade to see this">
      <div className="pro-gate__inner">
        {children}
        <div className="pro-gate__lock" aria-hidden="true">&#x1F512;</div>
      </div>
      <div className="pro-gate__prompt">
        <span className="pro-gate__prompt-copy">
          See your tax pot &amp; true hourly profit &mdash; £12/mo
        </span>
        <button
          type="button"
          className="pro-gate__trial-btn"
          onClick={() => onUpgrade?.()}
        >
          Start free trial
        </button>
      </div>
    </div>
  );
}
