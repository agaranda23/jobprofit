/**
 * estimator/engine.js — deterministic materials calc engine.
 *
 * The engine is calc-agnostic. It takes a calc definition (from calcs/*.js)
 * and runs the formula with user inputs + assumption overrides.
 *
 * KEY DESIGN PRINCIPLE: The engine never calls the LLM, never hits the network,
 * and contains zero async code. It is a pure function dispatcher.
 * The LLM (estimatorParse.js) handles NL → structured input only.
 *
 * Exports:
 *   runCalc(calc, inputs, assumptionOverrides?)
 *     → { lines, notes, assumptionsUsed }
 *
 *   CALCS — registry of all available calc definitions, keyed by id.
 *     Used by EstimatorSheet to dispatch on calcType from estimatorParse.
 *
 * Line shape returned by runCalc:
 *   {
 *     material:       string,
 *     qty:            number,
 *     unit:           string,
 *     assumptionsUsed: string[],   // which assumption keys affected this line
 *   }
 *
 * Consumers (EstimatorSheet) pair this output with the library-pricing bridge
 * in materials.js to produce priced quote line items.
 */

import { patio }     from './calcs/patio.js';
import { brickWall } from './calcs/brickWall.js';

// ── Calc registry ─────────────────────────────────────────────────────────────
// Add new calcs here. Each entry must match the calc definition shape:
//   { id, label, trade, inputs, formula, assumptions, materials, clarifyPrompts }

export const CALCS = {
  [patio.id]:     patio,
  [brickWall.id]: brickWall,
};

/**
 * Runs a calc formula with user inputs and optional assumption overrides.
 *
 * @param {object} calc               — a calc definition from calcs/*.js
 * @param {object} inputs             — user-supplied dimension values
 * @param {object} [assumptionOverrides={}] — user-edited assumption values
 * @returns {{
 *   lines:            Array<{ material, qty, unit, assumptionsUsed }>,
 *   notes:            string[],
 *   effectiveAssumptions: object,   // merged defaults + overrides (for the UI panel)
 * }}
 */
export function runCalc(calc, inputs, assumptionOverrides = {}) {
  if (!calc || typeof calc.formula !== 'function') {
    return { lines: [], notes: ['Unknown calc type.'], effectiveAssumptions: {} };
  }

  // Merge defaults with any user overrides.
  // Numeric string overrides are coerced so the formula always receives numbers.
  const effectiveAssumptions = Object.fromEntries(
    Object.entries({ ...calc.assumptions, ...assumptionOverrides }).map(([k, v]) => {
      if (Array.isArray(v)) return [k, v];
      const n = Number(v);
      return [k, isNaN(n) ? v : n];
    })
  );

  try {
    const { lines = [], notes = [] } = calc.formula(inputs, effectiveAssumptions);
    return { lines, notes, effectiveAssumptions };
  } catch (err) {
    return {
      lines: [],
      notes: [`Calculation error: ${err?.message || 'unexpected error'}`],
      effectiveAssumptions,
    };
  }
}

/**
 * Returns the calc definition for a given id, or null if not registered.
 *
 * @param {string} calcId
 * @returns {object|null}
 */
export function getCalc(calcId) {
  return CALCS[calcId] ?? null;
}
