import React from 'react';

/**
 * NextStepCard — "Next step" hero card for the Job Detail Drawer.
 *
 * Sits at the top of the drawer content area, above all other sections.
 * Replaces the bottom-anchored stateful primary CTA that previously lived in
 * the job-detail-cta-row block.
 *
 * PRD spec: Design A (Loop View) MVP cut — Page 2 + Page 5 callout of
 * prd-job-profile-redesign-cofounder-brief-2026-05-30.html
 *
 * Props:
 *   content   – { headline, primaryCta: { label, action }, microCtas: [...] }
 *               as returned by deriveNextStepContent() from lib/nextStepContent.js
 *   handlers  – map of action-token → function, resolved by JobDetailDrawer
 *   isPaid    – when true, renders the green "complete" variant
 */
export default function NextStepCard({ content, handlers, isPaid = false }) {
  if (!content) return null;

  const { headline, primaryCta, microCtas = [] } = content;

  const fireAction = (action) => {
    const fn = handlers?.[action];
    if (typeof fn === 'function') fn();
  };

  const isPrimaryDisabled =
    primaryCta.action === 'noop' ||
    primaryCta.label === 'Chased recently';

  return (
    <div className={`nsc-card${isPaid ? ' nsc-card--paid' : ''}`}>
      <span className="nsc-label">Next step</span>
      <p className="nsc-headline">{headline}</p>

      <button
        type="button"
        className={`nsc-primary-btn${isPrimaryDisabled ? ' nsc-primary-btn--disabled' : ''}`}
        onClick={() => fireAction(primaryCta.action)}
        disabled={isPrimaryDisabled}
        aria-disabled={isPrimaryDisabled}
      >
        {primaryCta.label}
      </button>

      {microCtas.length > 0 && (
        <div className="nsc-micro-row">
          {microCtas.map(({ label, action }) => (
            <button
              key={action}
              type="button"
              className="nsc-micro-btn"
              onClick={() => fireAction(action)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
