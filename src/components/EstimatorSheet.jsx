/**
 * EstimatorSheet.jsx — "Work it out" materials estimator flow.
 *
 * 5 states (A→E):
 *   A  entry       — shown inline via the "+ Work it out" button in the quote line-items area
 *   B  input       — bottom sheet: NL text or structured fields
 *   C  clarify     — up to 2 missing-input questions with chip answers
 *   D  result      — "Here's the working" result card with editable assumptions
 *   E  priced      — materials priced from library, ready to add to quote
 *
 * Architecture (strict separation):
 *   LLM (estimatorParse.js)   → NL → structured { calcType, inputs, missing, assumptionOverrides }
 *   Engine (estimator/engine.js) → structured inputs → { lines (qty/unit), notes }
 *   Pricing (materials.js)    → lines → matched library items → priced quote lines
 *
 * The LLM NEVER does arithmetic.
 * profit math (getJobProfit) is NEVER touched here.
 * Quote lines carry buyPrice stashed + provenance:'calc' — NO cost deductions.
 *
 * Props:
 *   materials        {object[]}  — full materials library (pre-loaded in parent)
 *   defaultMarkup    {number}    — profile default markup %
 *   quotaAllowed     {boolean}   — from work-it-out-quota/check
 *   isPro            {boolean}
 *   onAddLines       {(lines) → void}  — called when user taps "Add to quote"
 *   onClose          {() → void}
 *   onOpenAddMaterial {(desc, cb) → void} — opens AddMaterialModal for no-price lines
 */

import { useState, useRef } from 'react';
import { parseEstimate }    from '../lib/estimatorParse';
import { runCalc, getCalc } from '../lib/estimator/engine';
import { filterMaterials, sellPrice, resolveMarkup } from '../lib/materials';
import Icon from './Icon';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

// ── Assumption labels (display-friendly) ─────────────────────────────────────
const ASSUMPTION_META = {
  slabCoverageM2:   { label: 'Slab size',        unit: 'm² / slab',   step: 0.01 },
  wastage:          { label: 'Wastage',           unit: '%',            step: 1,    scale: 100 },
  subBaseDepthM:    { label: 'Sub-base depth',    unit: 'mm',           step: 10,   scale: 1000 },
  subBaseDensity:   { label: 'Sub-base density',  unit: 't/m³',         step: 0.1 },
  beddingDepthM:    { label: 'Bedding depth',     unit: 'mm',           step: 5,    scale: 1000 },
  beddingDensity:   { label: 'Bedding density',   unit: 't/m³',         step: 0.1 },
  cementBagsPerM2:  { label: 'Cement',            unit: 'bags/m²',      step: 0.05 },
  brickLengthM:     { label: 'Brick + joint',     unit: 'mm',           step: 5,    scale: 1000 },
  edgingWastage:    { label: 'Edging wastage',    unit: '%',            step: 1,    scale: 100 },
  bricksPerM2Single:{ label: 'Bricks/m²',         unit: 'each',         step: 1 },
  blocksPerM2Single:{ label: 'Blocks/m²',         unit: 'each',         step: 1 },
  mortarM3PerM2Single:{ label: 'Mortar depth',    unit: 'mm',           step: 1,    scale: 1000 },
};

function displayAssumptionValue(key, val) {
  const meta = ASSUMPTION_META[key];
  if (!meta || Array.isArray(val)) return String(val);
  if (meta.scale) return String(Math.round(val * meta.scale));
  return String(val);
}

function parseAssumptionInput(key, strVal) {
  const meta = ASSUMPTION_META[key];
  const n = parseFloat(strVal);
  if (isNaN(n)) return null;
  if (meta?.scale) return n / meta.scale;
  return n;
}

// ── Clarify questions (max 2, in priority order) ──────────────────────────────
const CLARIFY_PRIORITY = {
  patio:     ['areaM2', 'edgingType'],
  brickWall: ['wallLengthM', 'wallHeightM', 'skin', 'brickOrBlock'],
};

const CLARIFY_CHIP_CONFIG = {
  areaM2: {
    question: 'What size area are we talking?',
    type: 'number',
    unit: 'm²',
    placeholder: 'e.g. 20',
  },
  edgingType: {
    question: 'What size slabs?',
    chips: [
      { label: '600×600', value: { slabCoverageM2Assumption: 0.36, edgingType: 'unknown' }, assumptionKey: 'slabCoverageM2' },
      { label: '450×450', value: { slabCoverageM2Assumption: 0.2025 } },
      { label: 'Other', value: {} },
    ],
    secondaryQuestion: 'Any brick edging?',
    secondaryChips: [
      { label: 'Single skin brick', value: 'brick' },
      { label: 'Block edge', value: 'block' },
      { label: 'No edging', value: 'none' },
    ],
  },
  wallLengthM: {
    question: 'How long is the wall?',
    type: 'number',
    unit: 'm',
    placeholder: 'e.g. 5',
  },
  wallHeightM: {
    question: 'How high is the wall?',
    type: 'number',
    unit: 'm',
    placeholder: 'e.g. 1.2',
  },
  skin: {
    question: 'Single or double skin?',
    chips: [
      { label: 'Single skin', value: 'single' },
      { label: 'Double skin', value: 'double' },
    ],
  },
  brickOrBlock: {
    question: 'Brick or block?',
    chips: [
      { label: 'Brick', value: 'brick' },
      { label: 'Block', value: 'block' },
    ],
  },
};

// ── Match a material line to the library ──────────────────────────────────────
function matchMaterialToLibrary(materialName, libraryItems, defaultMarkup) {
  const candidates = filterMaterials(libraryItems, materialName);
  if (!candidates.length) return null;
  const match = candidates[0];
  const markup = resolveMarkup(match.default_markup, defaultMarkup);
  const sell = sellPrice(match.cost || 0, markup);
  return {
    materialId:  match.id,
    desc:        match.desc,
    buyPrice:    match.cost || 0,
    cost:        sell,
    unit:        match.unit || null,
    provenance:  'calc',
  };
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function EstimatorSheet({
  materials = [],
  defaultMarkup = 20,
  quotaAllowed = true,
  isPro = false,
  onAddLines,
  onClose,
  onOpenAddMaterial,
}) {
  // ── Sheet state ──────────────────────────────────────────────────────────────
  // 'input'   → B: NL text input / structured fields
  // 'clarify' → C: one-at-a-time missing input questions
  // 'result'  → D: result card with editable assumptions
  // 'priced'  → E: library-matched, priced lines
  const [sheetState, setSheetState] = useState('input');

  // B — input
  const [description, setDescription] = useState('');
  const [showStructured, setShowStructured] = useState(false);
  const [structuredInputs, setStructuredInputs] = useState({});
  const [isWorking, setIsWorking]  = useState(false);
  const [workingDeferred, setWorkingDeferred] = useState(false);
  const workingTimerRef = useRef(null);

  // Voice (reuse same SR pattern as AddJobModal)
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const recogRef = useRef(null);

  // C — clarify
  const [pendingCalcType, setPendingCalcType]         = useState(null);
  const [pendingInputs, setPendingInputs]             = useState({});
  const [pendingAssumptions, setPendingAssumptions]   = useState({});
  const [clarifyQueue, setClarifyQueue]               = useState([]);
  const [clarifyAnswers, setClarifyAnswers]           = useState({});
  const [clarifyNumericInput, setClarifyNumericInput] = useState('');

  // D — result card
  const [calcResult, setCalcResult]                       = useState(null);
  const [effectiveAssumptions, setEffectiveAssumptions]   = useState({});
  const [assumptionEdits, setAssumptionEdits]             = useState({});
  const [assumptionsOpen, setAssumptionsOpen]             = useState(false);
  const [resultCalcType, setResultCalcType]               = useState(null);
  const [resultInputs, setResultInputs]                   = useState({});

  // E — priced lines
  const [pricedLines, setPricedLines] = useState([]);

  const [error, setError] = useState('');

  // ── Voice helpers ─────────────────────────────────────────────────────────────
  function startVoice() {
    if (!SR) return;
    try {
      const r = new SR();
      const lang = localStorage.getItem('jp.voiceLang') || 'en-GB';
      r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      let finalText = '';
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript + ' ';
          else interim += res[0].transcript;
        }
        const combined = (finalText + interim).trim();
        setVoiceTranscript(combined);
        setDescription(combined);
      };
      r.onerror = () => setVoiceActive(false);
      r.onend = () => setVoiceActive(false);
      recogRef.current = r;
      r.start();
      setVoiceActive(true);
    } catch {
      setVoiceActive(false);
    }
  }

  function stopVoice() {
    try { recogRef.current?.stop(); } catch {}
    setVoiceActive(false);
  }

  // ── Run the estimator ─────────────────────────────────────────────────────────
  async function runEstimator(descText, extraInputs = {}, assumptionOverrides = {}) {
    if (!quotaAllowed) {
      setError("You've used your free estimates this month. Go Pro for unlimited (£12/mo).");
      return;
    }

    setError('');
    setIsWorking(true);
    setWorkingDeferred(false);
    workingTimerRef.current = setTimeout(() => setWorkingDeferred(true), 400);

    let parseResult;
    try {
      parseResult = await parseEstimate(descText);
    } catch {
      parseResult = { calcType: null, inputs: {}, missing: [], assumptionOverrides: {} };
    }

    clearTimeout(workingTimerRef.current);
    setIsWorking(false);
    setWorkingDeferred(false);

    // Merge any structured inputs on top of parsed inputs
    const mergedInputs = { ...parseResult.inputs, ...extraInputs };
    const mergedAssumptions = { ...parseResult.assumptionOverrides, ...assumptionOverrides };

    if (!parseResult.calcType) {
      setError("Couldn't work out the job type — try describing a patio or a brick wall.");
      return;
    }

    // Determine what's still missing after merging
    const calc = getCalc(parseResult.calcType);
    if (!calc) {
      setError("That job type isn't supported yet.");
      return;
    }

    // Check required inputs against what we have
    const remaining = getRemainingMissing(parseResult.calcType, mergedInputs, parseResult.missing);

    if (remaining.length > 0) {
      // Cap at 2 clarify questions
      const priority = CLARIFY_PRIORITY[parseResult.calcType] || remaining;
      const queue = remaining
        .filter(k => priority.includes(k) || true)
        .sort((a, b) => {
          const ai = priority.indexOf(a);
          const bi = priority.indexOf(b);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        })
        .slice(0, 2);

      setPendingCalcType(parseResult.calcType);
      setPendingInputs(mergedInputs);
      setPendingAssumptions(mergedAssumptions);
      setClarifyQueue(queue);
      setClarifyAnswers({});
      setClarifyNumericInput('');
      setSheetState('clarify');
      return;
    }

    // All inputs present — run the engine
    deliverResult(parseResult.calcType, mergedInputs, mergedAssumptions);
  }

  function getRemainingMissing(calcType, inputs, parsedMissing) {
    // Only keep missing keys that genuinely aren't resolved yet
    if (!Array.isArray(parsedMissing)) return [];
    return parsedMissing.filter(key => inputs[key] == null || inputs[key] === '');
  }

  function deliverResult(calcType, inputs, assumptionOverrides) {
    const calc = getCalc(calcType);
    if (!calc) return;

    const { lines, notes, effectiveAssumptions: ea } = runCalc(calc, inputs, assumptionOverrides);

    setResultCalcType(calcType);
    setResultInputs(inputs);
    setCalcResult({ lines, notes });
    setEffectiveAssumptions(ea);
    setAssumptionEdits({});
    setAssumptionsOpen(false);
    setSheetState('result');
  }

  // ── Re-run the engine when assumptions are edited ──────────────────────────
  function rerunWithAssumptions(newAssumptionEdits) {
    const calc = getCalc(resultCalcType);
    if (!calc) return;
    const merged = { ...pendingAssumptions, ...newAssumptionEdits };
    const { lines, notes, effectiveAssumptions: ea } = runCalc(calc, resultInputs, merged);
    setCalcResult({ lines, notes });
    setEffectiveAssumptions(ea);
  }

  // ── Price the result lines against the library ─────────────────────────────
  function priceLines() {
    if (!calcResult?.lines?.length) return;

    const priced = calcResult.lines.map(line => {
      const match = matchMaterialToLibrary(line.material, materials, defaultMarkup);
      if (match) {
        return {
          ...match,
          qty:          line.qty,
          unit:         line.unit,
          provenance:   'calc',
          lowConfidence: false,
        };
      }
      return {
        desc:         line.material,
        qty:          line.qty,
        unit:         line.unit,
        cost:         '',
        buyPrice:     null,
        materialId:   null,
        provenance:   'calc',
        lowConfidence: true,
      };
    });

    setPricedLines(priced);
    setSheetState('priced');
  }

  // ── Handle "Add to quote" ─────────────────────────────────────────────────
  function addToQuote() {
    // Convert to the line-item shape AddJobModal expects:
    //   { desc, cost, qty?, unit?, buyPrice?, materialId?, provenance, lowConfidence? }
    const lines = pricedLines.map(l => ({
      desc:         l.desc,
      cost:         l.cost != null ? String(l.cost) : '',
      ...(l.qty != null  ? { qty: l.qty }          : {}),
      ...(l.unit         ? { unit: l.unit }         : {}),
      ...(l.buyPrice != null ? { buyPrice: l.buyPrice } : {}),
      ...(l.materialId   ? { materialId: l.materialId } : {}),
      provenance:    'calc',
      ...(l.lowConfidence ? { lowConfidence: true } : {}),
    }));
    onAddLines(lines);
    onClose();
  }

  const hasAnyMatch   = pricedLines.some(l => !l.lowConfidence);
  const hasAnyMissing = pricedLines.some(l => l.lowConfidence);
  const allMissing    = pricedLines.length > 0 && pricedLines.every(l => l.lowConfidence);

  // ── Clarify: apply chip answer and advance or run ──────────────────────────
  function applyClarifyAnswer(key, value) {
    const newAnswers = { ...clarifyAnswers, [key]: value };
    setClarifyAnswers(newAnswers);

    // Merge into pending inputs
    const newInputs = { ...pendingInputs };
    const newAssumptions = { ...pendingAssumptions };

    if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([k, v]) => {
        if (k.endsWith('Assumption')) {
          newAssumptions[k.replace('Assumption', '')] = v;
        } else {
          newInputs[k] = v;
        }
      });
    } else {
      newInputs[key] = value;
    }

    // Remove this key from the clarify queue
    const nextQueue = clarifyQueue.filter(k => k !== key);
    setClarifyQueue(nextQueue);
    setPendingInputs(newInputs);
    setPendingAssumptions(newAssumptions);
    setClarifyNumericInput('');

    if (nextQueue.length === 0) {
      // All clarify questions answered — run the engine
      deliverResult(pendingCalcType, newInputs, newAssumptions);
    }
  }

  function applyClarifyNumeric(key) {
    const n = parseFloat(clarifyNumericInput);
    if (isNaN(n) || n <= 0) {
      setError('Enter a valid number');
      return;
    }
    applyClarifyAnswer(key, n);
    setError('');
  }

  // ── Assumption edit ────────────────────────────────────────────────────────
  function handleAssumptionChange(key, strVal) {
    const parsed = parseAssumptionInput(key, strVal);
    const newEdits = { ...assumptionEdits, [key]: strVal };
    setAssumptionEdits(newEdits);
    if (parsed !== null) {
      const resolvedEdits = Object.fromEntries(
        Object.entries(newEdits)
          .map(([k, v]) => [k, parseAssumptionInput(k, v)])
          .filter(([, v]) => v !== null)
      );
      rerunWithAssumptions(resolvedEdits);
    }
  }

  const currentClarifyKey = clarifyQueue[0];
  const currentClarifyConfig = currentClarifyKey ? CLARIFY_CHIP_CONFIG[currentClarifyKey] : null;

  // ── Which assumptions are relevant to show in the panel ───────────────────
  const relevantAssumptionKeys = calcResult?.lines?.length
    ? [...new Set(calcResult.lines.flatMap(l => l.assumptionsUsed || []))]
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-tall est-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Work it out estimator"
      >
        {/* Header */}
        <div className="aj-header">
          {sheetState !== 'input' && (
            <button
              className="aj-back-btn"
              type="button"
              onClick={() => {
                if (sheetState === 'priced')  { setSheetState('result');  return; }
                if (sheetState === 'result')  { setSheetState('clarify'); return; }
                if (sheetState === 'clarify') { setSheetState('input');   return; }
              }}
              aria-label="Back"
            >
              <Icon name="arrow-left" size={20} />
            </button>
          )}
          <h3 className="modal-title">Work it out</h3>
          <button className="aj-close-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* ══ B — INPUT ══════════════════════════════════════════════════════ */}
        {sheetState === 'input' && (
          <>
            {/* Big NL input */}
            <div className="est-nl-wrap">
              <textarea
                className="est-nl-input"
                placeholder="e.g. 6 by 6 metre patio, single skin brick edging"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                aria-label="Describe the job"
              />
              {/* Mic button */}
              {SR && (
                <button
                  type="button"
                  className={`est-mic-btn${voiceActive ? ' est-mic-btn--active' : ''}`}
                  onClick={voiceActive ? stopVoice : startVoice}
                  aria-label="Speak the job"
                >
                  <Icon name="voice" size={20} />
                </button>
              )}
            </div>

            {voiceTranscript && (
              <div className="aj-transcript" dir="auto">&ldquo;{voiceTranscript}&rdquo;</div>
            )}

            <p className="est-helper">Plain words are fine — sizes help most.</p>

            {/* Quota warning */}
            {!isPro && !quotaAllowed && (
              <p className="modal-error est-quota-error">
                You&rsquo;ve used your free estimates this month. Go Pro for unlimited (£12/mo).
              </p>
            )}

            {error && <p className="modal-error">{error}</p>}

            {/* Working spinner (deferred >400ms) */}
            {isWorking && workingDeferred && (
              <div className="est-working">
                <Icon name="loading" size={20} />
                <span>Working it out…</span>
              </div>
            )}

            {!isWorking && (
              <button
                className="btn-primary btn-large aj-save-btn"
                disabled={!description.trim() || !quotaAllowed}
                onClick={() => runEstimator(description, showStructured ? structuredInputs : {})}
              >
                Work it out
              </button>
            )}

            {/* Structured fields toggle */}
            <div className="aj-footer-links">
              <button
                type="button"
                className="link-btn"
                onClick={() => setShowStructured(v => !v)}
              >
                {showStructured ? 'Hide typed sizes' : 'Type the sizes instead'}
              </button>
            </div>

            {showStructured && (
              <StructuredFields
                inputs={structuredInputs}
                onChange={setStructuredInputs}
              />
            )}
          </>
        )}

        {/* ══ C — CLARIFY ════════════════════════════════════════════════════ */}
        {sheetState === 'clarify' && currentClarifyConfig && (
          <>
            <p className="est-clarify-question">{currentClarifyConfig.question}</p>

            {currentClarifyConfig.chips ? (
              <div className="est-clarify-chips">
                {currentClarifyConfig.chips.map(chip => (
                  <button
                    key={chip.label}
                    type="button"
                    className="aj-chip"
                    onClick={() => applyClarifyAnswer(currentClarifyKey, chip.value ?? chip.label)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="est-clarify-numeric">
                <input
                  type="number"
                  inputMode="decimal"
                  className="est-clarify-number-input"
                  placeholder={currentClarifyConfig.placeholder}
                  value={clarifyNumericInput}
                  onChange={e => { setClarifyNumericInput(e.target.value); setError(''); }}
                  aria-label={currentClarifyConfig.question}
                />
                <span className="est-clarify-unit">{currentClarifyConfig.unit}</span>
              </div>
            )}

            {error && <p className="modal-error">{error}</p>}

            {!currentClarifyConfig.chips && (
              <button
                className="btn-primary btn-large aj-save-btn"
                style={{ marginTop: 16 }}
                onClick={() => applyClarifyNumeric(currentClarifyKey)}
              >
                Continue
              </button>
            )}

            <div className="aj-footer-links" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  // Skip this question — proceed with defaults
                  const nextQueue = clarifyQueue.filter(k => k !== currentClarifyKey);
                  if (nextQueue.length === 0) {
                    deliverResult(pendingCalcType, pendingInputs, pendingAssumptions);
                  } else {
                    setClarifyQueue(nextQueue);
                  }
                }}
              >
                Skip — use defaults
              </button>
            </div>
          </>
        )}

        {/* ══ D — RESULT ═════════════════════════════════════════════════════ */}
        {sheetState === 'result' && calcResult && (
          <>
            <p className="est-result-header">Here&rsquo;s the working</p>
            <p className="est-result-sub">
              ~ estimate, not a guarantee. Check it against the job.
            </p>

            {/* Material quantity rows */}
            <div className="est-result-lines">
              {calcResult.lines.map((line, idx) => (
                <ResultLineRow
                  key={idx}
                  line={line}
                  onQtyChange={(newQty) => {
                    setCalcResult(prev => ({
                      ...prev,
                      lines: prev.lines.map((l, i) => i === idx ? { ...l, qty: newQty } : l),
                    }));
                  }}
                />
              ))}
            </div>

            {/* Notes */}
            {calcResult.notes?.length > 0 && (
              <div className="est-result-notes">
                {calcResult.notes.map((n, i) => (
                  <p key={i} className="est-result-note">{n}</p>
                ))}
              </div>
            )}

            {/* Editable assumptions panel */}
            <button
              type="button"
              className="est-assumptions-toggle"
              onClick={() => setAssumptionsOpen(v => !v)}
              aria-expanded={assumptionsOpen}
            >
              <Icon name={assumptionsOpen ? 'chevron-up' : 'chevron-down'} size={16} />
              Assumptions{assumptionsOpen ? '' : ' — tap to adjust'}
            </button>

            {assumptionsOpen && (
              <div className="est-assumptions-panel">
                {relevantAssumptionKeys.map(key => {
                  const meta = ASSUMPTION_META[key];
                  if (!meta || Array.isArray(effectiveAssumptions[key])) return null;
                  const currentDisplay = assumptionEdits[key] != null
                    ? assumptionEdits[key]
                    : displayAssumptionValue(key, effectiveAssumptions[key]);
                  return (
                    <div key={key} className="est-assumption-row">
                      <label className="est-assumption-label" htmlFor={`assump-${key}`}>
                        {meta.label}
                      </label>
                      <div className="est-assumption-input-wrap">
                        <input
                          id={`assump-${key}`}
                          type="number"
                          inputMode="decimal"
                          className="est-assumption-input"
                          value={currentDisplay}
                          onChange={e => handleAssumptionChange(key, e.target.value)}
                          step={meta.step}
                        />
                        <span className="est-assumption-unit">{meta.unit}</span>
                      </div>
                    </div>
                  );
                })}
                <p className="est-assumptions-footer">
                  These are typical UK figures. Your job may differ — edit anything that&rsquo;s off.
                </p>
              </div>
            )}

            <button
              className="btn-primary btn-large aj-save-btn"
              style={{ marginTop: 16 }}
              onClick={priceLines}
            >
              Price it up
            </button>
          </>
        )}

        {/* ══ E — PRICED ═════════════════════════════════════════════════════ */}
        {sheetState === 'priced' && (
          <>
            {/* Confidence summary */}
            {!allMissing && hasAnyMatch && !hasAnyMissing && (
              <p className="est-priced-notice est-priced-notice--ok">
                Priced from your saved materials.
              </p>
            )}
            {allMissing && (
              <p className="est-priced-notice est-priced-notice--none">
                Nothing saved yet — add prices as you go and they&rsquo;ll be ready next time.
              </p>
            )}
            {!allMissing && hasAnyMissing && (
              <p className="est-priced-notice est-priced-notice--partial">
                Some prices missing. Add them or leave blank and price the quote your way.
              </p>
            )}

            {/* Priced line rows */}
            <div className="est-priced-lines">
              {pricedLines.map((line, idx) => (
                <PricedLineRow
                  key={idx}
                  line={line}
                  onCostChange={(v) => {
                    setPricedLines(prev => prev.map((l, i) => i === idx ? { ...l, cost: v } : l));
                  }}
                  onAddPrice={() => onOpenAddMaterial?.(line.desc, (saved) => {
                    if (saved) {
                      const markup = resolveMarkup(saved.default_markup, defaultMarkup);
                      const sell   = sellPrice(saved.cost || 0, markup);
                      setPricedLines(prev => prev.map((l, i) => i === idx ? {
                        ...l,
                        cost:         String(sell),
                        buyPrice:     saved.cost || 0,
                        materialId:   saved.id,
                        lowConfidence: false,
                      } : l));
                    }
                  })}
                />
              ))}
            </div>

            <button
              className="btn-primary btn-large aj-save-btn"
              style={{ marginTop: 16 }}
              onClick={addToQuote}
            >
              Add to quote
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── ResultLineRow — one quantity row in the "Here's the working" card ─────────
function ResultLineRow({ line, onQtyChange }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(String(line.qty));

  if (editing) {
    return (
      <div className="est-result-line est-result-line--editing">
        <span className="est-result-material">~ {line.material}</span>
        <div className="est-result-qty-edit">
          <input
            type="number"
            inputMode="decimal"
            className="est-result-qty-input"
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            autoFocus
          />
          <span className="est-result-unit">{line.unit}</span>
          <button
            type="button"
            className="est-result-edit-confirm"
            onClick={() => {
              const n = parseFloat(editVal);
              if (!isNaN(n) && n > 0) onQtyChange(n);
              setEditing(false);
            }}
          >
            <Icon name="check" size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="est-result-line">
      <span className="est-result-tilde" aria-hidden="true">~</span>
      <span className="est-result-qty">{line.qty}</span>
      <span className="est-result-unit">{line.unit}</span>
      <span className="est-result-material">{line.material}</span>
      <button
        type="button"
        className="est-result-edit-btn"
        onClick={() => { setEditVal(String(line.qty)); setEditing(true); }}
        aria-label={`Edit quantity for ${line.material}`}
      >
        edit
      </button>
    </div>
  );
}

// ── PricedLineRow — one priced line in state E ────────────────────────────────
function PricedLineRow({ line, onCostChange, onAddPrice }) {
  return (
    <div className={`est-priced-line${line.lowConfidence ? ' est-priced-line--missing' : ''}`}>
      <div className="est-priced-line-desc">
        <span className="est-priced-material">{line.desc}</span>
        {line.qty != null && (
          <span className="est-priced-qty">{line.qty} {line.unit}</span>
        )}
      </div>
      <div className="est-priced-line-right">
        {line.lowConfidence ? (
          <button
            type="button"
            className="est-add-price-chip"
            onClick={onAddPrice}
          >
            Add price
          </button>
        ) : (
          <div className="est-priced-cost-wrap">
            <span className="aj-quote-line-currency">£</span>
            <input
              type="number"
              inputMode="decimal"
              className="est-priced-cost-input"
              value={line.cost}
              onChange={e => onCostChange(e.target.value)}
              aria-label={`Price for ${line.desc}`}
            />
          </div>
        )}
      </div>
      {line.lowConfidence && (
        <p className="est-no-price-copy">
          No saved price for this yet. Add one, or leave it and price the quote your way.
        </p>
      )}
    </div>
  );
}

// ── StructuredFields — typed dimension inputs when user prefers not to describe ─
function StructuredFields({ inputs, onChange }) {
  function set(key, val) {
    onChange(prev => ({ ...prev, [key]: val }));
  }

  return (
    <div className="est-structured-fields modal-fields">
      <label>
        <span>Length (m)</span>
        <input type="number" inputMode="decimal" value={inputs.lengthM || ''} onChange={e => set('lengthM', parseFloat(e.target.value) || '')} placeholder="e.g. 6" />
      </label>
      <label>
        <span>Width (m)</span>
        <input type="number" inputMode="decimal" value={inputs.widthM || ''} onChange={e => set('widthM', parseFloat(e.target.value) || '')} placeholder="e.g. 6" />
      </label>
      <label>
        <span>Or: area (m²)</span>
        <input type="number" inputMode="decimal" value={inputs.areaM2 || ''} onChange={e => set('areaM2', parseFloat(e.target.value) || '')} placeholder="e.g. 36" />
      </label>
      <label>
        <span>Wall height (m)</span>
        <input type="number" inputMode="decimal" value={inputs.wallHeightM || ''} onChange={e => set('wallHeightM', parseFloat(e.target.value) || '')} placeholder="e.g. 1.2" />
      </label>
    </div>
  );
}
