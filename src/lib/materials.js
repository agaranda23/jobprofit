/**
 * materials.js — cloud CRUD for the Materials Library.
 *
 * Mirrors the pattern from store.js receipts: Supabase is authoritative,
 * reads and writes go straight to the cloud, no localStorage mirror needed
 * (materials are not part of the legacy App.jsx data model).
 *
 * GRACEFUL DEGRADATION
 * --------------------
 * Every exported function wraps Supabase calls in try/catch and returns
 * a safe empty value on failure. If the `materials` table doesn't exist yet
 * (migration pending), callers receive [] or null — the app never crashes.
 *
 * PROFIT MATH / MOAT RULE
 * -----------------------
 * A material on a QUOTE sets the *sell* price (revenue line item) using
 * cost = round(buyPrice * (1 + markup/100), 2). The `buyPrice` is stashed
 * on the line-item for future use but does NOT enter getJobProfit() or any
 * cost aggregation until it lands as a receipt row with a jobId.
 * See cashflow.js getJobProfit — material buy prices are only deducted from
 * profit when present as receipt rows tagged to a job.
 *
 * MARKUP MATH (pure, tested in materials.test.js)
 * ------------------------------------------------
 * sellPrice(buyPrice, markupPct) = round(buyPrice * (1 + markupPct / 100), 2)
 * resolveMarkup(rowMarkup, profileMarkup) = rowMarkup ?? profileMarkup ?? 20
 */

import { supabase } from './supabase';

// ─── Pure markup helpers (exported for tests) ────────────────────────────────

/**
 * Computes sell price from buy price and markup percentage.
 * Always rounds to 2 decimal places (£ precision).
 *
 * @param {number} buyPrice  — ex-VAT buy price
 * @param {number} markupPct — markup percentage, e.g. 20 for 20%
 * @returns {number}
 */
export function sellPrice(buyPrice, markupPct) {
  const buy = Number(buyPrice) || 0;
  const pct = Number(markupPct) || 0;
  return Math.round(buy * (1 + pct / 100) * 100) / 100;
}

/**
 * Resolves the effective markup % for a material, respecting the priority:
 * per-row override → profile default → hard-coded fallback of 20.
 *
 * @param {number|null|undefined} rowMarkup     — materials.default_markup
 * @param {number|null|undefined} profileMarkup — profiles.default_markup
 * @returns {number}
 */
export function resolveMarkup(rowMarkup, profileMarkup) {
  if (rowMarkup != null && !isNaN(Number(rowMarkup))) return Number(rowMarkup);
  if (profileMarkup != null && !isNaN(Number(profileMarkup))) return Number(profileMarkup);
  return 20;
}

/**
 * Scores a material against a query string for type-ahead ranking.
 * Returns 0 when no match, positive int when matched.
 * Higher score = better match (used for secondary sort after use_count).
 *
 * Match logic (case-insensitive):
 *   2 — query appears at the start of desc or supplier_code
 *   1 — query appears anywhere in desc or supplier_code
 *   0 — no match
 *
 * @param {object} material
 * @param {string} query
 * @returns {number}
 */
export function scoreMatch(material, query) {
  if (!query) return 1; // empty query = everything matches
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const d = (material.desc || '').toLowerCase();
  const c = (material.supplier_code || '').toLowerCase();
  if (d.startsWith(q) || c.startsWith(q)) return 2;
  if (d.includes(q) || c.includes(q)) return 1;
  return 0;
}

// ─── Cloud reads ──────────────────────────────────────────────────────────────

/**
 * Fetches all non-archived materials for the current user, sorted by
 * use_count desc then desc asc (alphabetical tiebreak).
 *
 * Returns [] if the table is missing or the user is not signed in.
 *
 * @returns {Promise<object[]>}
 */
export async function getMaterials() {
  try {
    const { data, error } = await supabase
      .from('materials')
      .select('*')
      .eq('archived', false)
      .order('use_count', { ascending: false })
      .order('desc', { ascending: true });

    if (error) {
      // Table may not exist yet — fail silently
      console.warn('getMaterials failed (table may not exist yet)', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('getMaterials threw', err?.message);
    return [];
  }
}

/**
 * Type-ahead: returns up to 5 matching non-archived materials for a query.
 * Ranked by score (prefix > contains) then use_count desc.
 *
 * @param {object[]} materials — the full library (pre-fetched, not refetched here)
 * @param {string}   query
 * @returns {object[]} — up to 5 results
 */
export function filterMaterials(materials, query) {
  if (!Array.isArray(materials)) return [];
  const q = (query || '').trim();
  const scored = materials
    .map(m => ({ m, score: scoreMatch(m, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.m.use_count || 0) - (a.m.use_count || 0);
    });
  return scored.slice(0, 5).map(({ m }) => m);
}

// ─── Cloud writes ─────────────────────────────────────────────────────────────

/**
 * Adds a new material to the library.
 *
 * @param {{
 *   desc: string,
 *   cost: number,
 *   unit?: string,
 *   supplier_code?: string,
 *   supplier?: string,
 *   default_markup?: number,
 *   vat_rate?: number,
 * }} payload
 * @returns {Promise<object|null>} — the saved row, or null on failure
 */
export async function addMaterial(payload) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return null;

    const row = {
      user_id:         user.id,
      desc:            (payload.desc || '').trim(),
      cost:            Number(payload.cost) || 0,
      unit:            payload.unit?.trim() || null,
      supplier_code:   payload.supplier_code?.trim() || null,
      supplier:        payload.supplier?.trim() || null,
      default_markup:  payload.default_markup != null ? Number(payload.default_markup) : null,
      vat_rate:        payload.vat_rate != null ? Number(payload.vat_rate) : 0.20,
      use_count:       0,
      archived:        false,
    };

    const { data, error } = await supabase
      .from('materials')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.warn('addMaterial failed', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('addMaterial threw', err?.message);
    return null;
  }
}

/**
 * Updates an existing material row (partial patch).
 *
 * @param {string} id    — materials.id (UUID)
 * @param {object} patch — fields to update
 * @returns {Promise<object|null>}
 */
export async function updateMaterial(id, patch) {
  try {
    const { data, error } = await supabase
      .from('materials')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('updateMaterial failed', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('updateMaterial threw', err?.message);
    return null;
  }
}

/**
 * Archives (soft-deletes) a material. The row is hidden from type-ahead
 * and library lists but never destroyed.
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function archiveMaterial(id) {
  try {
    const { error } = await supabase
      .from('materials')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.warn('archiveMaterial failed', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('archiveMaterial threw', err?.message);
    return false;
  }
}

/**
 * Increments use_count for a material when it is selected from type-ahead.
 * Fire-and-forget — failure is silent (a missed count increment is not critical).
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function incrementUseCount(id) {
  try {
    // Use rpc to avoid a read-modify-write race; if rpc not available fall back
    const { error } = await supabase.rpc('increment_material_use_count', { material_id: id });
    if (error) {
      // rpc may not exist yet — fall back to a client-side increment
      const { data: row } = await supabase
        .from('materials')
        .select('use_count')
        .eq('id', id)
        .single();
      if (row) {
        await supabase
          .from('materials')
          .update({ use_count: (row.use_count || 0) + 1, updated_at: new Date().toISOString() })
          .eq('id', id);
      }
    }
  } catch {
    // silent — use_count is a nice-to-have sort signal, not critical data
  }
}

/**
 * Saves a line item from a quote or receipt to the materials library.
 * Deduplicates on exact `desc` match (case-insensitive) — if a row already
 * exists with the same desc, it updates the cost instead of inserting a duplicate.
 *
 * @param {{
 *   desc: string,
 *   buyPrice: number,  — ex-VAT cost
 *   unit?: string,
 * }} payload
 * @param {object[]} existingMaterials — current library (to check for dupes client-side)
 * @returns {Promise<{ saved: object|null, wasDupe: boolean }>}
 */
export async function saveLineItemToLibrary(payload, existingMaterials = []) {
  const descNorm = (payload.desc || '').trim().toLowerCase();
  const existing = existingMaterials.find(m => (m.desc || '').toLowerCase() === descNorm);

  if (existing) {
    const updated = await updateMaterial(existing.id, {
      cost: Number(payload.buyPrice) || 0,
      ...(payload.unit ? { unit: payload.unit } : {}),
    });
    return { saved: updated, wasDupe: true };
  }

  const saved = await addMaterial({
    desc:      payload.desc,
    cost:      Number(payload.buyPrice) || 0,
    unit:      payload.unit,
    vat_rate:  0.20,
  });
  return { saved, wasDupe: false };
}
