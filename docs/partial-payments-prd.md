# Partial Payments PRD

**Status:** Reviewed — ready for implementation
**Author:** Alan Aranda + Claude (Opus 4.7)
**Date:** 14 May 2026 (reviewed same day)
**Implementation target:** half-day session (4-5 hrs)
**Predecessor:** PRDs #3 + #4 (Get Paid workflow, shipped May 2026)

---

## 1. Problem & goals

### Problem

JobProfit currently treats payment as binary: a job is either `paid` or not. Real UK tradesperson workflow involves staged payments the app cannot represent:

- 50% deposit before starting a kitchen install (£2k+ jobs)
- Cash on completion + bank transfer for the balance
- "£100 now, rest next Friday" arrangements
- Mid-job material costs covered by customer up-front

Today the user has two bad options:

1. Wait until the job is fully paid to "Mark as Paid" — but then the Awaiting card, Insights, and Outstanding totals all lie about cash position for weeks.
2. Mark as Paid early to close the job mentally — but then the system says paid when there's an outstanding balance. Worse lie.

Both options erode trust in the app's numbers. The first time a tradesperson takes a deposit and the app can't reflect it, they start running their books in a spreadsheet again — and that's the moment the app becomes "for tracking jobs that are already paid," not "for getting paid faster."

### Goals

1. **Reflect reality.** The Awaiting total on Today must match what the tradesperson is actually owed, to the penny, at any point in a job's lifecycle.
2. **Preserve history.** Every payment received is recorded with date, amount, method, optional note. Foundation for MTD positioning ("HMRC-grade records") and the future email integration roadmap.
3. **Zero regression for non-partial users.** A user who never takes partials sees no workflow change. "Mark as Paid" stays as a one-tap full-payment shortcut.
4. **No new top-level state.** State machine stays 5-state. Partial payments are a property of the `awaiting` state, not a sibling to it.

### Non-goals (v2 candidates)

- Deposit jobs (payment before completion)
- Refunds as negative payment entries (use edit/delete instead)
- Multi-currency
- Recurring/scheduled payment reminders (separate roadmap: PRD #5)
- Stripe Pay-by-Link (separate roadmap item)
- Cross-device payment sync (jobMeta is single-device; this PRD preserves)

---

## 2. Data model

### New shape on the job object

```js
// existing fields preserved
{
  id, customer, summary, amount, date, status, paymentStatus, ...

  // NEW
  payments: [
    {
      id: 'pay_<timestamp>',           // unique ID for edit/delete
      date: '2026-05-14',              // ISO date, no time
      amount: 100.00,                  // GBP, positive number
      method: 'cash' | 'bank' | 'card' | 'other',
      note: '50% deposit' | '',        // optional, freetext
      createdAt: '2026-05-14T09:30:00Z' // for audit, immutable
    },
    ...
  ]
}
```

### Derived values (NOT stored, always computed)

```js
amountPaid = payments.reduce((sum, p) => sum + p.amount, 0)
balance    = amount - amountPaid
isFullyPaid = balance <= 0
isOverpaid = balance < 0
```

Computed on every read. No caching, no denormalised fields. Source of truth is the array.

### Schema rules

- `payments` is always an array, never null. Empty array `[]` means no payments recorded yet.
- `amount` (the quote total) is unchanged from today. Don't mutate it when payments are recorded.
- `paymentStatus` is now derived from `isFullyPaid`, not stored independently. Migration handles legacy.

### jobMeta side-channel extension

Today's `src/lib/jobMeta.js` mirrors 10 PRD-3 fields per-job in `jp.jobMeta.<id>` localStorage keys. Add `payments` as the 11th. Same overlay pattern: `applyJobMetaToJobs` merges it onto cloud jobs after `mapCloudJobToToday` strips PRD-3 fields. Preserves single-device constraint.

### Migration plan

On first app load after deploy, for every job currently `paymentStatus === 'paid'` with no `payments` array:

```js
job.payments = [{
  id: 'pay_migration_' + job.id,
  date: job.paidAt || job.date,
  amount: job.amount,
  method: 'unknown',
  note: 'Pre-partial-payments migration',
  createdAt: new Date().toISOString()
}]
```

For jobs not paid: `job.payments = []`. Run once, idempotent (skip if `payments` already exists). Migration utility lives in `src/lib/migrations/partialPayments.js`, called from AppShell on mount.

---

## 3. State machine

State machine unchanged from today:

```
draft → completed → invoice_sent → awaiting → paid
```

What changes is the **transition rule for awaiting → paid:**

- **Today:** user taps "Mark as Paid" → status flips to `paid`.
- **New:** status flips to `paid` automatically when `isFullyPaid === true` after any payment is added or edited. No new user action required.

### Where payments can be recorded

Allowed from state `completed` onwards:
- ✓ `completed`
- ✓ `invoice_sent`
- ✓ `awaiting`
- ✓ `paid` (e.g., user realises they forgot a £50 cash entry — should be able to edit history)

Not allowed:
- ✗ `draft` (job hasn't been done — recording payment now creates phantom revenue)

### "Record Payment" → "Mark as Paid" shortcut behaviour

The existing big green **Mark as Paid** button on JobDetail stays. Its behaviour changes subtly:

- **Today:** sets `paymentStatus = 'paid'`, sets `paidAt = now()`.
- **New:** creates a single payment entry for the current balance, method = `'unknown'`, note = `'Marked paid via shortcut'`. Auto-flip rule then transitions status to `paid`.

A user who never touches "Record Payment" sees identical behaviour. A user who already recorded £100 partial and then taps "Mark as Paid" gets a second payment entry for the remaining £150, and the status flips. No regression, no surprise.

### Edge cases

| Case | Behaviour |
|---|---|
| Overpayment (£260 on £250) | Allow. Show "Overpaid by £10" badge on JobDetail. Status flips to `paid`. |
| Payment edited to make balance > 0 again | Status flips back to `awaiting`. AwaitingCard reappears. |
| Payment deleted to make balance > 0 again | Same as above — flip back to `awaiting`. |
| All payments deleted | balance = amount, status = `awaiting` if invoice was sent, else previous state. |
| Recording payment on a `paid` job | Allowed. amountPaid increases, isOverpaid becomes true, badge appears. |

---

## 4. UI surfaces

### 4.1 New: Record Payment Modal

Triggered from JobDetail (button below "Mark as Paid") and from AwaitingCard quick-action.

**Fields:**
- **Amount** — number input, prefilled with current balance (max overpayment allowed but warned via copy "This is more than the balance of £X")
- **Date** — date picker, default today
- **Method** — segmented control: Cash / Bank / Card / Other
- **Note** — optional text input, placeholder "e.g. 50% deposit"

**Buttons:** Cancel / Save Payment

**Validation:** amount > 0, date not in future, method required, note optional.

**On save:** append to `payments[]` via jobMeta side-channel write, re-render. If `isFullyPaid` now → status auto-flips to `paid`, show "Job marked paid" confirmation toast.

### 4.2 JobDetail header — payment summary block

New block between the existing financial summary and the action buttons.

**Layout (when balance > 0):**

```
┌─────────────────────────────────────────────┐
│  Received: £100.00       Balance: £150.00   │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░  40%   │
│                                              │
│  [Record Payment]    [Mark as Paid]         │
└─────────────────────────────────────────────┘
```

**Layout (when fully paid):**

```
┌─────────────────────────────────────────────┐
│  ✓ Paid in full: £250.00                    │
│  Last payment 14 May 2026 (bank transfer)   │
│                                              │
│  [Add another payment]                       │
└─────────────────────────────────────────────┘
```

**Layout (overpaid):**

```
┌─────────────────────────────────────────────┐
│  ✓ Paid in full: £260.00 (£10 overpaid)     │
│  ...                                         │
└─────────────────────────────────────────────┘
```

### 4.3 JobDetail — payment history list

Below the summary block, a collapsible list of all payments recorded against the job. Default collapsed if >1 entry, expanded if exactly 1.

**Each entry:**

```
14 May 2026  ·  £100.00  ·  cash         [edit] [delete]
            "50% deposit"
```

**Tap entry → edit modal** (same shape as Record Payment, prefilled).
**Tap delete → confirm prompt** "Delete this £100 payment? The balance will increase to £250."

### 4.4 AwaitingCard (TodayScreen)

Today:
```
Sarah Mitchell — £250.00 owed
```

New:
```
Sarah Mitchell — £150.00 of £250 owed
```

Only show the "X of Y" form when `amountPaid > 0`. If no payments, keep today's single-figure copy.

### 4.5 Today screen Outstanding total

Today: sum of `amount` for all `awaiting` jobs.
New: sum of `balance` (i.e., amount − amountPaid) for all `awaiting` jobs.

This is the change that makes the headline number honest. Any partial payment recorded against an awaiting job immediately reduces Outstanding on Today.

### 4.6 Insights — Earned total

Today: sum of `amount` for all `paid` jobs.
New: sum of `amountPaid` across ALL jobs (paid + awaiting + completed + invoice_sent).

This too becomes more honest — every quid in the door is counted, regardless of whether the job is fully closed.

### 4.7 Invoice PDF

When generating an invoice PDF on a job with payments recorded, add a payment history section above the totals:

```
Payments received:
  14 May 2026  £100.00  (cash)
  20 May 2026  £50.00   (bank transfer)
                ────────
Total received: £150.00
Balance due:    £100.00
```

### 4.8 WhatsApp invoice message

When sending an invoice via WhatsApp on a job with payments recorded, the message body adds:

```
📄 Invoice: JP-0042
🔨 Work: Boiler service
💷 Total: £250.00
💷 Received: £100.00
💷 Balance: £150.00
📅 Due: 26 May 2026
```

Only adds the Received/Balance lines if `amountPaid > 0`.

### 4.9 StatusBadge

No changes. Continues to show `awaiting` while balance > 0, `paid` when balance ≤ 0. The "X of Y" nuance lives in copy, not in the badge — as decided in Section 3.

---

## 5. Implementation phases

### Phase A — Data layer (~1.5 hrs)

1. Extend `src/lib/jobMeta.js` to read/write `payments` array.
2. New `src/lib/payments.js` with helpers: `addPayment`, `editPayment`, `deletePayment`, `computeAmountPaid`, `computeBalance`, `isFullyPaid`, `isOverpaid`.
3. New `src/lib/migrations/partialPayments.js` — one-off backfill on AppShell mount.
4. Update `mapCloudJobToToday` in `src/lib/store.js` to surface `payments` via overlay (preserve PRD-3 strip pattern).
5. Vitest unit tests for the helpers + migration. Target: 100% coverage on payments.js because it's money logic.

**Commit boundary:** Phase A is one PR. No UI yet, but tests prove the data model works.

### Phase B — Record Payment Modal + JobDetail block (~1.5 hrs)

1. New `src/components/RecordPaymentModal.jsx`.
2. New `src/components/PaymentSummaryBlock.jsx` (the "Received / Balance / progress bar" block).
3. New `src/components/PaymentHistoryList.jsx` (the per-entry list with edit/delete).
4. Wire into `src/App.jsx` JobDetail.
5. Wire auto-flip rule: after add/edit/delete, recompute `isFullyPaid`, transition status if needed.

**Commit boundary:** Phase B is one PR. Behind a feature flag if needed, but ideally shipped directly since Phase A migration is already idempotent.

### Phase C — TodayScreen + Insights + Invoice integration (~1 hr)

1. Update AwaitingCard copy to "X of Y" form.
2. Update Today Outstanding total to sum balances.
3. Update Insights Earned total to sum amountPaid.
4. Update `src/lib/invoicePDF.js` to render payment history section.
5. Update `src/lib/invoiceMessage.js` WhatsApp body for Received/Balance lines.

**Commit boundary:** Phase C is one PR or two — invoice surfaces could split off if they balloon.

### Total: 3 PRs, 4-5 hrs. Each PR independently shippable.

---

## 6. Resolved decisions (Section 6 from draft, resolved 14 May 2026)

These were the open product questions in the draft. All six are now resolved.

1. **Method = `'unknown'` for migration entries and shortcut "Mark as Paid"** ✅ **Agreed.** Forcing a method on the one-tap shortcut would break the "zero regression" goal. MTD/analytics features later will need to handle an `unknown` bucket.

2. **Payment dates: past-or-today only** ✅ **Agreed.** Future-dated payments are conceptually weird and the real "expected future payment" use case is PRD #5 (scheduling/reminders) territory. The date picker should hard-block future dates.

3. **Delete confirmation copy: specific balance text** ✅ **Agreed.** Use: "Delete this £100 payment? The balance will increase to £250." Specific consequence text reduces accidental deletes more than generic "cannot be undone" warnings, and frames the consequence in the tradesperson's actual mental model (the balance number).

4. **Insights "Earned" semantic change: redefine + one-time tooltip** ⚙️ **Decided (option b).** Change Earned to mean "all cash received" across all jobs. Add a one-time tooltip on first load post-deploy: *"Earned now includes partial payments received against open jobs, not just fully paid jobs. This number reflects all cash received."* Tooltip dismissible, stored as `jp.tooltipSeen.earnedRedefined = true` in localStorage. **Implementation note:** if usage data later shows confusion (support tickets, drop-off in Insights views), revisit option (a) — keep Earned as fully-paid total + add a separate "Received" metric. For now, simpler one-number Insights wins.

5. **Overpayment UI: surface as a badge** ⚙️ **Decided.** When a job is paid above its quote total, show "£X overpaid" inline next to the "Paid in full" copy. Neutral phrasing, not an error. Helps the user catch data entry mistakes (£260 typed when £25 meant) without being alarming. Same badge in JobDetail header summary block AND in payment history list (the offending entry highlighted).

6. **WhatsApp invoice auto-resend on partial payment: no auto-send** ⚙️ **Decided.** Recording a payment never auto-triggers a WhatsApp message. Users manually tap "Resend invoice" if they want to send an updated copy to the customer. Future enhancement (post-v1): a "Send receipt confirmation" toggle in the Record Payment modal — useful but not v1. Auto-messaging on every payment would be annoying for the end customer and removes user control.

---

## 7. Success criteria

PRD is shipped successfully when:

- A user takes a £100 deposit on a £250 kitchen job — JobDetail shows "£100 received / £150 balance", Today Outstanding drops by £100, Insights Earned rises by £100, AwaitingCard reads "£150 of £250 owed".
- They later mark the remaining £150 paid — status auto-flips to `paid`, AwaitingCard disappears, Earned reflects the full £250.
- A user who never uses partials taps "Mark as Paid" on a £250 job — single payment entry of £250 cash is created, status flips, identical behaviour to today.
- A user who recorded the wrong amount (£200 instead of £20) edits the entry — balance recomputes, status flips back to `awaiting` if needed.
- The migration runs once on every device, idempotent, doesn't double-count.

---

## 8. Out-of-scope follow-ups (post-ship)

After v1 lands, watch for these signals to decide v2 priorities:

- **Deposit jobs** — count of users who manually create a "deposit" payment on a draft job (currently blocked). If >10% of users try this, build it properly.
- **Refunds** — count of users who delete a payment entry citing a refund. If meaningful, ship negative-payment entries.
- **Payment method analytics** — once we have 30+ days of data, see if cash/bank/card/other split surfaces interesting patterns to show in Insights.
- **Email integration** — Stripe receipt email → parse → propose payment entry. Connects to the broader email-integration roadmap.
- **MTD positioning** — partial payments make "Tax Ready: X%" actually computable. Worth a marketing pass.

---

*End of PRD.*
