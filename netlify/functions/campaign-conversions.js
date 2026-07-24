/**
 * campaign-conversions — Netlify function (JP-LU9 Phase 3)
 *
 * Internal-only report: per-campaign signups / paid conversions / bounty
 * owed, for the founder to run creator payouts BY HAND (bank transfer,
 * off-platform — no in-app Stripe Connect payout rail exists or is planned).
 *
 * This is deliberately NOT a creator-facing dashboard — creators have no
 * login / no profiles row. Access is gated by a single shared secret
 * (CAMPAIGN_REPORT_SECRET), not a Supabase user JWT, because there is no
 * per-creator account for a JWT to belong to.
 *
 * GET /.netlify/functions/campaign-conversions
 *   Headers: Authorization: Bearer <CAMPAIGN_REPORT_SECRET>
 *   Query:   ?format=csv   (optional — default is JSON)
 *
 * Response: one row per campaign that has at least one referral —
 *   { code, creator_label, active, signups, paid_conversions,
 *     bounty_pending, bounty_owed_count, bounty_owed_total_minor,
 *     bounty_void_count, currency, payout_cap_minor }
 *
 *   signups                 — total referrals rows for this campaign
 *   paid_conversions        — referrals with >= 1 successful payment
 *   bounty_pending          — accruing but not yet at the 2-payment/30-day threshold
 *   bounty_owed_count       — referrals whose bounty has accrued (owed)
 *   bounty_owed_total_minor — sum of bounty_amount_minor across owed referrals
 *                             (this is what the founder actually pays out)
 *   bounty_void_count       — referrals clawed back (refund/dispute)
 *
 * Requires the campaigns migration to be applied first (20260724000000_add_campaigns.sql)
 * — returns a 502 database error otherwise rather than a friendly empty report,
 * since this is a manual founder tool run after the migration, not a
 * user-facing path that needs graceful degradation.
 *
 * Required env vars:
 *   CAMPAIGN_REPORT_SECRET    — long random string, generate once and set in
 *                                the Netlify dashboard. Paste into whatever
 *                                tool you use to call this endpoint (curl,
 *                                Postman, etc).
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY — bypasses RLS, server only
 *
 * Response shapes:
 *   200 { campaigns: [...] }   — JSON (default)
 *   200 <csv text>             — when ?format=csv
 *   401 { error }              — missing / wrong secret
 *   405 { error }              — wrong HTTP method
 *   500 { error }              — server configuration error
 *   502 { error }              — database error
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

/**
 * Constant-time secret comparison — avoids leaking the secret's length or
 * prefix via response-timing differences.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function secretsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const CSV_HEADERS = [
  'code', 'creator_label', 'active', 'signups', 'paid_conversions',
  'bounty_pending', 'bounty_owed_count', 'bounty_owed_total_minor',
  'bounty_void_count', 'currency', 'payout_cap_minor',
];

/**
 * @param {Array<object>} rows
 * @returns {string}
 */
export function toCsv(rows) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

/**
 * Aggregates raw referrals-joined-with-campaigns rows into one summary row
 * per campaign. Pure — no I/O — so it's directly unit-testable.
 *
 * @param {Array<{ campaign_id: string, bounty_status: string, bounty_payment_count: number|null,
 *   bounty_amount_minor: number|null, campaigns: object|null }>} rows
 * @returns {Array<object>}
 */
export function aggregateByCampaign(rows) {
  const byCampaign = new Map();
  for (const row of rows || []) {
    const campaignInfo = row.campaigns;
    if (!campaignInfo) continue; // orphaned FK — shouldn't happen, skip defensively
    const key = row.campaign_id;
    if (!byCampaign.has(key)) {
      byCampaign.set(key, {
        code: campaignInfo.code,
        creator_label: campaignInfo.creator_label,
        active: campaignInfo.active,
        signups: 0,
        paid_conversions: 0,
        bounty_pending: 0,
        bounty_owed_count: 0,
        bounty_owed_total_minor: 0,
        bounty_void_count: 0,
        currency: campaignInfo.bounty_currency,
        payout_cap_minor: campaignInfo.payout_cap_minor ?? null,
      });
    }
    const agg = byCampaign.get(key);
    agg.signups += 1;
    if ((row.bounty_payment_count ?? 0) >= 1) agg.paid_conversions += 1;
    if (row.bounty_status === 'pending') agg.bounty_pending += 1;
    if (row.bounty_status === 'owed') {
      agg.bounty_owed_count += 1;
      agg.bounty_owed_total_minor += row.bounty_amount_minor ?? 0;
    }
    if (row.bounty_status === 'void') agg.bounty_void_count += 1;
  }
  return Array.from(byCampaign.values());
}

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const reportSecret   = process.env.CAMPAIGN_REPORT_SECRET;

  if (!supabaseUrl || !serviceRoleKey || !reportSecret) {
    console.error('campaign-conversions: missing env vars');
    return json(500, { error: 'Server configuration error' });
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!secretsMatch(token, reportSecret)) {
    return json(401, { error: 'Unauthorized' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let rows;
  try {
    const { data, error } = await adminClient
      .from('referrals')
      .select('campaign_id, bounty_status, bounty_payment_count, bounty_amount_minor, campaigns(code, creator_label, active, bounty_currency, payout_cap_minor)')
      .not('campaign_id', 'is', null);

    if (error) {
      console.error('campaign-conversions: query failed', error.message);
      return json(502, { error: 'Database error' });
    }
    rows = data || [];
  } catch (err) {
    console.error('campaign-conversions: query threw', err?.message);
    return json(502, { error: 'Database error' });
  }

  const result = aggregateByCampaign(rows);
  const format = event.queryStringParameters?.format;

  if (format === 'csv') {
    return json(200, toCsv(result), { 'Content-Type': 'text/csv' });
  }
  return json(200, { campaigns: result });
};
