/**
 * chaseLadder.js — Per-job chase state + tiered WhatsApp message templates.
 *
 * State is mirrored to Supabase (job_chase_states) for cross-device persistence,
 * with localStorage as the instant-feedback + offline fallback. The cloud path
 * degrades gracefully: if the table doesn't exist yet (migration pending) or any
 * cloud operation fails, the error is swallowed with console.warn and localStorage
 * continues to be the source of truth for the current session.
 *
 * localStorage key: jobprofit:chases:v1
 * Value shape: { [jobId]: { count, lastChasedAt, firstChasedAt } }
 *
 * Cloud table: job_chase_states (user_id, job_id, chase_count, last_chased_at, first_chased_at)
 * RLS: SELECT/INSERT/UPDATE/DELETE scoped to auth.uid() = user_id.
 *
 * Tier is keyed off DAYS PAST DUE DATE (not chase count/lastChasedAt):
 *   Tier 0  — pre-due (heads-up bar when due in 1-2 days)
 *   'grace' — Day 7: flipped Overdue but within 24h silent window (no chase CTA)
 *   Tier 1  — 1–6 days overdue  (light; Day 8 is first prompt)
 *   Tier 2  — 7–13 days overdue (firm)
 *   Tier 3  — 14+ days overdue  (final / heavy)
 *
 * B2C/B2B (Tier 3 only): defaults to B2C. No customer-type tag exists on jobs
 * yet — a "business customer" field is a FAST-FOLLOW needed to unlock the B2B
 * legal copy. Until then, B2B is never emitted. See FLAG below.
 *
 * FLAG — fast-follow required to unlock B2B copy:
 *   Add a boolean field (e.g. job.isBusinessCustomer or customer.isB2B) and
 *   pass it into buildChaseMessage as `isB2B: true`. Until that field exists,
 *   this lib hard-defaults to B2C at Tier 3. The statutory-interest B2B copy
 *   must never reach a homeowner.
 *
 * FLAG — {payment_details} storage:
 *   biz.accountName + biz.sortCode + biz.accountNumber OR biz.bankDetails
 *   (see invoiceMessage.js for the canonical pattern). If none are set on the
 *   biz object WorkScreen receives, the clause is omitted from the message
 *   cleanly — no action needed to ship; add a "Add bank details" prompt in a
 *   follow-up Settings nudge.
 */

const STORAGE_KEY = 'jobprofit:chases:v1';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DOUBLE_SEND_WINDOW_MS = 48 * 60 * 60 * 1000; // 48-hour suppression window

/**
 * Default payment terms used when no explicit invoiceDueDate is set on a job.
 * Imported by WorkScreen (isOverdue fallback) so chaseLadder and WorkScreen
 * can never drift independently. Change this constant to shift the net-N
 * default across the whole app.
 */
export const DEFAULT_PAYMENT_TERMS_DAYS = 7;

// ── localStorage helpers ──────────────────────────────────────────────────

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Safari incognito / storage full — silently skip
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns { count, lastChasedAt, firstChasedAt } for the job, or null if
 * it has never been chased.
 */
export function getChaseState(jobId) {
  if (!jobId) return null;
  const store = readStore();
  return store[jobId] ?? null;
}

/**
 * Records a chase tap for the given job.
 * Increments count, updates lastChasedAt, sets firstChasedAt on first tap.
 */
export function recordChase(jobId) {
  if (!jobId) return;
  const store = readStore();
  const now = new Date().toISOString();
  const existing = store[jobId];
  store[jobId] = {
    count: existing ? existing.count + 1 : 1,
    lastChasedAt: now,
    firstChasedAt: existing ? existing.firstChasedAt : now,
  };
  writeStore(store);
}

/**
 * Removes the chase record for the job. Called when Mark Paid fires.
 */
export function clearChase(jobId) {
  if (!jobId) return;
  const store = readStore();
  delete store[jobId];
  writeStore(store);
}

/**
 * Returns true if a chase was recorded within the last 48 hours.
 * Used to disable the Chase button and show "Chased today".
 *
 * @param {string} jobId
 * @param {Date} [_now]
 * @returns {boolean}
 */
export function isDoubleSendBlocked(jobId, _now = new Date()) {
  const state = getChaseState(jobId);
  if (!state?.lastChasedAt) return false;
  return (_now - new Date(state.lastChasedAt)) < DOUBLE_SEND_WINDOW_MS;
}

// ── Tier logic ────────────────────────────────────────────────────────────

/**
 * Calculates days past the invoice due date.
 *
 * Priority: invoiceDueDate → invoiceSentAt + DEFAULT_PAYMENT_TERMS_DAYS (net-7 fallback,
 * mirrors isOverdue() in WorkScreen). Returns negative for pre-due jobs,
 * 0 for due-today, positive for overdue.
 *
 * @param {object} job
 * @param {Date} [_now]
 * @returns {number}
 */
export function daysPastDue(job, _now = new Date()) {
  if (!job) return 0;
  let dueDate;

  if (job.invoiceDueDate) {
    dueDate = new Date(job.invoiceDueDate);
    dueDate.setHours(0, 0, 0, 0);
  } else if (job.invoiceSentAt) {
    dueDate = new Date(job.invoiceSentAt);
    dueDate.setHours(0, 0, 0, 0);
    dueDate.setDate(dueDate.getDate() + DEFAULT_PAYMENT_TERMS_DAYS); // net-7 default
  } else {
    return 0;
  }

  const today = new Date(_now);
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - dueDate) / MS_PER_DAY);
}

/**
 * Returns days until the invoice is due (positive = future, 0 = due today, negative = past).
 * Mirrors daysPastDue with sign flipped for pre-due display use.
 *
 * @param {object} job
 * @param {Date} [_now]
 * @returns {number}
 */
export function daysUntilDue(job, _now = new Date()) {
  // Using Math.trunc to avoid returning -0 when daysPastDue returns 0 (due today).
  const dpd = daysPastDue(job, _now);
  return dpd === 0 ? 0 : -dpd;
}

/**
 * Computes the chase tier from the job's overdue age.
 * Tier is driven by days-past-due only. chase count/lastChasedAt are used
 * exclusively by isDoubleSendBlocked (48h suppression window).
 *
 * Tier 0  — pre-due (daysPastDue < 0)
 * 'grace' — daysPastDue in [0, 1): just flipped Overdue, 24h silent window.
 *           Stage tile reads Overdue; chase bar stays silent. Non-actionable.
 * Tier 1  — daysPastDue in [1, 7)  — light nudge (Day 8 is first chase prompt)
 * Tier 2  — daysPastDue in [7, 14) — firm follow-up
 * Tier 3  — daysPastDue >= 14      — final / heavy
 *
 * Callers must handle 'grace' as a non-actionable sentinel — never pass it
 * directly to buildChaseMessage (which expects a numeric tier 0-3).
 *
 * @param {object} job
 * @param {Date} [_now]
 * @returns {number|'grace'}
 */
export function computeTier(job, _now = new Date()) {
  const days = daysPastDue(job, _now);
  if (days >= 14) return 3;
  if (days >= 7) return 2;
  if (days >= 1) return 1;
  if (days >= 0) return 'grace'; // just flipped Overdue — 24h silent window
  return 0; // pre-due
}

// ── Customer name helper ──────────────────────────────────────────────────

/**
 * Resolves a clean first-name-only greeting name from a job.
 *
 * Regression guard (2026-07-03): call sites used to fall back to job.name
 * (the JOB TITLE, e.g. "New doors") when job.customer was blank, and passed
 * whatever was left in customer/customerName straight through unsplit — so a
 * customer surname or a job title could bleed into the greeting (reported as
 * "Hi Sam doors"). Mirrors the `.split(' ')[0]` convention already used by
 * quoteMessage.js / invoiceMessage.js. Never falls back to job.name/summary —
 * those are JOB fields, not a person's name; buildChaseMessage's own 'there'
 * fallback handles the blank case.
 *
 * @param {object} job
 * @returns {string}
 */
export function chaseCustomerFirstName(job) {
  return (job?.customer || job?.customerName || '').split(' ')[0] || '';
}

// ── Payment details helper ────────────────────────────────────────────────

/**
 * Assembles a payment details string from the biz object, matching the
 * pattern in invoiceMessage.js. Returns empty string when nothing is set —
 * the clause is omitted from chase messages cleanly.
 *
 * @param {object|null} biz
 * @returns {string}
 */
export function buildPaymentDetails(biz) {
  if (!biz) return '';
  if (biz.accountName || biz.sortCode || biz.accountNumber) {
    const parts = [];
    if (biz.accountName) parts.push(`Pay to: ${biz.accountName}`);
    if (biz.sortCode) parts.push(`Sort code: ${biz.sortCode}`);
    if (biz.accountNumber) parts.push(`Account: ${biz.accountNumber}`);
    return parts.join(' · ');
  }
  if (biz.bankDetails) return biz.bankDetails;
  if (biz.paymentLink) return biz.paymentLink;
  return '';
}

// ── Message builder ───────────────────────────────────────────────────────

/**
 * Formats an ISO date string or Date to en-GB short form (e.g. "12 Jun 2025").
 */
function fmtDate(raw) {
  if (!raw) return '';
  try {
    const d = typeof raw === 'string' && raw.length === 10
      ? new Date(raw + 'T00:00:00')
      : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return String(raw);
  }
}

/**
 * Builds the approved tiered chase message.
 *
 * Approved copy: founder sign-off 2026-05-30. Refreshed 2026-07-03 (warmer
 * tone pass) — added the "if you've already paid, ignore this" disclaimer to
 * every overdue tier (1/2/3, B2B included) so a chase can never read as
 * pestering a customer who has already paid but whose payment the trader
 * hasn't logged yet (a real race — bank transfers land before the trader
 * marks the job Paid). customerName is now split to first-name-only inside
 * this function (defense in depth — see chaseCustomerFirstName for the
 * call-site fix to the root cause).
 *
 * Omission rules (clean degradation):
 *   - {jobSummary}       -> omitted (with surrounding parens) when blank
 *   - {invoiceNumber}    -> "invoice {number}" when present, else "the invoice"
 *   - {paymentDetails}   -> clause omitted entirely when blank
 *   - {businessName}     -> falls back to '' (no trailing newline emitted)
 *   - part-pay prefix    -> applied to Tier 2 AND Tier 3 when amountPaid > 0
 *   - isB2B              -> hard-defaults false; B2B legal copy never emitted
 *                          without an explicit customer tag (see lib flags)
 *
 * @param {{
 *   customerName?: string,
 *   amount: string,
 *   jobSummary?: string,
 *   invoiceNumber?: string,
 *   dueDate?: string|Date,
 *   daysOverdue?: number,
 *   tier: number,
 *   amountPaid?: number,
 *   paymentDetails?: string,
 *   businessName?: string,
 *   isB2B?: boolean,
 * }} params
 * @returns {string}
 */
export function buildChaseMessage({
  customerName,
  amount,
  jobSummary = '',
  invoiceNumber = '',
  dueDate,
  daysOverdue = 0,
  tier,
  amountPaid = 0,
  paymentDetails = '',
  businessName = '',
  isB2B = false,
}) {
  const name = (customerName || '').split(' ')[0] || 'there';
  const jobClause = jobSummary ? ` (${jobSummary})` : '';
  const invoiceRef = invoiceNumber ? `invoice ${invoiceNumber}` : 'the invoice';
  const dueDateStr = dueDate ? fmtDate(dueDate) : '';
  const payLine = paymentDetails ? `\n\n${paymentDetails}` : '';
  const bizLine = businessName ? `\n\n${businessName}` : '';
  const alreadyPaidLine = "If you've already paid, thank you — please ignore this message.";

  const partPayPrefix = amountPaid > 0 ? `Thanks for the £${amountPaid} — ` : '';

  const effectiveTier = Math.min(Math.max(tier, 0), 3);

  switch (effectiveTier) {
    case 0: {
      // Tier 0: pre-due heads-up — surfaces in amber bar when due in 1-2 days.
      // Not overdue yet, so no "already paid" disclaimer needed here.
      const duePart = dueDateStr ? ` is due on ${dueDateStr}` : '';
      return `Hi ${name} 👋\n\nQuick heads-up — ${invoiceRef} for ${amount}${jobClause}${duePart}. No action needed yet, just wanted it on your radar.${payLine}${bizLine}`;
    }

    case 1: {
      // Tier 1: light nudge — 1-6 days overdue (Day 8 is first prompt post-grace)
      const landedPart = dueDateStr ? ` — it was due ${dueDateStr}` : '';
      return `Hi ${name} 👋\n\nJust a friendly reminder that ${invoiceRef} for ${amount}${jobClause} is still outstanding${landedPart}. ${alreadyPaidLine} If not, let me know if you need me to resend anything.${payLine}${bizLine}`;
    }

    case 2: {
      // Tier 2: firm follow-up — 7-13 days overdue
      return `${partPayPrefix}Hi ${name} 👋\n\nJust following up on ${invoiceRef} for ${amount}${jobClause} — it's now ${daysOverdue} days overdue. ${alreadyPaidLine} If not, could you let me know when you're expecting to get that across?${payLine}${bizLine}`;
    }

    case 3: {
      // Tier 3-B2B (statutory-interest copy) — guarded; isB2B must be
      // explicitly true. Hard-defaults to B2C until a customer tag ships.
      if (isB2B) {
        const payInline = paymentDetails ? ` to ${paymentDetails}` : '';
        return `${partPayPrefix}Hi ${name},\n\nThis is a final reminder that ${invoiceRef} for ${amount}${jobClause} is now ${daysOverdue} days overdue. Under the Late Payment of Commercial Debts Act 1998 interest and compensation may now apply. If you've already paid, please disregard this notice — otherwise, please arrange payment${payInline} or contact me today. If I don't receive payment or a confirmed date by end of this week I'll be taking further steps.${bizLine}`;
      }
      // Tier 3-B2C (homeowner / DEFAULT)
      return `${partPayPrefix}Hi ${name} 👋\n\nlast one from me on this — ${invoiceRef} for ${amount}${jobClause} is now ${daysOverdue} days overdue. ${alreadyPaidLine} If there's a problem at your end, give me a ring and we'll sort it. If I don't hear back this week I'll need to follow this up more formally.${payLine}${bizLine}`;
    }

    default:
      return `Hi ${name} 👋\n\nJust a reminder that ${invoiceRef} for ${amount}${jobClause} is outstanding. ${alreadyPaidLine} If not, please let me know when payment is on the way.${payLine}${bizLine}`;
  }
}

// ── Link builder ──────────────────────────────────────────────────────────

/**
 * Builds the wa.me deep-link URL for the given phone + tier.
 * Returns null when no phone number is present.
 * The user reviews the message in the WhatsApp share sheet before tapping send —
 * the app never sends autonomously.
 *
 * @param {{
 *   phone: string,
 *   customerName?: string,
 *   amount: string,
 *   jobSummary?: string,
 *   invoiceNumber?: string,
 *   dueDate?: string|Date,
 *   daysOverdue?: number,
 *   tier: number,
 *   amountPaid?: number,
 *   paymentDetails?: string,
 *   businessName?: string,
 *   isB2B?: boolean,
 *   payNowUrl?: string,
 * }} params
 * @returns {string|null}
 */
export function buildChaseLink({ phone, ...msgParams }) {
  const cleaned = (phone || '').replace(/\s/g, '').replace(/^0/, '44').replace(/^\+/, '');
  if (!cleaned) return null;

  const msg = buildChaseMessageWithPayNow(msgParams);
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(msg)}`;
}

/**
 * Wraps buildChaseMessage to prepend a Pay-now line above the tier copy
 * when the trader is connected and a payNowUrl is provided.
 *
 * Brief Section 2.2: "The Pay-now link sits above the existing chase copy,
 * because in WhatsApp the link preview renders at the top of the message
 * bubble and that's the tap target."
 *
 * When payNowUrl is absent or empty, returns buildChaseMessage output unchanged
 * so no regression for unconnected traders.
 *
 * @param {{ payNowUrl?: string, depositPaidPence?: number, [key: string]: any }} params
 *   depositPaidPence — when > 0, the amount field in msgParams is treated as the
 *   balance (caller must pass the balance as amount); the message suffix notes
 *   the deposit already paid.
 * @returns {string}
 */
export function buildChaseMessageWithPayNow({ payNowUrl = '', depositPaidPence = 0, ...msgParams }) {
  const baseMessage = buildChaseMessage(msgParams);

  if (!payNowUrl && depositPaidPence === 0) return baseMessage;

  if (!payNowUrl && depositPaidPence > 0) {
    // Unconnected trader but deposit was paid — inform the customer
    const depositGbp = `£${(depositPaidPence / 100).toFixed(2)}`;
    return `${baseMessage}\n\n(Deposit of ${depositGbp} already paid — this is for the remaining balance.)`;
  }

  // payNowUrl is present — prepend the Pay-now block, then a blank line, then base message.
  // No-deposit: label and URL on the same line (PR 2 spec — "Pay by card here: <url>").
  // With deposit: label on one line, URL on the next (PR 4 spec — separate lines).
  if (depositPaidPence > 0) {
    const depositGbp = `£${(depositPaidPence / 100).toFixed(2)}`;
    return `Pay balance by card here (deposit of ${depositGbp} already received):\n${payNowUrl}\n\n${baseMessage}`;
  }

  return `Pay by card here: ${payNowUrl}\n\n${baseMessage}`;
}

// ── Cloud helpers (async, fire-and-forget at call sites) ─────────────────
//
// All three functions accept the Supabase anon browser client as a parameter
// so they can be unit-tested with a mock without touching the module singleton.
// The anon client relies on RLS (user_id = auth.uid()) — never use service-role here.
//
// Error handling contract:
//   - PostgREST code 42703 = column not found (table might not exist yet)
//   - Any error is caught, logged with console.warn, and the call returns undefined.
//   - The caller must never await these in a hot render path — always fire-and-forget.

/**
 * Upserts a chase record to the cloud for the given jobId.
 * Must be called AFTER recordChase() has already written to localStorage.
 * The count/timestamps are read from localStorage so both stores stay consistent.
 *
 * @param {string} jobId
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 */
export async function recordChaseCloud(jobId, supabaseClient) {
  if (!jobId || !supabaseClient) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const state = getChaseState(jobId);
    if (!state) return;
    const { error } = await supabaseClient
      .from('job_chase_states')
      .upsert(
        {
          user_id: user.id,
          job_id: jobId,
          chase_count: state.count,
          last_chased_at: state.lastChasedAt,
          first_chased_at: state.firstChasedAt,
        },
        { onConflict: 'user_id,job_id' }
      );
    if (error) console.warn('[chaseLadder] recordChaseCloud failed:', error.message);
  } catch (err) {
    console.warn('[chaseLadder] recordChaseCloud unexpected error:', err?.message ?? err);
  }
}

/**
 * Returns the cloud chase state for the given jobId, or null on any failure.
 *
 * @param {string} jobId
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @returns {Promise<{count: number, lastChasedAt: string, firstChasedAt: string}|null>}
 */
export async function getChaseStateCloud(jobId, supabaseClient) {
  if (!jobId || !supabaseClient) return null;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabaseClient
      .from('job_chase_states')
      .select('chase_count, last_chased_at, first_chased_at')
      .eq('user_id', user.id)
      .eq('job_id', jobId)
      .single();
    if (error) {
      console.warn('[chaseLadder] getChaseStateCloud failed:', error.message);
      return null;
    }
    if (!data) return null;
    return {
      count: data.chase_count,
      lastChasedAt: data.last_chased_at,
      firstChasedAt: data.first_chased_at,
    };
  } catch (err) {
    console.warn('[chaseLadder] getChaseStateCloud unexpected error:', err?.message ?? err);
    return null;
  }
}

/**
 * Deletes the cloud chase record for the given jobId (called when Mark Paid fires).
 *
 * @param {string} jobId
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 */
export async function clearChaseCloud(jobId, supabaseClient) {
  if (!jobId || !supabaseClient) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { error } = await supabaseClient
      .from('job_chase_states')
      .delete()
      .eq('user_id', user.id)
      .eq('job_id', jobId);
    if (error) console.warn('[chaseLadder] clearChaseCloud failed:', error.message);
  } catch (err) {
    console.warn('[chaseLadder] clearChaseCloud unexpected error:', err?.message ?? err);
  }
}

/**
 * One-shot hydration: reads ALL of the signed-in user's rows from cloud and
 * overlays them into the localStorage store where the cloud lastChasedAt is
 * newer (cloud wins on freshness). Safe to call on every app open — it never
 * downgrades a newer local record and never throws.
 *
 * Call once after auth is ready (e.g. AppShell after refreshFromCloud).
 * Does NOT block render — fire-and-forget with .catch(console.warn).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 */
export async function hydrateChaseState(supabaseClient) {
  if (!supabaseClient) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data, error } = await supabaseClient
      .from('job_chase_states')
      .select('job_id, chase_count, last_chased_at, first_chased_at')
      .eq('user_id', user.id);
    if (error) {
      console.warn('[chaseLadder] hydrateChaseState failed:', error.message);
      return;
    }
    if (!data?.length) return;
    const store = readStore();
    let changed = false;
    for (const row of data) {
      const local = store[row.job_id];
      const cloudTs = row.last_chased_at ? new Date(row.last_chased_at).getTime() : 0;
      const localTs = local?.lastChasedAt ? new Date(local.lastChasedAt).getTime() : 0;
      if (cloudTs > localTs) {
        store[row.job_id] = {
          count: row.chase_count,
          lastChasedAt: row.last_chased_at,
          firstChasedAt: row.first_chased_at,
        };
        changed = true;
      }
    }
    if (changed) writeStore(store);
  } catch (err) {
    console.warn('[chaseLadder] hydrateChaseState unexpected error:', err?.message ?? err);
  }
}

// ── Display helpers ───────────────────────────────────────────────────────

/**
 * Returns a human-readable "last chased N days ago" string for the chip,
 * or null if no state exists.
 *
 * @param {object|null} state
 * @param {Date} [_now]
 * @returns {string|null}
 */
export function lastChasedLabel(state, _now = new Date()) {
  if (!state) return null;
  const diffMs = _now - new Date(state.lastChasedAt);
  const diffDays = Math.floor(diffMs / MS_PER_DAY);
  if (diffDays === 0) return 'Chased today';
  if (diffDays === 1) return 'Last chased yesterday';
  return `Last chased ${diffDays}d ago`;
}
