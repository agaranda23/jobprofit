/**
 * PoweredByJobProfit — product-led virality attribution footer.
 *
 * Shown at the bottom of every public customer-facing page:
 *   /i/<token>  (invoice)
 *   /q/<token>  (quote)
 *   /r/<token>  (receipt)
 *
 * WHITE-LABEL (Pro perk): Pass `hidden={true}` and the component renders nothing.
 * The parent derives this from the trader's plan returned by the public-profile
 * Netlify function (fetch-public-invoice / fetch-public-receipt / fetch-public-quote-profile).
 * Free users always see the footer — it is the anchor product-led virality surface.
 *
 * COPY: The three constants below are the sole copy-edit point for all three views.
 *
 * LOGO: Currently a text wordmark. To swap in a logo image/SVG, replace
 * the <span className="pbjp-wordmark"> element. No layout changes needed.
 *
 * ATTRIBUTION: Each doc type passes its own `source` so links carry
 *   ?utm_content=<source>&utm_source=public_doc&utm_medium=footer&utm_campaign=powered_by
 * GA4 will see these params when the referred user hits the signup/auth screen.
 * Deliberately NOT `?ref=` — main.jsx's captureReferralCode() reads any `ref`
 * param matching /^[A-Za-z0-9]{1,20}$/, which the literal strings 'quote' /
 * 'invoice' / 'receipt' all satisfy. That collided with the real referral
 * program (src/lib/referral.js) — a footer-CTA tap could silently overwrite
 * (and lose) a genuine earlier referral code in sessionStorage. `utm_content`
 * folds into the existing utm_source/utm_medium/utm_campaign triplet instead
 * (button-audit fix).
 *
 * @param {{
 *   source: 'invoice' | 'quote' | 'receipt',
 *   hidden?: boolean,
 * }} props
 */

import OhnarWordmark from './OhnarWordmark';

const LABEL_TEXT = 'Sent with OHNAR — the app tradespeople use to quote, invoice and get paid';
const CTA_TEXT   = 'Try it free';

export default function PoweredByJobProfit({ source, hidden = false }) {
  if (hidden) return null;

  // Use the current origin so the link resolves to whatever domain is primary
  // (ohnar.co.uk once Netlify flips it). Falls back to ohnar.co.uk for SSR/tests.
  const base =
    typeof window !== 'undefined' ? window.location.origin : 'https://ohnar.co.uk';
  const href =
    `${base}` +
    `?utm_content=${encodeURIComponent(source)}` +
    `&utm_source=public_doc` +
    `&utm_medium=footer` +
    `&utm_campaign=powered_by`;

  return (
    <div className="pbjp-root" aria-label="Powered by OHNAR">
      <OhnarWordmark className="pbjp-wordmark" />
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
