/**
 * nextStepContent.js — Pure stage→content mapping for the Next Step hero card.
 *
 * No side effects, no imports, no DOM — pure data transformation.
 * This is the single source of truth for:
 *   headline   – the card's action-oriented title
 *   primaryCta – { label, action } for the main button
 *   microCtas  – up to two [{ label, action }] secondary text buttons
 *
 * Action strings are symbolic tokens that JobDetailDrawer resolves to real
 * handler functions. This keeps the mapping testable without React.
 *
 * Supported action tokens:
 *   'sendQuoteLink'      – handleSendLink()
 *   'openInvoiceModal'   – setInvoiceModalOpen(true)
 *   'openPaymentModal'   – setPaymentModalOpen(true)
 *   'handleChase'        – handleChase() (WhatsApp chase link)
 *   'openReceiptModal'   – setReceiptModalOpen(true)
 *   'openPhotoInput'     – photoInputRef.current?.click()
 *   'openSigPad'         – setSigPadOpen(true)
 *   'editPrice'          – setEditingField('amount')
 *   'editLineItems'      – handleToggleLiEdit()
 *   'viewProfitBreakdown'– scroll to ProfitBarSection (no-op scroll; card is its own prompt)
 *   'noop'               – no handler (read-only label)
 *
 * Stage derivation uses deriveDisplayStatus() from lib/jobStatus — caller passes
 * the output of that function (a string) plus enrichment args.
 */

/**
 * Returns the tier label used in CTA copy.
 * Tier 1 = light, Tier 2 = firm, Tier 3 = final.
 *
 * @param {number} tier
 * @returns {string}
 */
export function tierCtaLabel(tier) {
  if (tier >= 3) return 'Send final reminder';
  if (tier >= 2) return 'Send firm follow-up';
  return 'Send payment reminder';
}

/**
 * Returns the overdue headline copy for a given customer first name and
 * days overdue. Falls back to "the customer" when name is blank.
 *
 * @param {string} customerFirstName
 * @param {number} daysOverdue
 * @returns {string}
 */
export function overdueHeadline(customerFirstName, daysOverdue) {
  const name = customerFirstName || 'the customer';
  if (daysOverdue <= 0) return `Chase ${name} — invoice due`;
  if (daysOverdue === 1) return `Chase ${name} — 1 day overdue`;
  return `Chase ${name} — ${daysOverdue} days overdue`;
}

/**
 * Derives the content for the Next Step hero card from the job's current state.
 *
 * Returns an object:
 *   {
 *     headline:   string,
 *     primaryCta: { label: string, action: string },
 *     microCtas:  [{ label: string, action: string }],  // 0–2 items
 *   }
 *
 * Returns null when no next-step card should be shown (job is Paid).
 *
 * @param {{
 *   status: string,          // output of deriveStatus()
 *   isPaid: boolean,
 *   isInvoiced: boolean,
 *   isQuoteAccepted: boolean,
 *   isQuoteSent: boolean,
 *   isQuoteDeclined: boolean,
 *   showChase: boolean,
 *   chaseBlocked: boolean,
 *   tier: number,
 *   daysOverdue: number,
 *   customerFirstName: string,
 *   profit: number|null,
 * }} params
 * @returns {{ headline: string, primaryCta: { label: string, action: string }, microCtas: Array }|null}
 */
export function deriveNextStepContent({
  status,
  isPaid,
  isInvoiced,
  isQuoteAccepted,
  isQuoteSent,
  isQuoteDeclined = false,
  showChase,
  chaseBlocked,
  tier,
  daysOverdue,
  customerFirstName,
  profit,
}) {
  // Paid — no next step card
  if (isPaid) {
    const profitStr = profit != null && profit >= 0 ? `£${profit.toFixed(0)}` : null;
    const headline = profitStr ? `Job complete · ${profitStr} profit` : 'Job complete';
    return {
      headline,
      primaryCta: { label: 'View profit breakdown', action: 'viewProfitBreakdown' },
      microCtas: [],
    };
  }

  // Invoiced / Overdue — chase or record payment
  if (isInvoiced) {
    if (showChase) {
      const headline = (status === 'Overdue' || daysOverdue > 0)
        ? overdueHeadline(customerFirstName, daysOverdue)
        : 'Awaiting payment';
      const primaryLabel = chaseBlocked ? 'Chased recently' : tierCtaLabel(tier);
      return {
        headline,
        primaryCta: { label: primaryLabel, action: chaseBlocked ? 'noop' : 'handleChase' },
        microCtas: [
          { label: 'Record payment', action: 'openPaymentModal' },
        ],
      };
    }
    // No phone — record payment is the only action
    return {
      headline: 'Awaiting payment',
      primaryCta: { label: 'Record payment', action: 'openPaymentModal' },
      microCtas: [],
    };
  }

  // Quote accepted — job is on, send invoice
  if (isQuoteAccepted) {
    return {
      headline: 'Job\'s on — send the invoice',
      primaryCta: { label: 'Send invoice', action: 'openInvoiceModal' },
      microCtas: [
        { label: 'Log receipt', action: 'openReceiptModal' },
        { label: 'Add photo', action: 'openPhotoInput' },
      ],
    };
  }

  // Quote declined by customer — prompt trader to reopen or adjust
  if (isQuoteDeclined) {
    return {
      headline: 'Quote declined',
      primaryCta: { label: 'Resend quote', action: 'sendQuoteLink' },
      microCtas: [
        { label: 'Edit price', action: 'editPrice' },
      ],
    };
  }

  // Quote sent, awaiting acceptance
  if (isQuoteSent) {
    const name = customerFirstName || 'the customer';
    return {
      headline: `Awaiting ${name}'s go-ahead`,
      primaryCta: { label: 'Resend quote', action: 'sendQuoteLink' },
      microCtas: [
        { label: 'Mark accepted manually', action: 'openSigPad' },
      ],
    };
  }

  // Lead — quote not yet sent
  return {
    headline: 'Send the quote',
    primaryCta: { label: 'Send quote', action: 'sendQuoteLink' },
    microCtas: [
      { label: 'Edit price', action: 'editPrice' },
      { label: 'Edit line items', action: 'editLineItems' },
    ],
  };
}
