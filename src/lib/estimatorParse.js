/**
 * estimatorParse.js — LLM front-end for the Work it out estimator.
 *
 * Mirrors the pattern from voiceParse.js:
 *   1. Get session JWT (same pattern as voiceParse)
 *   2. If signed in → call ai.js proxy (Haiku, JWT-gated) → NL → structured
 *   3. If offline / unauthenticated / proxy unreachable → regex fallback
 *
 * THE LLM NEVER DOES ARITHMETIC.
 * It only converts natural-language descriptions into:
 *   { calcType, inputs, missing[], assumptionOverrides }
 *
 * The deterministic engine (estimator/engine.js) always performs the math.
 *
 * Returned shape:
 *   {
 *     calcType:           'patio'|'brickWall'|null,
 *     inputs:             object,   // dimension values the LLM extracted
 *     missing:            string[], // input keys that are needed but absent
 *     assumptionOverrides: object,  // any explicit overrides the user stated
 *     parseMethod:        'ai'|'regex', // which path ran (for telemetry)
 *   }
 *
 * On total failure returns: { calcType: null, inputs: {}, missing: [], assumptionOverrides: {}, parseMethod: 'regex' }
 */

import { supabase } from './supabase';

const SYSTEM_PROMPT = `You are a UK trade assistant. Extract structured dimensions from a tradesperson's job description so a materials estimator can calculate quantities.

IMPORTANT: You extract dimensions only — you do NOT calculate any quantities, costs, or material amounts. All calculations are done by a separate engine.

Respond ONLY with JSON matching this shape:
{
  "calcType": "patio" | "brickWall" | null,
  "inputs": {
    // For patio: areaM2, lengthM, widthM, perimeterM, edgingType ("none"|"brick"|"block")
    // For brickWall: wallLengthM, wallHeightM, skin ("single"|"double"), brickOrBlock ("brick"|"block")
  },
  "missing": ["list", "of", "input", "keys", "that", "are", "needed", "but", "not", "mentioned"],
  "assumptionOverrides": {}
}

Rules:
- calcType "patio": description mentions patio, paving, slabs, flagging, driveway, decking (hard surface).
- calcType "brickWall": description mentions wall, brickwork, blockwork, skin, garden wall, boundary wall.
- If unsure of calcType, return null.
- Extract dimensions in metres. Convert "6 by 6" → lengthM:6, widthM:6. Convert "6 foot" → 1.83m. Convert "10 foot by 6 foot" → lengthM:3.05, widthM:1.83.
- "Single skin" or just "single" → skin:"single". "Double skin" or "cavity" → skin:"double".
- "Brick edging" or "brick border" → edgingType:"brick". "No edging" → edgingType:"none".
- "Block" or "blockwork" → brickOrBlock:"block". Otherwise → brickOrBlock:"brick".
- If area is given directly (e.g. "36 square metres") set areaM2. If length×width given, set both.
- missing[] should list keys that the engine needs but the description didn't provide.
  For patio: list "areaM2" OR ["lengthM","widthM"] if neither area nor both dimensions are given.
  For brickWall: always include "wallLengthM" and/or "wallHeightM" if absent.
- Never invent dimensions that weren't stated. Never set inputs to zero.
- assumptionOverrides: only set if the user explicitly stated a non-default value (e.g. "150mm sub-base" → subBaseDepthM:0.15).

Examples:
"6 by 6 metre patio single skin brick edging"
→ { "calcType": "patio", "inputs": { "lengthM": 6, "widthM": 6, "edgingType": "brick" }, "missing": [], "assumptionOverrides": {} }

"4 metre by 3 metre patio no edging"
→ { "calcType": "patio", "inputs": { "lengthM": 4, "widthM": 3, "edgingType": "none" }, "missing": [], "assumptionOverrides": {} }

"garden wall 5 metres long 1.2 metres high single skin"
→ { "calcType": "brickWall", "inputs": { "wallLengthM": 5, "wallHeightM": 1.2, "skin": "single", "brickOrBlock": "brick" }, "missing": [], "assumptionOverrides": {} }

"back garden patio"
→ { "calcType": "patio", "inputs": {}, "missing": ["areaM2"], "assumptionOverrides": {} }

"brick wall"
→ { "calcType": "brickWall", "inputs": {}, "missing": ["wallLengthM", "wallHeightM"], "assumptionOverrides": {} }`;

/**
 * Parse a natural-language job description into structured estimator inputs.
 *
 * @param {string} description  — free-text from the user
 * @returns {Promise<{
 *   calcType: string|null,
 *   inputs: object,
 *   missing: string[],
 *   assumptionOverrides: object,
 *   parseMethod: 'ai'|'regex',
 * }>}
 */
export async function parseEstimate(description) {
  const text = (description || '').trim();
  if (!text) {
    return { calcType: null, inputs: {}, missing: [], assumptionOverrides: {}, parseMethod: 'regex' };
  }

  // ── JWT gate: same pattern as voiceParse ─────────────────────────────────────
  let accessToken;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    accessToken = session?.access_token;
  } catch {
    // fall through to regex
  }

  if (accessToken) {
    try {
      const res = await fetch('/.netlify/functions/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: text }],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const block = (data.content || []).find(b => b.type === 'text');
        if (block?.text) {
          const clean = block.text.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(clean);
          return {
            calcType:            parsed.calcType   ?? null,
            inputs:              parsed.inputs      ?? {},
            missing:             Array.isArray(parsed.missing) ? parsed.missing : [],
            assumptionOverrides: parsed.assumptionOverrides ?? {},
            parseMethod:         'ai',
          };
        }
      }
    } catch {
      // fall through to regex
    }
  }

  // ── Regex fallback ────────────────────────────────────────────────────────────
  return regexParse(text);
}

/**
 * Regex fallback — handles the most common patterns without needing the LLM.
 * Returns the same shape as parseEstimate.
 *
 * @param {string} text
 * @returns {{ calcType, inputs, missing, assumptionOverrides, parseMethod: 'regex' }}
 */
export function regexParse(text) {
  const t = text.toLowerCase();
  const inputs = {};
  const missing = [];

  // ── Detect calc type ────────────────────────────────────────────────────────
  const isPatio = /patio|paving|slab|flag|driveway/.test(t);
  const isWall  = /wall|brickwork|blockwork|brick wall|block wall|boundary wall|garden wall/.test(t);

  let calcType = null;
  if (isPatio && !isWall)      calcType = 'patio';
  else if (isWall && !isPatio) calcType = 'brickWall';
  else if (isWall)             calcType = 'brickWall'; // wall wins when ambiguous

  // ── Extract dimensions ──────────────────────────────────────────────────────
  // "6 by 6", "6x6", "6 × 6", "6 by 6 metre/meter/m"
  const twoDimM = text.match(
    /(\d+(?:\.\d+)?)\s*(?:by|x|×)\s*(\d+(?:\.\d+)?)\s*(?:m(?:etre|eter)?s?|meter)?/i
  );

  // Single area: "36 m2", "36 sq m", "36 square metres"
  const areaMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:m2|m²|sq\.?\s*m|square\s*m(?:etre|eter)?s?)/i
  );

  if (twoDimM) {
    const dim1 = parseFloat(twoDimM[1]);
    const dim2 = parseFloat(twoDimM[2]);
    if (calcType === 'patio') {
      inputs.lengthM = dim1;
      inputs.widthM  = dim2;
    } else if (calcType === 'brickWall') {
      // Assume longer = length, shorter = height
      inputs.wallLengthM = Math.max(dim1, dim2);
      inputs.wallHeightM = Math.min(dim1, dim2);
    }
  } else if (areaMatch && calcType === 'patio') {
    inputs.areaM2 = parseFloat(areaMatch[1]);
  }

  // Feet conversion: "6 foot", "6 ft", "6'"
  if (calcType === 'patio' && !inputs.lengthM && !inputs.areaM2) {
    const feetMatch = text.match(
      /(\d+(?:\.\d+)?)\s*(?:foot|feet|ft|')\s*(?:by|x|×)\s*(\d+(?:\.\d+)?)\s*(?:foot|feet|ft|')?/i
    );
    if (feetMatch) {
      inputs.lengthM = Math.round(parseFloat(feetMatch[1]) * 0.3048 * 100) / 100;
      inputs.widthM  = Math.round(parseFloat(feetMatch[2]) * 0.3048 * 100) / 100;
    }
  }

  // Wall length/height single dimension: "5m long", "1.2m high"
  if (calcType === 'brickWall' && !inputs.wallLengthM) {
    const longMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:etre|eter)?s?\s*(?:long|wide|length)/i);
    if (longMatch) inputs.wallLengthM = parseFloat(longMatch[1]);
    const highMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:etre|eter)?s?\s*(?:high|tall|height)/i);
    if (highMatch) inputs.wallHeightM = parseFloat(highMatch[1]);
  }

  // ── Edging type (patio) ─────────────────────────────────────────────────────
  if (calcType === 'patio') {
    if (/brick\s*edg|brick\s*border|single.{0,6}skin/.test(t))    inputs.edgingType = 'brick';
    else if (/block\s*edg|block\s*border/.test(t))                 inputs.edgingType = 'block';
    else if (/no\s*edg|without\s*edg/.test(t))                     inputs.edgingType = 'none';
  }

  // ── Skin (wall) ─────────────────────────────────────────────────────────────
  if (calcType === 'brickWall') {
    if (/double\s*skin|double\s*brick|cavity/.test(t))             inputs.skin = 'double';
    else if (/single\s*skin|single\s*brick/.test(t))               inputs.skin = 'single';

    if (/block(?:work)?(?!\s*edg)/.test(t))                        inputs.brickOrBlock = 'block';
    else if (/brick(?:work)?/.test(t))                             inputs.brickOrBlock = 'brick';
  }

  // ── Derive missing keys ─────────────────────────────────────────────────────
  if (calcType === 'patio') {
    const hasArea = inputs.areaM2 || (inputs.lengthM && inputs.widthM);
    if (!hasArea) missing.push('areaM2');
  } else if (calcType === 'brickWall') {
    if (!inputs.wallLengthM) missing.push('wallLengthM');
    if (!inputs.wallHeightM) missing.push('wallHeightM');
  }

  return { calcType, inputs, missing, assumptionOverrides: {}, parseMethod: 'regex' };
}
