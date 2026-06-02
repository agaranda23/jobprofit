/**
 * generate-quote — Netlify function (AI Quote Builder, V1)
 *
 * Authenticated endpoint: the caller must supply a valid Supabase JWT in the
 * Authorization header (Bearer <token>). Unauthenticated requests are rejected
 * with 401.
 *
 * Flow:
 *   1. Verify the JWT via Supabase service-role client (getUser).
 *   2. Fetch the trader's profile (hourly_rate, vat_number, trade_type).
 *   3. Fetch a deduped shortlist of their ~15 most recent line items as
 *      PRICING CONTEXT — never customer contact details.
 *   4. Check / enforce the monthly AI quote build quota (free: 3/month,
 *      Pro: unlimited). Increment on success.
 *   5. Call Claude Sonnet via the Anthropic API (tool-use / structured output).
 *   6. Return { lineItems, total, vatRegistered, hourlyRate }.
 *
 * POST body (JSON):
 *   { description: string }   — rough job description from the trader
 *
 * Request headers:
 *   Authorization: Bearer <supabase-access-token>
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY         — Anthropic API key (server-only, never browser)
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key (bypasses RLS)
 *   VITE_SUPABASE_URL         — Supabase project URL
 *
 * Response shapes:
 *   200  { lineItems: [{desc, cost, lowConfidence?}], total: number,
 *           vatRegistered: boolean, hourlyRate: number|null }
 *   400  { error: string }
 *   401  { error: 'Unauthorized' }
 *   402  { error: 'quota_exceeded', message: string }
 *   500  { error: string }
 *   502  { error: string }
 *
 * PII note: customer name/phone/email/address are NEVER sent to Anthropic.
 * Only job description + pricing history + hourly rate are in the AI payload.
 */

import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

/** Free tier: max AI quote builds per calendar month */
const FREE_QUOTA = 3;

/** Max tokens for the Claude response — keeps cost bounded */
const MAX_TOKENS = 800;

/** Max line items we'll show from pricing history (deduped by description) */
const HISTORY_LIMIT = 15;

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ─────────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
    console.error(
      'generate-quote: missing env vars.',
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey,
      'ANTHROPIC_API_KEY:', !!anthropicKey
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Parse request body ────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const description = (body.description || '').trim();
  if (!description || description.length < 3) {
    return json(400, { error: 'description is required (min 3 characters)' });
  }
  if (description.length > 1000) {
    return json(400, { error: 'description too long (max 1000 characters)' });
  }

  // ── 3. Verify Supabase JWT ───────────────────────────────────────────────────
  // The Bearer token is the Supabase access token from the browser's auth session.
  // We verify it server-side using the service-role client which can call getUser.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearerToken) {
    return json(401, { error: 'Unauthorized' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let userId;
  try {
    const { data: userData, error: authError } = await adminClient.auth.getUser(bearerToken);
    if (authError || !userData?.user?.id) {
      return json(401, { error: 'Unauthorized' });
    }
    userId = userData.user.id;
  } catch (err) {
    console.error('generate-quote: JWT verification failed', err?.message);
    return json(401, { error: 'Unauthorized' });
  }

  // ── 4. Fetch trader profile ──────────────────────────────────────────────────
  // Columns: hourly_rate, vat_number, plan, ai_quote_builds_count,
  //          ai_quote_builds_period, trade_type (if exists).
  // trade_type may not exist on older schemas — handled gracefully below.
  let profile;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('hourly_rate, vat_number, plan, ai_quote_builds_count, ai_quote_builds_period, trade_type')
      .eq('id', userId)
      .single();

    if (error) {
      // Column missing or row not found — use safe defaults
      console.warn('generate-quote: profile fetch error (using defaults)', error?.message);
      profile = {};
    } else {
      profile = data || {};
    }
  } catch (err) {
    console.warn('generate-quote: profile fetch threw (using defaults)', err?.message);
    profile = {};
  }

  const hourlyRate = profile.hourly_rate != null ? Number(profile.hourly_rate) : null;
  const vatRegistered = !!(profile.vat_number && profile.vat_number.trim());
  const isPro = profile.plan === 'pro';

  // ── 5. Enforce monthly AI quote build quota ──────────────────────────────────
  // Period key: "YYYY-MM". When stored period != current month, counter resets.
  // Pro users skip this check entirely.
  const currentPeriod = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  if (!isPro) {
    const storedPeriod = profile.ai_quote_builds_period || '';
    const currentCount = storedPeriod === currentPeriod
      ? (profile.ai_quote_builds_count ?? 0)
      : 0;

    if (currentCount >= FREE_QUOTA) {
      return json(402, {
        error: 'quota_exceeded',
        message: `You've used your ${FREE_QUOTA} free AI quotes this month. Go Pro for unlimited (£12/mo), or build this one by hand — takes a minute.`,
        quota: FREE_QUOTA,
        used: currentCount,
      });
    }
  }

  // ── 6. Fetch pricing history (line items from recent jobs) ───────────────────
  // We fetch the 30 most recent jobs and extract their line_items columns.
  // PII fields (customer_name, phone, email, address) are NOT selected.
  let pricingHistory = [];
  try {
    const { data: jobRows, error: jobErr } = await adminClient
      .from('jobs')
      .select('line_items, meta')
      .eq('user_id', userId)
      .not('line_items', 'is', null)
      .order('created_at', { ascending: false })
      .limit(30);

    if (!jobErr && Array.isArray(jobRows)) {
      // Collect all line items, preferring meta.lineItems over the column
      const allItems = [];
      for (const row of jobRows) {
        const metaItems = row.meta?.lineItems;
        const items = Array.isArray(metaItems) && metaItems.length > 0
          ? metaItems
          : (Array.isArray(row.line_items) ? row.line_items : []);
        for (const item of items) {
          if (item?.desc && typeof item.desc === 'string' && item.desc.trim()) {
            allItems.push({ desc: item.desc.trim(), cost: Number(item.cost) || 0 });
          }
        }
      }

      // Deduplicate by description (keep highest cost for each desc as representative)
      const seen = new Map();
      for (const item of allItems) {
        const key = item.desc.toLowerCase();
        if (!seen.has(key) || seen.get(key).cost < item.cost) {
          seen.set(key, item);
        }
      }
      pricingHistory = Array.from(seen.values()).slice(0, HISTORY_LIMIT);
    }
  } catch (err) {
    console.warn('generate-quote: pricing history fetch failed (continuing without)', err?.message);
  }

  // ── 7. Build Claude prompt ───────────────────────────────────────────────────
  // System prompt is static (eligible for prompt caching on high-volume accounts).
  // User message varies per request.

  const rateContext = hourlyRate != null
    ? `The trader charges £${hourlyRate}/hr for labour.`
    : 'The trader has not set an hourly rate — use sensible UK trade labour placeholder costs.';

  const vatContext = vatRegistered
    ? 'The trader IS VAT-registered. Do NOT add VAT to line item costs (the front-end adds it separately). Note the labour rate is ex-VAT.'
    : 'The trader is NOT VAT-registered. Do not mention or add VAT.';

  const historyContext = pricingHistory.length > 0
    ? 'Pricing history (use these as reference costs where the job description matches):\n' +
      pricingHistory.map(i => `- ${i.desc}: £${i.cost.toFixed(2)}`).join('\n')
    : 'No pricing history available — use sensible UK trade market rates as placeholders.';

  const systemPrompt = `You are a pricing assistant for a UK tradesperson. Your job is to produce a fully itemised quote from a rough job description, using the trader's own pricing history and hourly rate as the basis for costs.

Rules:
- Separate labour and materials into distinct line items.
- Price labour using the trader's hourly rate. If no rate is given, use a sensible UK market placeholder.
- Where you have a close match in the pricing history, prefer that cost.
- Where you have no close historical match for a line item, set lowConfidence:true and give a sensible non-zero placeholder cost. Never return £0 or blank for a cost.
- ${vatContext}
- Keep descriptions short and plain-English (a tradesperson will show these to a customer).
- Do not include any customer personal data in the output.

${rateContext}

${historyContext}`;

  // Tool definition for structured output — forces JSON schema compliance
  const quoteTool = {
    name: 'build_quote',
    description: 'Returns a fully itemised quote as structured JSON.',
    input_schema: {
      type: 'object',
      properties: {
        lineItems: {
          type: 'array',
          description: 'Array of line items for the quote.',
          items: {
            type: 'object',
            properties: {
              desc: {
                type: 'string',
                description: 'Plain-English description of the line item.',
              },
              cost: {
                type: 'number',
                description: 'Cost in GBP (pounds, no currency symbol). Never 0.',
              },
              qty: {
                type: 'number',
                description: 'Optional quantity (e.g. hours, units). Omit if not applicable.',
              },
              unit: {
                type: 'string',
                description: 'Unit label (e.g. "hrs", "m²", "each"). Omit if not applicable.',
              },
              provenance: {
                type: 'string',
                enum: ['labour', 'history', 'estimate'],
                description: '"labour" = calculated from hourly rate; "history" = from past jobs; "estimate" = no close match found.',
              },
              lowConfidence: {
                type: 'boolean',
                description: 'true when cost is a placeholder with no close historical match.',
              },
            },
            required: ['desc', 'cost'],
          },
          minItems: 1,
        },
        total: {
          type: 'number',
          description: 'Sum of all line item costs in GBP.',
        },
      },
      required: ['lineItems', 'total'],
    },
  };

  // ── 8. Call Anthropic API ────────────────────────────────────────────────────
  let anthropicResponse;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: [quoteTool],
        tool_choice: { type: 'tool', name: 'build_quote' },
        messages: [
          {
            role: 'user',
            content: `Build a quote for this job: ${description}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('generate-quote: Anthropic API error', res.status, errText.slice(0, 200));
      return json(502, { error: 'AI service error — please try again or build the quote by hand' });
    }

    anthropicResponse = await res.json();
  } catch (err) {
    console.error('generate-quote: Anthropic fetch failed', err?.message);
    return json(502, { error: 'Could not reach the AI service — please try again or build the quote by hand' });
  }

  // ── 9. Extract structured tool-use result ────────────────────────────────────
  const toolUseBlock = (anthropicResponse.content || []).find(b => b.type === 'tool_use');
  if (!toolUseBlock?.input) {
    console.error('generate-quote: no tool_use block in response', JSON.stringify(anthropicResponse).slice(0, 300));
    return json(502, { error: 'AI returned an unexpected format — please try again or build the quote by hand' });
  }

  const aiResult = toolUseBlock.input;

  // Validate the output shape
  if (!Array.isArray(aiResult.lineItems) || aiResult.lineItems.length === 0) {
    return json(502, { error: 'AI did not return any line items — please build the quote by hand' });
  }

  // Sanitise: ensure every item has a non-empty desc and a positive cost
  const sanitisedItems = aiResult.lineItems
    .filter(item => item?.desc && typeof item.desc === 'string')
    .map(item => ({
      desc: String(item.desc).trim().slice(0, 200),
      cost: Math.max(Number(item.cost) || 0, 0),
      ...(item.qty != null ? { qty: Number(item.qty) } : {}),
      ...(item.unit ? { unit: String(item.unit).slice(0, 20) } : {}),
      ...(item.provenance ? { provenance: item.provenance } : {}),
      ...(item.lowConfidence === true ? { lowConfidence: true } : {}),
    }));

  if (sanitisedItems.length === 0) {
    return json(502, { error: 'AI returned empty line items — please build the quote by hand' });
  }

  const total = sanitisedItems.reduce((s, i) => s + i.cost, 0);

  // ── 10. Increment monthly quota counter (fire-and-forget) ────────────────────
  // Persists the build to the profiles counter. Offline failures are acceptable —
  // the worst case is 1 extra free build per offline session.
  const newPeriod = new Date().toISOString().slice(0, 7);
  const storedPeriod = profile.ai_quote_builds_period || '';
  const currentCount = storedPeriod === newPeriod
    ? (profile.ai_quote_builds_count ?? 0)
    : 0;

  adminClient
    .from('profiles')
    .update({
      ai_quote_builds_count: currentCount + 1,
      ai_quote_builds_period: newPeriod,
    })
    .eq('id', userId)
    .then(({ error }) => {
      if (error) console.warn('generate-quote: quota increment failed (non-blocking)', error?.message);
    })
    .catch(err => {
      console.warn('generate-quote: quota increment threw (non-blocking)', err?.message);
    });

  // ── 11. Return result ────────────────────────────────────────────────────────
  return json(200, {
    lineItems: sanitisedItems,
    total: Math.round(total * 100) / 100,
    vatRegistered,
    hourlyRate,
  });
};
