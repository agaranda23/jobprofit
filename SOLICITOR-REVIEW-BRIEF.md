# OHNAR — Legal Pages: Brief for Solicitor Review

**Date prepared:** 4 July 2026 · **Status:** DRAFT — not live. These pages are prepared for solicitor sign-off before publication; nothing below should be treated as final until reviewed.

## 1. Company & context

- **Legal entity:** JOB PROFIT LTD, registered in England & Wales, company no. **17249792**, registered office **128 City Road, London EC1V 2NX**.
- **Trading name:** OHNAR (product/brand name; the legal entity behind it is JOB PROFIT LTD — this is stated explicitly in all three documents).
- **ICO registration:** ZC163042.
- **What the product is:** a mobile-first PWA (progressive web app, no native app store install) used by UK sole-trader/small tradespeople to quote, log jobs, invoice, chase payment, and track profit — from a phone, often on-site.
- **Data it holds, in two distinct buckets:**
  1. **The trader's own account data** (name, email, phone, business details, bank details for invoicing, VAT/UTR numbers, hourly rate) — **OHNAR is the controller** of this.
  2. **The trader's customers' data**, captured when the trader logs a job/quote/invoice (customer name, address, phone, email, job details, e-signature on quote acceptance) — **the trader is the controller**, **OHNAR is the processor**, acting only on the trader's instruction.
- **Files reviewed/updated:** `public/privacy.html`, `public/terms.html`, `public/cookies.html`, `src/components/ConsentBanner.jsx` (read only — no change needed there; see §4).

## 2. What's already been prepared (fixes made this pass)

- **Consistency:** company name/number/address/ICO number verified identical across all three documents; "Last updated" dates aligned to 4 July 2026 across all three.
- **No brand leaks found:** legal text already correctly says "OHNAR" throughout (no stray "JobProfit" references in the docs). `jobprofit.co.uk` is not referenced in these pages, so no domain-cutover cleanup was needed here.
- **Sub-processor list corrected to match what's actually live in the code** (this was the biggest gap):
  - Added **Resend** — was missing entirely. It's live in `netlify/functions/send-welcome-email.js` and `netlify/functions/accept-quote.js`, sending the welcome email and the "your quote was accepted" notification to the **trader** (not the customer). Recipient email + message content; USA; SCCs/UK Addendum.
  - Corrected the **Supabase Auth** entry: previously claimed "no separate third-party email provider is currently used," which is now false since Resend went live for some transactional email. Narrowed the Supabase Auth line to what it actually still does (sign-in magic-link/OTP emails only).
  - Added an **AWS** infrastructure note under Supabase (Supabase's Postgres/Auth/Storage run on AWS underneath).
  - Expanded the **Anthropic** entry: it's actually used for three things per the code (`netlify/functions/ai.js`, callers `voiceParse.js`, `receiptOCR.js`, `estimatorParse.js`) — voice-to-job parsing, quote/estimate generation, and receipt-photo (materials) extraction — not just "quote generation" as previously stated. Also corrected the "no customer contact details" claim: a customer's **name** can appear in a voice transcript if the trader says it aloud; no other contact detail (phone/address/email) is sent.
  - **Removed the Twilio (SMS OTP) line.** Twilio/phone-OTP login is **not built or live** anywhere in the codebase (confirmed by search) — the previous policy described it as an active sub-processor, which was inaccurate. A dev comment in the HTML flags that it should only be re-added once the feature ships and the solicitor has signed off on it (see `DATA-PROTECTION-DECISIONS-FOR-SOLICITOR.md`, "Decision 4," below).
  - Clarified the Stripe line covers both one-off payment processing and the £12/month Pro subscription billing.
- **Cookie table (cookies.html):** added a missing row for the consent-choice storage itself (`localStorage: jp.analytics_consent`) — the mechanism that remembers a user's accept/decline choice was previously undocumented. Verified the GA4/PostHog rows against the actual code (`src/lib/consent.js`, `src/lib/telemetry.js`) — accurate as previously written, no changes needed there.
- **"Manage / change your cookie choice" — added.** Two routes now exist and are documented on `cookies.html`:
  1. **In-app (signed in):** Settings → Cookie settings — this already existed (`SettingsScreen.jsx`, `CookieSettingsRow`) and lets a user flip analytics on/off with one tap at any time. No code change was needed here.
  2. **On the static cookie policy page itself (signed out / no account):** added a "Reset my cookie choice on this device" button that clears the same `jp.analytics_consent` localStorage key `src/lib/consent.js` uses, so the in-app banner asks again next time. Implemented as a small inline script (the legal pages are static passthrough files, not part of the Vite bundle, so it can't import the JS module directly — the key is hardcoded to match, with a comment flagging that it must be kept in sync if the key ever changes).

## 3. Specific decisions/sign-offs needed from you

**a) Retention periods (the big open item).** The live policy today: account data erased immediately on deletion (no grace period); unconverted leads purged ~6 months after last activity; inactive accounts purged after 36 months of no logins; financial/job records kept for the life of the account (HMRC ~6-year guidance flagged as the trader's own obligation); Stripe metadata kept up to 7 years. Separately, the founder has floated a **24-month** retention specifically for customer **contact details**, which doesn't cleanly map onto the buckets above. **We have not invented or changed any number** — we need you to reconcile these into one coherent, defensible retention model (see `DATA-PROTECTION-DECISIONS-FOR-SOLICITOR.md`, Decision 1, folded in below) before it's treated as final.

**b) Supabase region.** The policy states Supabase is hosted in `eu-west-1` (Ireland/EEA). This has **not been re-verified against the live Supabase project dashboard** as part of this pass — please have the founder confirm the actual project region before this is relied on; if it's not EU, the international-transfer section needs strengthening.

**c) Unsubscribe / marketing (Decision 2 in the memo).** All current customer-facing messages (quotes, invoices, payment reminders) are transactional, sent on the trader's instruction. Our working position is that no PECR unsubscribe mechanism is required, but the policy should perhaps offer customers an explicit **data-removal request** route instead. Please confirm this position is correct, and whether that route needs to be more visible than the current general contact-email line.

**d) Quote-acceptance consent copy (Decision 3 in the memo).** The founder wants the public quote-acceptance checkbox to state explicitly how long a customer's details are held (e.g. "held for [X], ask [trader] to remove them any time"). We have **not** written this copy or invented an "[X]" — it's gated on (a) above. Flagging it now so it's on your radar for the same review pass.

**e) Processor agreement — move from "on request" into the Terms of Service?** Today, `privacy.html` says a Data Processing Agreement (trader ↔ OHNAR, for the trader's customer data) is "available on request." **Recommendation for your consideration:** fold a baseline DPA/processor-terms clause directly into the Terms of Service that every trader accepts on signup, rather than relying on an on-request document that may never actually get requested or signed. This would strengthen the "processor operating on documented instructions" position under Art. 28 UK GDPR. Your call on whether this is worth the added ToS length now, or fine to leave as-is pre-scale.

**f) International transfers — confirm adequacy basis is correctly stated for every non-EU sub-processor.** Current basis relied on: UK adequacy (EEA/Ireland), EU-US Data Privacy Framework, and Standard Contractual Clauses / UK Addendum, applied per-processor across Stripe, Netlify, Google Analytics 4, Anthropic, and (newly added) Resend — all US-based. Please sanity-check that this general framing is still an adequate/current basis for each of these, and that we're not missing anything given how many of our sub-processors are US-incorporated.

**g) Liability and IP clauses (terms.html, §9–10).** Please review the liability cap (12 months' fees paid, or £50 minimum) and the IP/licence clause (non-exclusive, non-transferable licence to use the app; no reverse-engineering) for enforceability and completeness given this is a B2B SaaS tool used by sole traders/small businesses.

**h) Twilio / phone-OTP (Decision 4 in the memo) — not yet live, no action needed today.** Feature isn't built; the sub-processor line has been removed from the policy rather than describing something inactive. When the founder builds phone-OTP login, `DATA-PROTECTION-DECISIONS-FOR-SOLICITOR.md` (Decision 4) has the specific questions (lawful basis, consent vs. transparency-only, international transfer, retention) ready for that future review round — flagging its existence now so it's not lost.

## Reference

The founder's standing memo `DATA-PROTECTION-DECISIONS-FOR-SOLICITOR.md` (dated 5 June 2026, updated 13 June 2026) has been folded into items (a), (c), (d), and (h) above — full detail and the founder's own recommended positions are in that file if useful background.
