/**
 * patio.js — Patio/paving materials estimator calc definition.
 *
 * CONSTANTS NOTE: The coverage values below are PRD's illustrative UK rules-of-thumb.
 * They MUST be reviewed and signed off against a trade reference (e.g. Travis Perkins
 * product data, Marshalls coverage guides, or a working groundworker) before this
 * feature is exposed to real customers. Wrong figures here directly affect what a
 * tradesperson quotes — liability surface. See PR description for sign-off checklist.
 *
 * Calc shape:
 *   id           — unique string key, used in estimatorParse output
 *   label        — short display label
 *   trade        — trade category hint (for filtering in future)
 *   inputs       — list of required input keys with metadata
 *   formula()    — pure function: (inputs, assumptions) → { lines, notes }
 *   assumptions  — default values for every adjustable constant
 *   materials    — descriptive names for library matching (informational only)
 *   clarifyPrompts — question text + chip options for the Clarify step (state C)
 */

export const patio = {
  id: 'patio',
  label: 'Patio / Paving',
  trade: 'landscaper_groundworker',

  inputs: [
    { key: 'areaM2',      label: 'Area (m²)',    type: 'number', required: false },
    { key: 'lengthM',     label: 'Length (m)',   type: 'number', required: false },
    { key: 'widthM',      label: 'Width (m)',    type: 'number', required: false },
    { key: 'edgingType',  label: 'Edging type',  type: 'select', options: ['none', 'brick', 'block', 'unknown'], required: false },
    { key: 'perimeterM',  label: 'Perimeter (m)', type: 'number', required: false },
  ],

  /**
   * Default editable assumptions.
   * All values here must be overridable by the user in the Assumptions panel.
   *
   * slabCoverageM2     — area one slab covers (0.6×0.6 = 0.36 m² for a 600×600 slab)
   * wastage            — fraction added for cuts/breakage (0.10 = 10%)
   * subBaseDepthM      — compacted depth of MOT Type 1 sub-base in metres
   * subBaseDensity     — tonnes per m³ for compacted MOT Type 1
   * beddingDepthM      — sharp sand bedding depth in metres
   * beddingDensity     — tonnes per m³ for sharp sand
   * cementBagsPerM2    — cement bags per m² of patio area (1 bag per 4 m²)
   * brickLengthM       — standard brick length including mortar joint (0.215 + 0.010 = 0.225 m)
   * edgingWastage      — wastage fraction for edging bricks (0.10 = 10%)
   */
  assumptions: {
    slabCoverageM2:   0.36,
    wastage:          0.10,
    subBaseDepthM:    0.10,
    subBaseDensity:   2.0,
    beddingDepthM:    0.05,
    beddingDensity:   1.6,
    cementBagsPerM2:  0.25,
    brickLengthM:     0.225,
    edgingWastage:    0.10,
  },

  materials: [
    'paving slabs',
    'MOT type 1 sub-base',
    'sharp sand',
    'cement',
    'edging bricks',
  ],

  clarifyPrompts: {
    slabSize: {
      question: 'What size slabs?',
      chips: [
        { label: '600×600', value: 0.36 },
        { label: '450×450', value: 0.2025 },
        { label: '600×300', value: 0.18 },
      ],
      assumptionKey: 'slabCoverageM2',
    },
    edgingType: {
      question: 'Brick edging?',
      chips: [
        { label: 'Single skin brick', value: 'brick' },
        { label: 'Block edge', value: 'block' },
        { label: 'No edging', value: 'none' },
      ],
      inputKey: 'edgingType',
    },
  },

  /**
   * Core formula — pure, no side effects, no I/O.
   *
   * @param {{
   *   areaM2?:     number,
   *   lengthM?:    number,
   *   widthM?:     number,
   *   perimeterM?: number,
   *   edgingType?: 'none'|'brick'|'block'|'unknown',
   * }} inputs
   * @param {typeof patio.assumptions} assumptions
   * @returns {{
   *   lines: Array<{ material: string, qty: number, unit: string, assumptionsUsed: string[] }>,
   *   notes: string[],
   * }}
   */
  formula(inputs, assumptions) {
    const a = { ...patio.assumptions, ...assumptions };
    const lines = [];
    const notes = [];

    // ── Resolve area ──────────────────────────────────────────────────────────
    let areaM2 = Number(inputs.areaM2) || 0;
    if (!areaM2 && inputs.lengthM && inputs.widthM) {
      areaM2 = Number(inputs.lengthM) * Number(inputs.widthM);
    }
    if (!areaM2 || areaM2 <= 0) {
      return { lines: [], notes: ['Area is required — enter dimensions to estimate.'] };
    }

    // ── Slabs ─────────────────────────────────────────────────────────────────
    const slabQty = Math.ceil(areaM2 / a.slabCoverageM2 * (1 + a.wastage));
    lines.push({
      material: 'Paving slabs',
      qty: slabQty,
      unit: 'each',
      assumptionsUsed: ['slabCoverageM2', 'wastage'],
    });

    // ── MOT Type 1 sub-base ───────────────────────────────────────────────────
    const subBaseTonnes = Math.ceil((areaM2 * a.subBaseDepthM * a.subBaseDensity) * 10) / 10;
    lines.push({
      material: 'MOT Type 1 sub-base',
      qty: subBaseTonnes,
      unit: 't',
      assumptionsUsed: ['subBaseDepthM', 'subBaseDensity'],
    });

    // ── Sharp sand (bedding) ──────────────────────────────────────────────────
    const sandTonnes = Math.ceil((areaM2 * a.beddingDepthM * a.beddingDensity) * 10) / 10;
    lines.push({
      material: 'Sharp sand',
      qty: sandTonnes,
      unit: 't',
      assumptionsUsed: ['beddingDepthM', 'beddingDensity'],
    });

    // ── Cement ────────────────────────────────────────────────────────────────
    const cementBags = Math.ceil(areaM2 * a.cementBagsPerM2);
    lines.push({
      material: 'Cement',
      qty: cementBags,
      unit: 'bags',
      assumptionsUsed: ['cementBagsPerM2'],
    });

    // ── Edging bricks (single skin only) ─────────────────────────────────────
    const edgingType = inputs.edgingType || 'none';
    if (edgingType === 'brick') {
      // Resolve perimeter: supplied, or estimated from area assuming a square
      const perimeterM = Number(inputs.perimeterM) > 0
        ? Number(inputs.perimeterM)
        : 4 * Math.sqrt(areaM2);

      if (!inputs.perimeterM) {
        notes.push('Perimeter estimated from area — enter actual dimensions for accuracy.');
      }

      const edgingBricks = Math.ceil((perimeterM / a.brickLengthM) * (1 + a.edgingWastage));
      lines.push({
        material: 'Edging bricks',
        qty: edgingBricks,
        unit: 'each',
        assumptionsUsed: ['brickLengthM', 'edgingWastage'],
      });
    }

    notes.push('~ estimate only. Check against supplier coverage data for your specific slab size.');

    return { lines, notes };
  },
};
