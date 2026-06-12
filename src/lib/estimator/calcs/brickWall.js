/**
 * brickWall.js — Brick/block wall materials estimator calc definition.
 *
 * CONSTANTS NOTE: The coverage values below are PRD's illustrative UK rules-of-thumb.
 * They MUST be reviewed and signed off against a trade reference (e.g. Wienerberger
 * brick data, brick calculator from a builder's merchant, or a working bricklayer)
 * before this feature is exposed to real customers.
 * Wrong figures here directly affect what a tradesperson quotes — liability surface.
 *
 * Mortar sand/cement quantities use a 1:5 mix (1 part cement : 5 parts sand by volume).
 * Sand bag conversions use 25 kg per 25 kg bag (standard UK size) at ~1,440 kg/m³ bulk density.
 */

export const brickWall = {
  id: 'brickWall',
  label: 'Brick / Block wall',
  trade: 'builder',

  inputs: [
    { key: 'wallLengthM',  label: 'Wall length (m)',  type: 'number',  required: true },
    { key: 'wallHeightM',  label: 'Wall height (m)',  type: 'number',  required: true },
    { key: 'skin',         label: 'Skin',             type: 'select',  options: ['single', 'double'], required: false },
    { key: 'brickOrBlock', label: 'Brick or block',   type: 'select',  options: ['brick', 'block'], required: false },
  ],

  /**
   * Default editable assumptions.
   *
   * bricksPerM2Single   — standard UK bricks per m² of wall face, single skin
   * blocksPerM2Single   — standard UK blocks per m² of wall face, single skin
   * wastage             — fraction added for cuts/breakage (0.05 = 5%)
   * mortarM3PerM2Single — m³ of mortar needed per m² of single-skin wall face
   * mortarMixRatio      — cement:sand ratio by volume (1 cement : 5 sand = [1,5])
   * sandKgPerM3         — bulk density of building sand (kg/m³)
   * cementKgPerBag      — weight of a standard cement bag (kg)
   * sandKgPerBag        — weight of a standard sand bag (kg)
   */
  assumptions: {
    bricksPerM2Single:    60,
    blocksPerM2Single:    10,
    wastage:              0.05,
    mortarM3PerM2Single:  0.022,
    mortarMixRatio:       [1, 5],  // [cement parts, sand parts]
    sandKgPerM3:          1440,
    cementKgPerBag:       25,
    sandKgPerBag:         25,
  },

  materials: [
    'bricks',
    'concrete blocks',
    'building sand',
    'cement',
  ],

  clarifyPrompts: {
    skin: {
      question: 'Single or double skin?',
      chips: [
        { label: 'Single skin', value: 'single' },
        { label: 'Double skin', value: 'double' },
      ],
      inputKey: 'skin',
    },
    brickOrBlock: {
      question: 'Brick or block?',
      chips: [
        { label: 'Brick', value: 'brick' },
        { label: 'Block', value: 'block' },
      ],
      inputKey: 'brickOrBlock',
    },
  },

  /**
   * Core formula — pure, no side effects, no I/O.
   *
   * @param {{
   *   wallLengthM:  number,
   *   wallHeightM:  number,
   *   skin?:        'single'|'double',
   *   brickOrBlock?: 'brick'|'block',
   * }} inputs
   * @param {typeof brickWall.assumptions} assumptions
   * @returns {{
   *   lines: Array<{ material: string, qty: number, unit: string, assumptionsUsed: string[] }>,
   *   notes: string[],
   * }}
   */
  formula(inputs, assumptions) {
    const a = { ...brickWall.assumptions, ...assumptions };
    const lines = [];
    const notes = [];

    const lengthM = Number(inputs.wallLengthM) || 0;
    const heightM = Number(inputs.wallHeightM) || 0;

    if (!lengthM || lengthM <= 0 || !heightM || heightM <= 0) {
      return { lines: [], notes: ['Wall length and height are required.'] };
    }

    const wallAreaM2 = lengthM * heightM;
    const skin = inputs.skin || 'single';
    const skinMultiplier = skin === 'double' ? 2 : 1;
    const brickOrBlock = inputs.brickOrBlock || 'brick';

    // ── Bricks or blocks ──────────────────────────────────────────────────────
    const unitsPerM2 = brickOrBlock === 'block'
      ? a.blocksPerM2Single
      : a.bricksPerM2Single;
    const unitQty = Math.ceil(wallAreaM2 * unitsPerM2 * skinMultiplier * (1 + a.wastage));
    const materialLabel = brickOrBlock === 'block' ? 'Concrete blocks' : 'Bricks';

    lines.push({
      material: materialLabel,
      qty: unitQty,
      unit: 'each',
      assumptionsUsed: [
        brickOrBlock === 'block' ? 'blocksPerM2Single' : 'bricksPerM2Single',
        'wastage',
      ],
    });

    // ── Mortar (sand + cement) ────────────────────────────────────────────────
    // Mortar volume scales linearly with skin — double skin uses double mortar
    const mortarM3 = wallAreaM2 * a.mortarM3PerM2Single * skinMultiplier;

    const [cementParts, sandParts] = a.mortarMixRatio;
    const totalParts = cementParts + sandParts;

    const sandM3     = mortarM3 * (sandParts / totalParts);
    const cementM3   = mortarM3 * (cementParts / totalParts);

    // Convert m³ to bags (using bulk densities)
    const sandKg   = sandM3 * a.sandKgPerM3;
    const sandBags = Math.ceil(sandKg / a.sandKgPerBag);

    // Cement density ~1,500 kg/m³ (loose Portland cement)
    const cementKgPerM3 = 1500;
    const cementKg   = cementM3 * cementKgPerM3;
    const cementBags = Math.ceil(cementKg / a.cementKgPerBag);

    lines.push({
      material: 'Building sand',
      qty: sandBags,
      unit: 'bags',
      assumptionsUsed: ['mortarM3PerM2Single', 'mortarMixRatio', 'sandKgPerM3', 'sandKgPerBag'],
    });

    lines.push({
      material: 'Cement',
      qty: cementBags,
      unit: 'bags',
      assumptionsUsed: ['mortarM3PerM2Single', 'mortarMixRatio', 'cementKgPerBag'],
    });

    if (skin === 'double') {
      notes.push('Double skin: brick and mortar quantities doubled.');
    }

    notes.push('~ estimate only. Mortar volume varies with joint thickness and mix consistency.');

    return { lines, notes };
  },
};
