/**
 * PoweredByJobProfit — product-led virality attribution footer.
 *
 * Shown at the bottom of every public customer-facing page:
 *   /i/<token>  (invoice)
 *   /q/<token>  (quote)
 *   /r/<token>  (receipt)
 *
 * COPY: PRD owns the final wording. The three props below are the only strings
 * that need changing when copy is confirmed — change them here, all pages update.
 *
 * LOGO: Currently a text wordmark. To swap in a logo image/SVG later, replace
 * the <span className="pbjp-wordmark"> element with an <img> or inline SVG.
 * The surrounding layout (.pbjp-root, .pbjp-cta) requires no changes.
 *
 * ATTRIBUTION: Each doc type passes its own `source` so links carry
 *   ?ref=<source>&utm_source=public_doc&utm_medium=footer&utm_campaign=powered_by
 * PostHog will see these params when the referred user hits the signup/auth screen,
 * because AppShell reads window.location.search on mount and logTelemetry fires
 * auth_screen_viewed. For richer attribution, the landing page at getjobprofit.com
 * should forward UTM params into the Supabase auth redirect URL as custom state.
 *
 * PRO WHITE-LABEL: placeholder for V2. When the trader is Pro and has white-label
 * enabled, the parent can pass `hidden={true}` and this component renders nothing.
 * (The `hidden` prop is accepted but unused in V1 — PRD decision pending.)
 *
 * @param {{
 *   source: 'invoice' | 'quote' | 'receipt',
 *   hidden?: boolean,
 * }} props
 */

// PRD: replace these three strings when final copy is confirmed.
// Keep them here so it is one edit, not three file edits.
const LABEL_TEXT = 'Sent with JobProfit';
const CTA_TEXT   = 'Run your trade jobs from your phone — free';
const BASE_URL   = 'https://getjobprofit.com';

export default function PoweredByJobProfit({ source, hidden = false }) {
  if (hidden) return null;

  const href =
    `${BASE_URL}` +
    `?ref=${encodeURIComponent(source)}` +
    `&utm_source=public_doc` +
    `&utm_medium=footer` +
    `&utm_campaign=powered_by`;

  return (
    <div className="pbjp-root" aria-label="Powered by JobProfit">
      {/* Text wordmark — swap this element for <img src="..." alt="JobProfit" className="pbjp-logo-img" />
          or an inline SVG when the logo redesign is finalised. No layout change needed. */}
      <span className="pbjp-wordmark">JobProfit</span>
      <span className="pbjp-separator" aria-hidden="true">·</span>
      <span className="pbjp-label">{LABEL_TEXT}</span>
      <a
        href={href}
        className="pbjp-cta"
        target="_blank"
        rel="noopener noreferrer"
      >
        {CTA_TEXT}
      </a>
    </div>
  );
}
