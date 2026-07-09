import { useEffect, useRef, useState } from 'react';
import { parseJobFromSpeech } from '../lib/voiceParse';
import { generateQuote } from '../lib/generateQuote';
import { logTelemetry } from '../lib/telemetry';
import { calcMarginForecast, marginForecastState, markupTeachCopy } from '../lib/marginForecast';
import { saveLineItemToLibrary, resolveMarkup } from '../lib/materials';
import { sendQuote, needsBankGate } from '../lib/sendQuote';
import Icon from './Icon';
import MaterialTypeAhead from './MaterialTypeAhead';
import MarkupChip from './MarkupChip';
import EstimatorSheet from './EstimatorSheet';
import BankGateSheet from './BankGateSheet';
import { checkEstimatorQuota } from '../lib/estimatorQuota';
import { useDraftAutosave } from '../lib/useDraftAutosave';
import { haptic } from '../lib/haptics';
import { playMicStartEarcon, playMicStopEarcon } from '../lib/voiceEarcons';
import { playSendEarcon } from '../lib/momentEarcons';

// Deposit percent presets for the voice-quote confirm card — mirrors
// ReviewSheet's DEPOSIT_PRESETS so the two surfaces feel identical.
const CONFIRM_DEPOSIT_PRESETS = [0, 25, 50];

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

const PAYMENT_CHIPS = [
  { id: 'awaiting', label: 'Awaiting' },
  { id: 'cash',     label: 'Cash' },
  { id: 'bank',     label: 'Bank' },
  { id: 'card',     label: 'Card' },
];

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(isoDate) {
  try {
    const d = new Date(isoDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = d - today;
    if (diff === 0) return 'Today';
    if (diff === -86400000) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return isoDate;
  }
}

// Auto-name for jobs saved without a job name from the micro-log.
// e.g. "Job · Fri 30 May"
function autoJobName() {
  const d = new Date();
  return 'Job · ' + d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// ── Trade-aware voice hint ─────────────────────────────────────────────────────
// Returns a short example sentence the user can say, tailored to their primary
// trade. Purely cosmetic — does not affect parsing logic in voiceParse.js.
// Falls back to a generic example when no trade is set.
export function getTradeVoiceHint(tradePrimary) {
  const map = {
    plumber:                  'Burst pipe Mrs Jones one eighty cash',
    gas_engineer:             'Boiler service Mrs Mitchell one twenty',
    heating_engineer:         'Heating flush Mr Evans two fifty bank',
    electrician:              'Replace consumer unit Mr Patel four fifty',
    builder:                  'Foundation work site London three thousand',
    carpenter_joiner:         'Fit kitchen Mr Harris six hundred cash',
    decorator:                'Repaint hallway Mrs Brown four hundred',
    plasterer:                'Skim bedroom ceiling Dave two eighty',
    roofer:                   'Ridge tile repair Mr Clark three sixty',
    tiler:                    'Bathroom tiling Mrs White five hundred',
    landscaper_groundworker:  'Turf garden Mr Green eight hundred',
  };
  const key = (tradePrimary || '').toLowerCase();
  return map[key] || 'Kitchen for John, £4,800 plus VAT, 25% deposit';
}

// ── Draft autosave — "resume your quote?" ────────────────────────────────────
// A draft is worth persisting/resuming only once it has some real content —
// an untouched form should never surface as a "Resume your quote?" prompt.
function isDraftEmpty(s) {
  const hasLineItemContent = Array.isArray(s.lineItems) &&
    s.lineItems.some(li => (li.desc || '').trim() || parseFloat(li.cost) > 0);
  return !(
    (s.amount || '').trim() ||
    (s.customer || '').trim() ||
    (s.name || '').trim() ||
    (s.summary || '').trim() ||
    (s.qTotal || '').trim() ||
    (s.notes || '').trim() ||
    (s.transcript || '').trim() ||
    (s.quoteTranscript || '').trim() ||
    hasLineItemContent
  );
}

export default function AddJobModal({ onClose, onSave, _onOpenDetailed, defaultMode, onSaveAndSend, onVoiceQuoteSave, profile, onUpdateJob, flash, tradePrimary, initialDate, materials, defaultMarkup, onBrowseMaterials, onMaterialSaved, initialCustomer = '', initialPhone = '', initialAddress = '', resumeDraft = null, enableAutosave = true }) {
  // 'micro'          — Stage 1: fast capture (amount + paid-by + Save it)
  // 'details'        — Stage 2: full form (name, customer, date, more options)
  // 'quote'          — Create-quote surface: voice OR type, summary + total + optional line items
  // Voice sub-states within 'details' and 'quote': 'listening' | 'parsing' | 'confirm' | 'manual'
  //
  // defaultMode="voice"          — mounts into 'details', starts voice immediately (user tapped mic on Today).
  // defaultMode="quote"          — mounts into 'quote', starts voice immediately.
  // defaultMode="details-manual" — mounts into 'details', no mic auto-start (opened from calendar).
  // No prop (or 'micro')         — default 'micro' keypad view (Stage 1).
  // resumeDraft.view (when present) wins over defaultMode — resuming a saved
  // draft always re-opens on the exact surface the trader was last editing.
  const [view, setView] = useState(
    resumeDraft?.view ? resumeDraft.view :
    defaultMode === 'voice'          ? 'details' :
    defaultMode === 'details-manual' ? 'details' :
    defaultMode === 'quote'          ? 'quote'   : 'micro'
  );

  // When the user navigates from Stage 1 to Stage 2 via the "+ Add the details →" button,
  // we do NOT want voice to auto-start (building-site noise). This ref tracks whether the
  // entry into details was an explicit voice request (defaultMode="voice") vs a manual nav.
  // true  = voice was explicitly requested on mount → auto-start is allowed once.
  // false = user navigated from micro, opened from calendar (details-manual), etc. → no auto-start.
  // Resuming a draft never auto-arms the mic (building sites are noisy, and the
  // trader is mid-flow already — auto-listening would talk over them).
  const voiceEntryExplicit = useRef(defaultMode === 'voice' && !resumeDraft);

  // ── Shared field state (micro + details share these) ──────────────────────
  // Every field below falls back to resumeDraft.<field> first (when a draft
  // is being resumed), then to the normal default — see draftAutosave.js /
  // useDraftAutosave.js for why and how the draft is captured in the first place.
  const [amount, setAmount]           = useState(resumeDraft?.amount ?? '');
  const [paymentChip, setPaymentChip] = useState(resumeDraft?.paymentChip || 'awaiting');
  const [name, setName]               = useState(resumeDraft?.name ?? '');
  // initialCustomer/initialPhone/initialAddress: seeded from the re-book prefill
  // when PostPaidSheet's "Book again" CTA opens this modal. Date and amount are
  // intentionally NOT pre-filled — re-books always start fresh (today + empty amount).
  const [customer, setCustomer]       = useState(resumeDraft?.customer ?? (initialCustomer || ''));
  const [phone, setPhone]             = useState(resumeDraft?.phone ?? (initialPhone || ''));
  const [jobDate, setJobDate]         = useState(resumeDraft?.jobDate || initialDate || todayISODate());
  const [materialsCostInput, setMaterialsCostInput] = useState(resumeDraft?.materialsCostInput ?? '');
  const [labourHours, setLabourHours] = useState(resumeDraft?.labourHours ?? '');
  const [notes, setNotes]             = useState(resumeDraft?.notes ?? '');
  const [deposit, setDeposit]         = useState(resumeDraft?.deposit ?? '');
  const [address, setAddress]         = useState(resumeDraft?.address ?? (initialAddress || ''));
  const [error, setError]             = useState('');
  const [moreOpen, setMoreOpen]       = useState(false);
  // amountEditOpen: Stage 2 inline amount/chip editor (✎ edit affordance on the summary chip)
  const [amountEditOpen, setAmountEditOpen] = useState(false);

  // ── Quote-specific state (only active in 'quote' view) ───────────────────
  // summary: short job description (e.g. "Kitchen renovation")
  // qTotal: the quote total amount (string while editing)
  // lineItems: array of { desc, cost } — optional breakdown rows
  // showLineItems: whether the + Add line item section is expanded
  const [summary, setSummary]           = useState(resumeDraft?.summary ?? '');
  const [qTotal, setQTotal]             = useState(resumeDraft?.qTotal ?? '');
  const [lineItems, setLineItems]       = useState(resumeDraft?.lineItems ?? []);
  const [showLineItems, setShowLineItems] = useState(!!(resumeDraft?.lineItems?.length));
  // quoteVoiceStatus mirrors voiceStatus but is owned by the quote view so
  // opening 'quote' and 'details' independently don't collide.
  // Resuming a draft never re-arms the mic: land straight on the glanceable
  // confirm card when there's already a price/description to show, otherwise
  // the manual form (never 'listening' — the trader is already mid-flow).
  const [quoteVoiceStatus, setQuoteVoiceStatus] = useState(
    resumeDraft ? ((resumeDraft.qTotal || resumeDraft.summary) ? 'confirm' : 'manual') : 'listening'
  );
  const [quoteTranscript, setQuoteTranscript]   = useState(resumeDraft?.quoteTranscript ?? '');
  const hasAutoStartedQuote = useRef(!!resumeDraft);

  // ── Voice-quote confirm-card state (10-second-signature) ────────────────────
  // Parsed straight from voiceParse's enriched shape (vat/depositPercent/depositDue).
  // quoteVat: true/false/null — drives the "+VAT" chip on the total line.
  // quoteDepositPercent: 0/25/50/custom, pre-filled from the parsed transcript.
  // quoteDepositDue: ISO date | null — informational, threaded into sendQuote().
  // confirmEditField: which single line of the glanceable card is being edited
  //   ('job' | 'customer' | 'total' | 'depositCustom' | null) — mirrors the
  //   single-toggle amountEditOpen pattern used in the Stage 2 'details' view.
  // showConfirmAddDetail: collapsed phone / itemise / margin panel.
  // showBankGate / confirmSendBusy: voice-confirm's own send-flow state.
  const [quoteVat, setQuoteVat]                 = useState(resumeDraft?.quoteVat ?? null);
  const [quoteDepositPercent, setQuoteDepositPercent] = useState(resumeDraft?.quoteDepositPercent ?? 0);
  const [quoteDepositDue, setQuoteDepositDue]   = useState(resumeDraft?.quoteDepositDue ?? null);
  const [confirmEditField, setConfirmEditField] = useState(null);
  const [showConfirmAddDetail, setShowConfirmAddDetail] = useState(false);
  const [showBankGate, setShowBankGate]         = useState(false);
  const [confirmSendBusy, setConfirmSendBusy]   = useState(false);
  // bankPatchOverride: optimistic local copy of sort_code/account_number saved
  // via the bank-gate this session — merged over the `profile` prop so a
  // just-saved bank detail is reflected immediately without waiting for the
  // parent's profile state to refresh. Mirrors ReviewSheet's localProfile.
  const [bankPatchOverride, setBankPatchOverride] = useState(null);
  const effectiveProfile = bankPatchOverride ? { ...(profile || {}), ...bankPatchOverride } : profile;

  // ── Margin-aware quote state (TRADER-ONLY — never passed to customer surfaces) ──
  // estCost: optional trader spend in pounds (materials, parts, hire).
  //   Stored separately from line-item `cost` (which holds the customer price).
  //   Key name is estCost, never `cost`, to avoid any confusion with the existing field.
  // showMarginSection: collapsed by default so the 30-sec quote flow is untouched.
  // showMarkupReveal: one-tap reveal for the markup teach copy.
  // seenMarginReassurance: localStorage gate for the first-use "only you see this" message.
  const [estCost, setEstCost]                   = useState(resumeDraft?.estCost ?? '');
  const [showMarginSection, setShowMarginSection] = useState(false);
  const [showMarkupReveal, setShowMarkupReveal]   = useState(false);
  const seenMarginReassurance = typeof localStorage !== 'undefined'
    ? localStorage.getItem('jp.margin_reassurance_shown') === 'yes'
    : true;

  // ── Materials type-ahead state ───────────────────────────────────────────────
  // typeAheadIdx: which line-item row has the type-ahead visible (-1 = none)
  // savedSnack: transient snackbar message after "Save for next time" bookmark tap
  const [typeAheadIdx, setTypeAheadIdx]   = useState(-1);
  const [savedSnack, setSavedSnack]       = useState('');

  // ── Work it out estimator state ──────────────────────────────────────────────
  // showEstimator: whether EstimatorSheet is mounted
  // estimatorQuota: { allowed, used, quota, isPro } — checked once when sheet opens
  const [showEstimator, setShowEstimator]         = useState(false);
  const [estimatorQuota, setEstimatorQuota]       = useState({ allowed: true, isPro: false });

  // ── AI Quote Builder state ──────────────────────────────────────────────────
  // aiStatus: 'idle' | 'building' | 'draft' | 'error'
  // 'building' = API call in-flight; spinner shown after 400ms (same deferred pattern)
  // 'draft'    = AI line items populated; review banner shown
  // 'error'    = generation failed; user stays on manual form
  const [aiStatus, setAiStatus]         = useState('idle');
  const [aiError, setAiError]           = useState('');
  const [showBuildingSpinner, setShowBuildingSpinner] = useState(false);
  const buildingTimerRef = useRef(null);
  // Profile hourly rate loaded after first AI build (used for "set your rate" prompt)
  const [profileHourlyRate, setProfileHourlyRate] = useState(undefined); // undefined = not yet checked
  const [showRatePrompt, setShowRatePrompt]   = useState(false);
  const [rateInput, setRateInput]             = useState('');

  // ── Voice state (active in 'details' and 'quote' views) ───────────────────
  // details-manual: initialise directly to 'form' so the user sees the form
  // immediately — no mic auto-start, no idle mic screen (building sites are noisy).
  // resumeDraft: same reasoning — always land on the form, never re-arm the mic.
  const [voiceStatus, setVoiceStatus]       = useState(
    resumeDraft || defaultMode === 'details-manual' ? 'form' : 'idle'
  );
  const [transcript, setTranscript]         = useState(resumeDraft?.transcript ?? '');
  const [retryCount, setRetryCount]         = useState(0);
  // showParsingSpinner: only true when parsing has taken >400ms — avoids a
  // distracting flash for responses that come back quickly.
  const [showParsingSpinner, setShowParsingSpinner] = useState(false);
  const recogRef        = useRef(null);
  const manualOverride  = useRef(false);
  const hasAutoStarted  = useRef(!!resumeDraft);
  const spinnerTimerRef = useRef(null);

  // ── Draft autosave — continuously persists this session so a phone call,
  // lock-screen, or OS kill mid-quote can't lose the work (see
  // src/lib/useDraftAutosave.js). Debounced on every field change, and
  // flushed immediately on visibilitychange/pagehide. clearNow() is called
  // from every save/send path below so a completed quote is never resurrected
  // as a "resume?" prompt.
  const draftSnapshot = {
    view,
    amount, paymentChip, name, customer, phone, jobDate, address,
    materialsCostInput, labourHours, notes, deposit,
    summary, qTotal, lineItems, quoteVat, quoteDepositPercent, quoteDepositDue, estCost,
    transcript, quoteTranscript,
  };
  const { clearNow: clearDraftNow } = useDraftAutosave(draftSnapshot, {
    enabled: enableAutosave,
    isEmpty: isDraftEmpty,
  });

  // Hide the bottom nav pill while the modal is open.
  useEffect(() => {
    document.body.classList.add('overlay-open');
    return () => { document.body.classList.remove('overlay-open'); };
  }, []);

  // ── Amount input ref — autofocus on mount ─────────────────────────────────
  const amountRef = useRef(null);
  useEffect(() => {
    if (view === 'micro') {
      // Small delay so the modal's CSS transition finishes before focusing
      const t = setTimeout(() => amountRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [view]);

  // ─────────────────────────────────────────────────────────────────────────
  // Voice helpers (used when the 'details' view is in listening mode)
  // ─────────────────────────────────────────────────────────────────────────

  const stopListening = () => { try { recogRef.current?.stop(); } catch {} };

  const startListening = () => {
    setError('');
    setTranscript('');
    if (!SR || !isOnline()) {
      // Offline or no Speech API — drop straight to the unified Stage 2 form
      setVoiceStatus('form');
      if (!isOnline()) setError('No signal — type it instead.');
      return;
    }
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
        setTranscript((finalText + interim).trim());
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed') {
          setError('Microphone blocked. Allow it in the address bar then try again.');
          setVoiceStatus('form');
        } else if (e.error === 'no-speech') {
          setError('');
          setVoiceStatus('idle');
        } else if (e.error === 'network') {
          setError('No signal — type it instead.');
          setVoiceStatus('form');
        } else {
          setError(`Mic error: ${e.error}`);
          setVoiceStatus('form');
        }
      };
      r.onend = () => {
        if (manualOverride.current) { manualOverride.current = false; return; }
        setVoiceStatus(s => {
          if (s === 'listening') {
            const t = (finalText || '').trim();
            if (t) { parse(t); return 'parsing'; }
            setError('');
            return 'idle';
          }
          return s;
        });
      };
      recogRef.current = r;
      r.start();
      setVoiceStatus('listening');
    } catch (err) {
      setError(`Couldn't start mic: ${err.message}`);
      setVoiceStatus('form');
    }
  };

  const parse = async (text) => {
    // Show the "Understanding…" spinner only if parsing takes longer than 400ms.
    setShowParsingSpinner(false);
    spinnerTimerRef.current = setTimeout(() => setShowParsingSpinner(true), 400);
    try {
      const parsed = await parseJobFromSpeech(text);
      clearTimeout(spinnerTimerRef.current);
      setShowParsingSpinner(false);
      const cleanName     = (parsed.name || '').trim();
      const cleanCustomer = (parsed.customer || '').trim();
      const cleanAmt      = parsed.amount;

      if (cleanAmt == null || isNaN(cleanAmt) || cleanAmt <= 0) {
        if (retryCount < 1) {
          setError("Couldn't find an amount — try again");
          setRetryCount(c => c + 1);
          setTimeout(() => startListening(), 600);
          return;
        }
        setName(cleanName);
        setCustomer(cleanCustomer);
        setAmount('');
        if (parsed.paymentType) applyPaymentType(parsed.paymentType);
        // Drop into the unified form — user can fill the amount manually.
        setVoiceStatus('form');
        return;
      }

      setName(cleanName || autoJobName());
      setCustomer(cleanCustomer);
      setAmount(String(cleanAmt));
      if (parsed.paymentType) applyPaymentType(parsed.paymentType);
      else setPaymentChip('awaiting');
      // Land on the single Stage 2 form pre-filled — never auto-save.
      // The big amount chip is the safety check against mishearing the amount.
      setVoiceStatus('form');
    } catch {
      clearTimeout(spinnerTimerRef.current);
      setShowParsingSpinner(false);
      // Parse error — drop into the unified form so the user can fill it manually.
      setVoiceStatus('form');
    }
  };

  function applyPaymentType(pt) {
    const t = (pt || '').toLowerCase();
    if (t === 'cash') setPaymentChip('cash');
    else if (t === 'bank' || t === 'bacs' || t === 'transfer') setPaymentChip('bank');
    else if (t === 'card') setPaymentChip('card');
    else setPaymentChip('awaiting');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Save handlers
  // ─────────────────────────────────────────────────────────────────────────

  // Micro-log save (Speed mode): amount is optional (can be blank = "add price later").
  // Job name auto-fills to "Job · {day date}". Never blocks the user.
  // via='fast' signals the parent to stay on Today and show a confirmation toast.
  // speedMode:true signals TodayScreen to also show the "Got paid?" chip toast.
  // Payment status is always Awaiting on Speed-mode save — the chip strip has been
  // removed from Stage 1. The Got Paid toast on Today is where the user sets it.
  const saveMicro = () => {
    const amt = amount.trim() ? parseFloat(amount) : null;
    if (amt !== null && (isNaN(amt) || amt <= 0)) {
      setError("That amount doesn't look right");
      return;
    }
    setError('');
    clearDraftNow();
    onSave({
      id:          crypto.randomUUID(),
      name:        autoJobName(),
      customer:    null,
      phone:       null,
      amount:      amt,
      paymentType: null,
      paid:        false,
      date:        new Date().toISOString(),
      createdAt:   new Date().toISOString(),
      via:         'fast',
      speedMode:   true,
    });
  };

  // Details-view save: job name is required only if the user has typed something
  // in the name field; otherwise falls back to autoJobName().
  //
  // buildDetailsPayload() validates and returns the payload, or null on error.
  // Both saveDetails() and saveAndSend() use it to avoid duplication.
  const buildDetailsPayload = () => {
    const resolvedName = name.trim() || autoJobName();
    const isPaid = paymentChip !== 'awaiting';
    if (isPaid && !amount.trim()) {
      setError('Add an amount before you can mark this paid');
      return null;
    }
    const amt = amount.trim() ? parseFloat(amount) : null;
    if (amt !== null && (isNaN(amt) || amt <= 0)) {
      setError("That amount doesn't look right");
      return null;
    }
    setError('');
    return {
      id:          crypto.randomUUID(),
      name:        resolvedName,
      customer:    customer.trim() || null,
      phone:       phone.trim() || null,
      amount:      amt,
      paymentType: isPaid ? paymentChip : null,
      paid:        isPaid,
      date:        jobDate ? new Date(jobDate + 'T12:00:00').toISOString() : new Date().toISOString(),
      createdAt:   new Date().toISOString(),
      ...(materialsCostInput.trim()   ? { materialsCost: parseFloat(materialsCostInput) || 0 } : {}),
      ...(labourHours.trim() ? { labourHours: parseFloat(labourHours) || 0 } : {}),
      ...(notes.trim()       ? { notes: notes.trim() } : {}),
      ...(deposit.trim()     ? { deposit: parseFloat(deposit) || 0 } : {}),
      ...(address.trim()     ? { address: address.trim() } : {}),
    };
  };

  const saveDetails = () => {
    const payload = buildDetailsPayload();
    if (!payload) return;
    clearDraftNow();
    // via='details' signals the parent to redirect to the new job's detail view.
    onSave({ ...payload, via: 'details' });
  };

  // "Save & send quote" — confirm state only, awaiting jobs only.
  // Calls onSaveAndSend(payload) so the parent can persist the job then open
  // ReviewSheet in quote mode without an intermediate job screen.
  const saveAndSend = () => {
    const payload = buildDetailsPayload();
    if (!payload) return;
    clearDraftNow();
    logTelemetry('quote_send', { source: 'voice_confirm' });
    onSaveAndSend?.(payload);
  };

  // Auto-start voice only when entering the 'details' view via an explicit voice
  // entry (defaultMode="voice"). When the user navigates here from Stage 1 via
  // the "+ Add the details →" button, voiceEntryExplicit.current is false and
  // voice does NOT auto-start — building sites are noisy.
  useEffect(() => {
    if (view !== 'details') return;
    if (hasAutoStarted.current) return;
    if (!voiceEntryExplicit.current) return;
    hasAutoStarted.current = true;
    startListening();
    return () => { try { recogRef.current?.abort(); } catch {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── Quote view: voice helpers ───────────────────────────────────────────────
  // The quote view reuses the same SR and recogRef but uses separate
  // quoteVoiceStatus / quoteTranscript state so it doesn't collide with 'details'.

  const startQuoteListening = () => {
    setError('');
    setQuoteTranscript('');
    if (!SR || !isOnline()) {
      setQuoteVoiceStatus('manual');
      if (!isOnline()) setError('No signal — type it instead.');
      return;
    }
    try {
      const r = new SR();
      const lang = localStorage.getItem('jp.voiceLang') || 'en-GB';
      // Mic grace: the voice-quote grammar is longer now (job + name + price +
      // optional VAT/deposit/due-day), so a non-continuous recognizer's own
      // short built-in pause-detection was truncating utterances mid-sentence.
      // continuous:true + our own 2s-silence auto-stop gives the trader room to
      // pause for breath without losing the end of the sentence. The big
      // "Done" button below remains the manual-stop affordance.
      r.lang = lang; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
      let finalText = '';
      let silenceTimer = null;
      const SILENCE_MS = 2000;
      const resetSilenceTimer = () => {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          try { r.stop(); } catch {}
        }, SILENCE_MS);
      };
      // onstart fires when the mic has actually armed (after the permission
      // round-trip) — not the earlier button tap — so this earcon+haptic
      // always matches the true mic state, used eyes-off mid-conversation.
      r.onstart = () => {
        playMicStartEarcon();
        haptic('light');
      };
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript + ' ';
          else interim += res[0].transcript;
        }
        setQuoteTranscript((finalText + interim).trim());
        resetSilenceTimer();
      };
      r.onerror = (e) => {
        clearTimeout(silenceTimer);
        if (e.error === 'not-allowed') {
          setError('Microphone blocked. Allow it in the address bar then try again.');
          setQuoteVoiceStatus('manual');
        } else if (e.error === 'no-speech') {
          setError('');
          setQuoteVoiceStatus('idle');
        } else if (e.error === 'network') {
          setError('No signal — type it instead.');
          setQuoteVoiceStatus('manual');
        } else {
          setError(`Mic error: ${e.error}`);
          setQuoteVoiceStatus('manual');
        }
      };
      r.onend = () => {
        clearTimeout(silenceTimer);
        // Fires on every true end of the recognition session — silence
        // auto-stop, the "Done" tap, or an error — so it's the single place
        // that reliably matches "mic is now off", unlike the manualOverride
        // short-circuit just below which only governs the parse/status logic.
        playMicStopEarcon();
        haptic('light');
        if (manualOverride.current) { manualOverride.current = false; return; }
        setQuoteVoiceStatus(s => {
          if (s === 'listening') {
            const t = (finalText || '').trim();
            if (t) { parseQuote(t); return 'parsing'; }
            setError('');
            return 'idle';
          }
          return s;
        });
      };
      recogRef.current = r;
      r.start();
      resetSilenceTimer(); // grace period even if the trader hasn't spoken yet
      setQuoteVoiceStatus('listening');
    } catch (err) {
      setError(`Couldn't start mic: ${err.message}`);
      setQuoteVoiceStatus('manual');
    }
  };

  const stopQuoteListening = () => { try { recogRef.current?.stop(); } catch {} };

  const parseQuote = async (text) => {
    setShowParsingSpinner(false);
    spinnerTimerRef.current = setTimeout(() => setShowParsingSpinner(true), 400);
    try {
      const parsed = await parseJobFromSpeech(text);
      clearTimeout(spinnerTimerRef.current);
      setShowParsingSpinner(false);
      const cleanSummary  = (parsed.name || '').trim();
      const cleanCustomer = (parsed.customer || '').trim();
      const cleanAmt      = parsed.amount;

      setSummary(cleanSummary || '');
      setCustomer(cleanCustomer);
      if (parsed.paymentType) applyPaymentType(parsed.paymentType);
      else setPaymentChip('awaiting');

      // VAT / deposit — new voice-quote fields (Change 2). Threaded straight
      // into the glanceable confirm card's chips below.
      setQuoteVat(parsed.vat ?? null);
      const parsedDepositPercent = typeof parsed.depositPercent === 'number' && parsed.depositPercent >= 0
        ? Math.min(100, parsed.depositPercent)
        : 0;
      setQuoteDepositPercent(parsedDepositPercent);
      setQuoteDepositDue(parsed.depositDue ?? null);

      if (cleanAmt != null && !isNaN(cleanAmt) && cleanAmt > 0) {
        setQTotal(String(cleanAmt));
        setConfirmEditField(null);
      } else {
        setQTotal('');
        // No amount heard — open the Total field straight into edit mode
        // (empty + focused) rather than a static "Add a price" row the
        // trader has to tap first.
        setConfirmEditField('total');
      }
      // Always land on the glanceable confirm card after a voice parse — even
      // with no amount, so the trader can tap straight into the Total field
      // (empty + focused) rather than being dropped into the full manual form.
      setQuoteVoiceStatus('confirm');

      // Store the parsed description for the "Itemise it for me" CTA
      // but do NOT auto-trigger the AI build — the user must tap the button.
      // This preserves the existing confirm/manual flow for non-AI use.
    } catch {
      clearTimeout(spinnerTimerRef.current);
      setShowParsingSpinner(false);
      setQuoteVoiceStatus('manual');
    }
  };

  // ── AI Quote Builder: invoke generate-quote and populate line items ──────────

  /**
   * Calls the generate-quote function, shows a deferred spinner, and on success
   * populates lineItems + qTotal from the AI response.
   * On failure, falls back to the manual form with the description pre-filled.
   *
   * @param {string} descriptionText — the typed/spoken job description
   * @param {number|null} knownHourlyRate — if null, prompts the user to set one first
   */
  const runAiQuoteBuild = async (descriptionText, knownHourlyRate) => {
    // If rate is unknown (undefined = not yet checked), check before proceeding.
    // This handles the "show rate prompt" path — see the call sites below.
    if (knownHourlyRate === null) {
      // No rate set — show the rate prompt first, then retry automatically
      setShowRatePrompt(true);
      return;
    }

    setAiStatus('building');
    setAiError('');
    setShowBuildingSpinner(false);

    buildingTimerRef.current = setTimeout(() => setShowBuildingSpinner(true), 400);

    try {
      const result = await generateQuote(descriptionText);

      clearTimeout(buildingTimerRef.current);
      setShowBuildingSpinner(false);

      if (result.error === 'quota_exceeded') {
        // Quota hit — show the upgrade message and fall back to manual form
        setAiStatus('error');
        setAiError(result.message || "You've used your free AI quotes this month. Go Pro for unlimited, or build this one by hand.");
        setQuoteVoiceStatus('manual');
        return;
      }

      if (result.error) {
        // Any other error — fallback to manual form, pre-filled with the description
        setAiStatus('error');
        setAiError("Couldn't build it just now — here's what I heard, fill in the prices.");
        setSummary(descriptionText);
        setQuoteVoiceStatus('manual');
        return;
      }

      // Success — populate line items and total from AI result
      logTelemetry('ai_quote_built', {
        lineItemCount: result.lineItems.length,
        hasLowConfidence: result.lineItems.some(i => i.lowConfidence),
      });

      const items = result.lineItems.map(i => ({
        desc: i.desc,
        cost: String(i.cost),
        ...(i.qty != null ? { qty: i.qty } : {}),
        ...(i.unit ? { unit: i.unit } : {}),
        ...(i.provenance ? { provenance: i.provenance } : {}),
        ...(i.lowConfidence ? { lowConfidence: true } : {}),
      }));

      setLineItems(items);
      setShowLineItems(true);
      if (result.total != null) setQTotal(String(result.total));
      if (!summary.trim() && descriptionText) setSummary(descriptionText);
      setAiStatus('draft');
      setQuoteVoiceStatus('confirm');
    } catch (_err) {
      clearTimeout(buildingTimerRef.current);
      setShowBuildingSpinner(false);
      setAiStatus('error');
      setAiError("Couldn't build it just now — here's what I heard, fill in the prices.");
      setSummary(descriptionText);
      setQuoteVoiceStatus('manual');
    }
  };

  // Auto-start voice when entering the 'quote' view.
  useEffect(() => {
    if (view !== 'quote') return;
    if (hasAutoStartedQuote.current) return;
    hasAutoStartedQuote.current = true;
    startQuoteListening();
    return () => { try { recogRef.current?.abort(); } catch {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── Quote line-item helpers ────────────────────────────────────────────────

  /**
   * Computes the line-items total. Used to auto-populate qTotal when items change.
   * Returns the sum as a number, or 0 if no items.
   */
  function lineItemsTotal(items) {
    return items.reduce((s, li) => s + (parseFloat(li.cost) || 0), 0);
  }

  function addLineItem() {
    setLineItems(prev => [...prev, { desc: '', cost: '' }]);
  }

  function updateLineItem(idx, field, value) {
    setLineItems(prev => {
      const next = prev.map((li, i) => i === idx ? { ...li, [field]: value } : li);
      // Auto-sum: when line items exist, keep qTotal in sync with their sum.
      const total = lineItemsTotal(next);
      if (total > 0) setQTotal(String(total));
      return next;
    });
  }

  function removeLineItem(idx) {
    setLineItems(prev => {
      const next = prev.filter((_, i) => i !== idx);
      const total = lineItemsTotal(next);
      if (next.length > 0 && total > 0) setQTotal(String(total));
      return next;
    });
  }

  // ── Materials: select from type-ahead ────────────────────────────────────────
  // Called when the user taps a suggestion row. Fills the line item and hides
  // the type-ahead. `selected` already has cost (sell or buy depending on context)
  // and optionally buyPrice + materialId from MaterialTypeAhead.
  function handleMaterialSelect(idx, selected) {
    setLineItems(prev => {
      const next = prev.map((li, i) => i === idx ? {
        ...li,
        desc:       selected.desc,
        cost:       String(selected.cost),
        ...(selected.unit        ? { unit: selected.unit }               : {}),
        ...(selected.buyPrice    != null ? { buyPrice: selected.buyPrice } : {}),
        ...(selected.materialId  ? { materialId: selected.materialId }   : {}),
        ...(selected.provenance  ? { provenance: selected.provenance }   : {}),
      } : li);
      const total = lineItemsTotal(next);
      if (total > 0) setQTotal(String(total));
      return next;
    });
    setTypeAheadIdx(-1);
  }

  // ── Materials: save line bookmark ─────────────────────────────────────────────
  // Called when the bookmark icon on a line item or inside type-ahead is tapped.
  // Saves the current desc + cost as a buy price to the library.
  async function handleSaveLineToLibrary(lineItem) {
    const desc    = (lineItem.desc || '').trim();
    const buyPrice = lineItem.buyPrice != null ? lineItem.buyPrice : parseFloat(lineItem.cost) || 0;
    if (!desc) return;

    const mat = await saveLineItemToLibrary(
      { desc, buyPrice, unit: lineItem.unit },
      Array.isArray(materials) ? materials : []
    );
    if (mat) {
      onMaterialSaved?.(mat.saved ?? mat);
      setSavedSnack(`Saved to your materials. £${buyPrice.toFixed(2)} buy.`);
      setTimeout(() => setSavedSnack(''), 3000);
      logTelemetry('material_saved_from_line', { source: 'quote_bookmark' });
    }
  }

  // ── Quote save handlers ────────────────────────────────────────────────────

  /**
   * Validates the quote form and returns a payload object, or null on error.
   * The payload is shaped to be compatible with addJobToCloud / ReviewSheet.
   *
   * status: 'lead' (awaiting) — quote is a pre-work estimate, never paid at creation.
   * quoteStatus: 'draft' — saved but not yet sent to the customer.
   * lineItems: filled from the itemised rows if present, otherwise a single
   *   { desc: summary, cost: total } so ReviewSheet's PreviewTable renders correctly.
   */
  function buildQuotePayload() {
    const resolvedSummary = summary.trim() || 'New quote';
    const resolvedCustomer = customer.trim() || null;
    const resolvedPhone    = phone.trim() || null;

    const hasLineItems = lineItems.length > 0 && lineItems.some(li => li.desc.trim() || li.cost);
    let resolvedTotal;
    let resolvedLineItems;

    if (hasLineItems) {
      const filledItems = lineItems
        .filter(li => li.desc.trim() || parseFloat(li.cost) > 0)
        .map(li => ({ desc: li.desc.trim() || 'Item', cost: parseFloat(li.cost) || 0 }));
      resolvedTotal = filledItems.reduce((s, li) => s + li.cost, 0);
      resolvedLineItems = filledItems;
    } else {
      const parsed = qTotal.trim() ? parseFloat(qTotal) : null;
      if (parsed !== null && (isNaN(parsed) || parsed <= 0)) {
        setError("That amount doesn't look right");
        return null;
      }
      resolvedTotal = parsed;
      resolvedLineItems = parsed != null
        ? [{ desc: resolvedSummary, cost: parsed }]
        : [];
    }

    setError('');

    // estCost is TRADER-ONLY — it is stored on the job object for persistence
    // and V2 forecast-vs-actual, but is never included in lineItems, the PDF,
    // the WhatsApp message, or the public quote payload.
    const parsedEstCost = estCost.trim() ? parseFloat(estCost) : undefined;

    return {
      id:           crypto.randomUUID(),
      name:         resolvedSummary,
      summary:      resolvedSummary,
      customer:     resolvedCustomer,
      phone:        resolvedPhone,
      amount:       resolvedTotal,
      total:        resolvedTotal,
      lineItems:    resolvedLineItems,
      // vat: carries the voice-quote confirm card's "+VAT" flag (quoteVat) onto
      // the job so the quote PDF/WhatsApp renderers can show the VAT treatment
      // even when the trader's profile isn't VAT-registered. Previously this
      // never left component state — the renderers had nothing to read.
      vat:          !!quoteVat,
      paid:         false,
      paymentType:  null,
      status:       'lead',
      quoteStatus:  'draft',
      date:         new Date().toISOString(),
      createdAt:    new Date().toISOString(),
      // Trader-only spend estimate. Included only when the user entered a value.
      // ReviewSheet, invoicePDF, PublicQuoteView, and fetch-public-quote-profile
      // do not read this field — they only access lineItems, total, amount, etc.
      ...(parsedEstCost !== undefined && !isNaN(parsedEstCost) && parsedEstCost >= 0
        ? { estCost: parsedEstCost }
        : {}),
    };
  }

  /** Save as draft — persists to pipeline at Lead/Quoted stage. Nothing sent. */
  const saveQuote = () => {
    const payload = buildQuotePayload();
    if (!payload) return;
    clearDraftNow();
    logTelemetry('quote_save', { source: 'create_quote', hasLineItems: payload.lineItems.length > 1 });
    onSave(payload);
  };

  /** Save + open ReviewSheet in quote mode so the tradesperson can send via WhatsApp. */
  const saveQuoteAndSend = () => {
    const payload = buildQuotePayload();
    if (!payload) return;
    clearDraftNow();
    logTelemetry('quote_send', { source: 'create_quote', hasLineItems: payload.lineItems.length > 1 });
    onSaveAndSend?.(payload);
  };

  /**
   * "Itemise it for me" — triggers the AI quote build from whatever description
   * is currently available (typed summary, or the raw voice transcript).
   * Shared by the full manual-form button and the glanceable confirm card's
   * collapsed "Add detail" link so the logic lives in exactly one place.
   */
  const handleItemiseClick = () => {
    const desc = summary.trim() || quoteTranscript.trim();
    if (!desc) {
      setError('Add a job description first');
      return;
    }
    setError('');
    // profileHourlyRate: undefined = not yet fetched, null = confirmed unset
    // We check at the server and let it prompt if needed — pass undefined as
    // sentinel, resolved in runAiQuoteBuild via the rate prompt.
    // We optimistically run; if server returns no hourly_rate the AI uses
    // placeholder costs, which is acceptable per spec.
    runAiQuoteBuild(desc, profileHourlyRate === null ? null : 0);
  };

  // ── Voice-quote confirm card: Send button ────────────────────────────────────
  // Collapses the old double-review-surface (this card, then ReviewSheet) into
  // one: builds the payload, pre-flights the bank-gate (so the modal never
  // closes out from under a gate that needs showing), persists the job via
  // onVoiceQuoteSave (create-only — does NOT open ReviewSheet), then calls the
  // shared sendQuote() helper directly — the exact same function ReviewSheet
  // uses for the Jobs-tab / non-voice path.
  const sendVoiceConfirmQuote = async () => {
    if (confirmSendBusy) return;
    const payload = buildQuotePayload();
    if (!payload) return;

    if (needsBankGate({ profile: effectiveProfile, depositPercent: quoteDepositPercent })) {
      setShowBankGate(true);
      return;
    }

    // Tactile + iOS-safe confirm the moment the trader commits to sending —
    // same pairing as ReviewSheet's handlePrimaryTap (this card bypasses
    // ReviewSheet entirely, so it needs its own copy of the feedback, not just
    // the shared sendQuote() logic).
    haptic('medium');
    playSendEarcon();
    setConfirmSendBusy(true);
    flash?.('Sending your quote…');
    logTelemetry('quote_send', { source: 'voice_confirm', hasLineItems: payload.lineItems.length > 1 });

    // Only clear the draft once we're actually committed to sending — the
    // bank-gate early-return above must never clear it (nothing's sent yet).
    clearDraftNow();

    // Persist (INSERT) the job row first — sendQuote()'s token persist is an
    // UPDATE and needs the row to already exist. This also closes the modal
    // (onVoiceQuoteSave mirrors handleSaveAndSend's persist step in TodayScreen).
    await onVoiceQuoteSave?.(payload);

    const result = await sendQuote(payload, {
      biz: { name: effectiveProfile?.business_name || '' },
      profile: effectiveProfile,
      depositPercent: quoteDepositPercent,
      depositDue: quoteDepositDue,
      onUpdate: onUpdateJob,
      flash,
      onClose: () => {},
      setBusy: setConfirmSendBusy,
    });
    // Defensive only — the pre-flight check above already covers this path,
    // so in practice this never fires (the modal has already closed by now).
    if (result?.reason === 'bank-gate') setShowBankGate(true);
  };

  const chipClass = (id) =>
    `aj-chip${paymentChip === id ? ' aj-chip--on' : ''}`;

  const detailsSaveLabel = () => {
    if (paymentChip === 'awaiting') {
      if (!amount.trim()) return 'Save · add the price later';
      const who = customer.trim() || 'This job';
      return `Save · ${who} goes on the chase list`;
    }
    return `Save · paid by ${paymentChip}`;
  };

  // Compact summary of Stage 1 values carried into Stage 2 header.
  // e.g. "£380 · Cash" or "£380" or "No amount yet"
  const stage1Summary = () => {
    const amtLabel = amount.trim() ? `£${amount}` : null;
    const chipLabel = paymentChip !== 'awaiting'
      ? PAYMENT_CHIPS.find(c => c.id === paymentChip)?.label
      : null;
    if (amtLabel && chipLabel) return `${amtLabel} · ${chipLabel}`;
    if (amtLabel) return amtLabel;
    return 'No amount yet';
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-tall" onClick={e => e.stopPropagation()}>

        {/* ══ STAGE 1 — MICRO-LOG VIEW (Speed mode) ═════════════════════════ */}
        {view === 'micro' && (
          <>
            <div className="aj-header">
              <h3 className="modal-title">
                New job
                {!isOnline() && (
                  <span className="aj-offline-pill" aria-label="Offline">
                    <Icon name="offline" size={16} /> Offline
                  </span>
                )}
              </h3>
              <button className="aj-close-btn" onClick={onClose} aria-label="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            {/* Field label — no chip strip on Stage 1 in Speed mode */}
            <p className="aj-capture-prompt aj-capture-prompt--label">Amount</p>

            {!isOnline() && (
              <p className="aj-offline-hint">No signal — voice off. Type the amount instead.</p>
            )}

            {/* Big amount input */}
            <div className="aj-micro-amount-wrap">
              <span className="aj-micro-currency">£</span>
              <input
                ref={amountRef}
                className="aj-micro-amount"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={e => { setAmount(e.target.value); setError(''); }}
                aria-label="Amount in pounds"
              />
            </div>

            {error && <p className="modal-error">{error}</p>}

            {/* Primary action — single tap, no decisions required */}
            <button
              className="btn-primary btn-large aj-save-btn"
              onClick={saveMicro}
            >
              Log it
            </button>

            {/* Helper hint beneath primary CTA */}
            <p className="aj-speed-hint">Paid? Add details? You'll get a prompt after.</p>

            {/* Demoted details link — text-only, not a bordered button */}
            <div className="aj-footer-links">
              <button
                className="link-btn aj-details-link"
                type="button"
                onClick={() => {
                  // voiceEntryExplicit stays false — voice does NOT auto-start.
                  setVoiceStatus('form');
                  setView('details');
                }}
              >
                + Add details
              </button>
            </div>

            {/* Voice entry row — explicit tap only, no auto-arm */}
            {SR && isOnline() && (
              <button
                className="aj-say-it-row"
                type="button"
                aria-label="Say it instead — use voice"
                onClick={() => {
                  // Mark as explicit voice entry so auto-start fires once
                  voiceEntryExplicit.current = true;
                  setView('details');
                }}
              >
                <span className="aj-say-it-mic" aria-hidden="true">
                  <Icon name="voice" size={20} />
                </span>
                <span className="aj-say-it-label">Say it instead</span>
              </button>
            )}
          </>
        )}

        {/* ══ STAGE 2 — DETAILS VIEW (full Direction A form) ════════════════ */}
        {view === 'details' && (
          <>
            <div className="aj-header">
              {/* Back arrow — returns to Stage 1 with values preserved */}
              <button
                className="aj-back-btn"
                type="button"
                onClick={() => {
                  // Stop any active mic before going back
                  try { recogRef.current?.abort(); } catch {}
                  voiceEntryExplicit.current = false;
                  setView('micro');
                }}
                aria-label="Back to Step 1"
              >
                <Icon name="arrow-left" size={20} />
              </button>
              <h3 className="modal-title">Add details</h3>
              <button className="aj-close-btn" onClick={onClose} aria-label="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            {/* 2-dot stepper: ● ● = Stage 2 of 2 */}
            <div className="aj-stepper" aria-label="Step 2 of 2">
              <span className="aj-stepper-dot aj-stepper-dot--on" aria-hidden="true" />
              <span className="aj-stepper-dot aj-stepper-dot--on" aria-hidden="true" />
            </div>

            {/* Compact carry-forward summary so the user knows their Stage 1 data is safe */}
            <div className="aj-stage1-summary" aria-label="Values from step 1">
              {stage1Summary()}
            </div>

            {/* ── Voice: listening state ── */}
            {voiceStatus === 'listening' && (
              <>
                <div className="aj-mic-box">
                  <div className="aj-mic-icon"><Icon name="voice" size={32} /></div>
                  <div className="aj-mic-label">Listening…</div>
                  <div className="aj-mic-sub">Say the job, customer, and amount</div>
                </div>
                {transcript && (
                  <div className="aj-transcript" dir="auto">&ldquo;{transcript}&rdquo;</div>
                )}
                {!transcript && (
                  <div className="aj-transcript aj-transcript--hint">
                    e.g. &ldquo;{getTradeVoiceHint(tradePrimary)}&rdquo;
                  </div>
                )}
                <button
                  className="btn-primary"
                  onClick={stopListening}
                  style={{ width: '100%', marginBottom: 8, marginTop: 12 }}
                >
                  Done
                </button>
                <div className="aj-footer-links">
                  <button
                    className="link-btn"
                    onClick={() => {
                      manualOverride.current = true;
                      stopListening();
                      setVoiceStatus('form');
                    }}
                  >
                    Type instead
                  </button>
                </div>
              </>
            )}

            {/* ── Voice: idle state — mic stopped with no speech, tap to re-arm ── */}
            {voiceStatus === 'idle' && (
              <>
                <button
                  type="button"
                  className="aj-mic-box aj-mic-box--idle"
                  onClick={startListening}
                  aria-label="Tap to try the microphone again"
                >
                  <div className="aj-mic-icon aj-mic-icon--idle"><Icon name="voice" size={32} /></div>
                  <div className="aj-mic-label">Didn&rsquo;t catch that</div>
                  <div className="aj-mic-sub">Tap the mic and try again</div>
                </button>
                <div className="aj-footer-links">
                  <button
                    className="link-btn"
                    onClick={() => {
                      manualOverride.current = true;
                      setVoiceStatus('form');
                    }}
                  >
                    Type instead
                  </button>
                </div>
              </>
            )}

            {/* ── Voice: parsing state — spinner deferred until >400ms to avoid flash ── */}
            {voiceStatus === 'parsing' && (
              <>
                {showParsingSpinner && (
                  <div className="aj-mic-box aj-mic-box--parsing">
                    <div className="aj-mic-icon"><Icon name="loading" size={32} /></div>
                    <div className="aj-mic-label">Understanding…</div>
                  </div>
                )}
                {transcript && (
                  <div className="aj-transcript" dir="auto">&ldquo;{transcript}&rdquo;</div>
                )}
              </>
            )}

            {/* ── Stage 2 unified form: voice pre-fills it, typing uses it blank ── */}
            {/* voiceStatus === 'form' covers both the post-voice path (pre-filled) */}
            {/* and the manual-entry path (blank). A single layout — no divergence. */}
            {voiceStatus === 'form' && (
              <>
                {/* Transcript whisper — shows what the mic heard when voice was used */}
                {transcript && (
                  <div className="aj-transcript" dir="auto">&ldquo;{transcript}&rdquo;</div>
                )}

                {/* Amount / payment edit chip — the safety check for voice mishears.
                    Tapping ✎ opens an inline edit row so the user can correct amount
                    or payment method without hunting for a separate field. */}
                <div className="aj-amount-chip-row">
                  <span className="aj-amount-chip-value">{stage1Summary()}</span>
                  <button
                    type="button"
                    className="aj-amount-chip-edit"
                    aria-label="Edit amount and payment method"
                    onClick={() => setAmountEditOpen(v => !v)}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                </div>

                {/* Inline amount + chip editor — revealed by the ✎ button */}
                {amountEditOpen && (
                  <div className="aj-amount-edit-panel">
                    <div className="aj-micro-amount-wrap aj-micro-amount-wrap--inline">
                      <span className="aj-micro-currency">£</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        className="aj-micro-amount aj-micro-amount--inline"
                        placeholder="0"
                        value={amount}
                        onChange={e => { setAmount(e.target.value); setError(''); }}
                        aria-label="Amount in pounds"
                      />
                    </div>
                    <div className="aj-chip-strip aj-chip-strip--micro" style={{ marginTop: 8 }}>
                      {PAYMENT_CHIPS.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          className={chipClass(c.id)}
                          onClick={() => setPaymentChip(c.id)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Job name */}
                <div className="modal-fields">
                  <label>
                    <span>Job</span>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder={autoJobName()}
                    />
                  </label>

                  {/* Customer */}
                  <label>
                    <span>Customer</span>
                    <input
                      type="text"
                      value={customer}
                      onChange={e => setCustomer(e.target.value)}
                      placeholder="Sarah Mitchell (optional)"
                    />
                  </label>

                  {/* When */}
                  <div className="aj-field-row">
                    <span className="aj-field-label">When</span>
                    <input
                      type="date"
                      className="aj-date-input"
                      value={jobDate}
                      onChange={e => setJobDate(e.target.value)}
                      // max removed: future-dated jobs allowed for scheduling
                    />
                    <span className="aj-date-label">{formatDateLabel(jobDate)}</span>
                  </div>

                  {/* Site address */}
                  <label>
                    <span>Site address</span>
                    <input
                      type="text"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="Job site address (optional)"
                    />
                  </label>
                </div>

                {/* More options drawer — materials, labour, notes, phone */}
                <div className="aj-footer-links">
                  <button
                    className="link-btn aj-more-toggle"
                    onClick={() => { setMoreOpen(v => !v); }}
                  >
                    {moreOpen
                      ? <><Icon name="chevron-up" size={16} className="aj-more-toggle-icon" /> Less</>
                      : <><Icon name="add" size={16} className="aj-more-toggle-icon aj-more-toggle-icon--plus" /> More</>}
                  </button>
                </div>

                {moreOpen && <MoreOptionsFields
                  materials={materialsCostInput}     setMaterials={setMaterialsCostInput}
                  labourHours={labourHours} setLabourHours={setLabourHours}
                  notes={notes}             setNotes={setNotes}
                  phone={phone}             setPhone={setPhone}
                  address={address}         setAddress={setAddress}
                  deposit={deposit}         setDeposit={setDeposit}
                />}

                <button
                  className="btn-primary btn-large aj-save-btn"
                  onClick={saveDetails}
                >
                  {detailsSaveLabel()}
                </button>

                {/* Save & send quote — awaiting payment only (not gated on voice sub-state). */}
                {paymentChip === 'awaiting' && onSaveAndSend && (
                  <button
                    className="btn-secondary btn-large aj-save-btn"
                    style={{ marginTop: 8 }}
                    onClick={saveAndSend}
                  >
                    Save &amp; send quote
                  </button>
                )}
              </>
            )}

            {error && <p className="modal-error">{error}</p>}
          </>
        )}

        {/* ══ QUOTE VIEW — "Create quote" entry point ═══════════════════════ */}
        {view === 'quote' && (
          <>
            <div className="aj-header">
              <h3 className="modal-title">Create quote</h3>
              <button className="aj-close-btn" onClick={onClose} aria-label="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            {/* ── Voice: listening state ── */}
            {quoteVoiceStatus === 'listening' && (
              <>
                <div className="aj-mic-box">
                  <div className="aj-mic-icon"><Icon name="voice" size={32} /></div>
                  <div className="aj-mic-label">Listening…</div>
                  <div className="aj-mic-sub">Say the job, the name, the price.</div>
                </div>
                {quoteTranscript && (
                  <div className="aj-transcript" dir="auto">&ldquo;{quoteTranscript}&rdquo;</div>
                )}
                {!quoteTranscript && (
                  <div className="aj-transcript aj-transcript--hint">
                    e.g. &ldquo;{getTradeVoiceHint(tradePrimary)}&rdquo;
                  </div>
                )}
                <button
                  className="btn-primary"
                  onClick={stopQuoteListening}
                  style={{ width: '100%', marginBottom: 8, marginTop: 12 }}
                >
                  Done
                </button>
                <div className="aj-footer-links">
                  <button
                    className="link-btn"
                    onClick={() => {
                      manualOverride.current = true;
                      stopQuoteListening();
                      setQuoteVoiceStatus('manual');
                    }}
                  >
                    Type instead
                  </button>
                </div>
              </>
            )}

            {/* ── Voice: idle state — mic stopped with no speech, tap to re-arm ── */}
            {quoteVoiceStatus === 'idle' && (
              <>
                <button
                  type="button"
                  className="aj-mic-box aj-mic-box--idle"
                  onClick={startQuoteListening}
                  aria-label="Tap to try the microphone again"
                >
                  <div className="aj-mic-icon aj-mic-icon--idle"><Icon name="voice" size={32} /></div>
                  <div className="aj-mic-label">Didn&rsquo;t catch that</div>
                  <div className="aj-mic-sub">Tap the mic and try again</div>
                </button>
                <div className="aj-footer-links">
                  <button
                    className="link-btn"
                    onClick={() => {
                      manualOverride.current = true;
                      setQuoteVoiceStatus('manual');
                    }}
                  >
                    Type instead
                  </button>
                </div>
              </>
            )}

            {/* ── Voice: parsing state ── */}
            {quoteVoiceStatus === 'parsing' && (
              <>
                {showParsingSpinner && (
                  <div className="aj-mic-box aj-mic-box--parsing">
                    <div className="aj-mic-icon"><Icon name="loading" size={32} /></div>
                    <div className="aj-mic-label">Understanding…</div>
                  </div>
                )}
                {quoteTranscript && (
                  <div className="aj-transcript" dir="auto">&ldquo;{quoteTranscript}&rdquo;</div>
                )}
              </>
            )}

            {/* ── AI building state — deferred spinner (>400ms) ── */}
            {aiStatus === 'building' && (
              <>
                {showBuildingSpinner && (
                  <div className="aj-mic-box aj-mic-box--parsing">
                    <div className="aj-mic-icon"><Icon name="loading" size={32} /></div>
                    <div className="aj-mic-label">Building your quote…</div>
                    <div className="aj-mic-sub">Using your prices and history</div>
                  </div>
                )}
              </>
            )}

            {/* ── Rate prompt — shown when hourly_rate is unset ── */}
            {showRatePrompt && aiStatus !== 'building' && (
              <div className="aj-rate-prompt">
                <p className="aj-rate-prompt-text">
                  Quick one — what&rsquo;s your day rate? I&rsquo;ll price the labour properly.
                </p>
                <div className="aj-rate-prompt-row">
                  <span className="aj-micro-currency">£</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="aj-rate-prompt-input"
                    placeholder="e.g. 200"
                    value={rateInput}
                    onChange={e => setRateInput(e.target.value)}
                    aria-label="Your day rate in pounds"
                  />
                  <span className="aj-rate-prompt-unit">/day</span>
                </div>
                <button
                  className="btn-primary aj-rate-prompt-save"
                  onClick={async () => {
                    const rate = parseFloat(rateInput);
                    if (!isNaN(rate) && rate > 0) {
                      // Save hourly_rate = day rate / 8 (8-hour day) to profiles
                      // via Supabase client directly — this is a profile field, not a job.
                      try {
                        const { supabase: sb } = await import('../lib/supabase.js');
                        const { data: { user } } = await sb.auth.getUser();
                        if (user?.id) {
                          // Store as hourly (day rate / 8)
                          const hourly = Math.round((rate / 8) * 100) / 100;
                          await sb.from('profiles').update({ hourly_rate: hourly }).eq('id', user.id);
                          setProfileHourlyRate(hourly);
                        }
                      } catch { /* non-blocking — proceed with build anyway */ }
                      setShowRatePrompt(false);
                      const desc = summary.trim() || quoteTranscript.trim();
                      runAiQuoteBuild(desc, parseFloat(rateInput) / 8);
                    }
                  }}
                >
                  Save &amp; build quote
                </button>
                <button
                  className="link-btn aj-rate-prompt-skip"
                  onClick={() => {
                    setShowRatePrompt(false);
                    // Build without a rate — AI will use placeholder costs
                    const desc = summary.trim() || quoteTranscript.trim();
                    // Pass a non-null sentinel so runAiQuoteBuild doesn't loop
                    runAiQuoteBuild(desc, 0);
                  }}
                >
                  Skip — I&rsquo;ll add my prices
                </button>
              </div>
            )}

            {/* ── Bank-gate — deposit requested, no bank details, not Pro+Stripe ── */}
            {quoteVoiceStatus === 'confirm' && showBankGate && (
              <BankGateSheet
                onClose={() => setShowBankGate(false)}
                onSaved={(patch) => {
                  setBankPatchOverride(patch);
                  setShowBankGate(false);
                }}
                onSkip={() => {
                  setQuoteDepositPercent(0);
                  setShowBankGate(false);
                }}
              />
            )}

            {/* ── Voice-quote confirm card — the "10-second signature" ──────────
                Glanceable 4-line card (Job · Customer · Total · Deposit), each
                line inline-editable. Send goes straight through sendQuote() —
                no ReviewSheet hop (see AddJobModal/TodayScreen wiring). The
                full manual form (line items, AI itemise banner, margin, etc.)
                stays one tap away via "Edit all fields". */}
            {quoteVoiceStatus === 'confirm' && aiStatus !== 'building' && !showRatePrompt && !showBankGate && (
              <>
                {quoteTranscript && (
                  <div className="aj-transcript" dir="auto">&ldquo;{quoteTranscript}&rdquo;</div>
                )}

                {aiStatus === 'draft' && (
                  <div className="aj-ai-draft-banner" role="status">
                    Draft — built from your prices. Check it before you send.
                  </div>
                )}

                <div className="aj-confirm-card" role="group" aria-label="Confirm your quote">
                  {/* Job */}
                  <div className="aj-confirm-row">
                    <span className="aj-confirm-row-label">Job</span>
                    {confirmEditField === 'job' ? (
                      <input
                        type="text"
                        className="aj-confirm-row-input"
                        value={summary}
                        onChange={e => setSummary(e.target.value)}
                        onBlur={() => setConfirmEditField(null)}
                        autoFocus
                        placeholder="Job description"
                        aria-label="Job description"
                      />
                    ) : (
                      <button
                        type="button"
                        className="aj-confirm-row-value"
                        onClick={() => setConfirmEditField('job')}
                        aria-label="Edit job description"
                      >
                        {summary || <span className="aj-confirm-row-placeholder">Add a job description</span>}
                        <Icon name="edit" size={14} />
                      </button>
                    )}
                  </div>

                  {/* Customer */}
                  <div className="aj-confirm-row">
                    <span className="aj-confirm-row-label">Customer</span>
                    {confirmEditField === 'customer' ? (
                      <input
                        type="text"
                        className="aj-confirm-row-input"
                        value={customer}
                        onChange={e => setCustomer(e.target.value)}
                        onBlur={() => setConfirmEditField(null)}
                        autoFocus
                        placeholder="Customer name"
                        aria-label="Customer name"
                      />
                    ) : (
                      <button
                        type="button"
                        className="aj-confirm-row-value"
                        onClick={() => setConfirmEditField('customer')}
                        aria-label="Edit customer name"
                      >
                        {customer ? customer : <span className="aj-confirm-row-placeholder">+ Add customer</span>}
                        <Icon name="edit" size={14} />
                      </button>
                    )}
                  </div>

                  {/* Total (+VAT chip) */}
                  <div className="aj-confirm-row">
                    <span className="aj-confirm-row-label">Total</span>
                    <div className="aj-confirm-row-total-wrap">
                      {confirmEditField === 'total' ? (
                        <div className="aj-micro-amount-wrap aj-micro-amount-wrap--inline">
                          <span className="aj-micro-currency">£</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            className="aj-micro-amount aj-micro-amount--inline"
                            value={qTotal}
                            onChange={e => { setQTotal(e.target.value); setError(''); }}
                            onBlur={() => setConfirmEditField(null)}
                            autoFocus
                            placeholder="0"
                            aria-label="Quote total in pounds"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="aj-confirm-row-value aj-confirm-row-value--total"
                          onClick={() => setConfirmEditField('total')}
                          aria-label="Edit total"
                        >
                          {qTotal.trim() ? `£${qTotal}` : <span className="aj-confirm-row-placeholder">Add a price</span>}
                          <Icon name="edit" size={14} />
                        </button>
                      )}
                      {quoteVat && (
                        <span className="aj-confirm-vat-chip" aria-label="Plus VAT">+VAT</span>
                      )}
                    </div>
                  </div>

                  {/* Deposit — inline chips, pre-filled from the parsed transcript */}
                  <div className="aj-confirm-row aj-confirm-row--deposit">
                    <span className="aj-confirm-row-label">Deposit</span>
                    <div className="aj-confirm-deposit-chips" role="group" aria-label="Deposit percentage">
                      {CONFIRM_DEPOSIT_PRESETS.map(v => (
                        <button
                          key={v}
                          type="button"
                          className={`aj-chip${quoteDepositPercent === v && confirmEditField !== 'depositCustom' ? ' aj-chip--on' : ''}`}
                          onClick={() => { setQuoteDepositPercent(v); setConfirmEditField(null); }}
                        >
                          {v}%
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`aj-chip${!CONFIRM_DEPOSIT_PRESETS.includes(quoteDepositPercent) || confirmEditField === 'depositCustom' ? ' aj-chip--on' : ''}`}
                        onClick={() => setConfirmEditField('depositCustom')}
                      >
                        Custom
                      </button>
                    </div>
                    {confirmEditField === 'depositCustom' && (
                      <div className="aj-confirm-deposit-custom-row">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          className="aj-deposit-custom-input"
                          value={quoteDepositPercent || ''}
                          onChange={e => setQuoteDepositPercent(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
                          onBlur={() => setConfirmEditField(null)}
                          autoFocus
                          aria-label="Custom deposit percentage"
                          placeholder="e.g. 30"
                        />
                        <span className="aj-confirm-deposit-custom-suffix">%</span>
                      </div>
                    )}
                    {quoteDepositPercent > 0 && qTotal.trim() && !isNaN(parseFloat(qTotal)) && (
                      <div className="aj-confirm-deposit-preview">
                        {quoteDepositPercent}% &middot; £{(parseFloat(qTotal) * quoteDepositPercent / 100).toFixed(2)}
                        {quoteDepositDue && <> &middot; due {formatDateLabel(quoteDepositDue)}</>}
                      </div>
                    )}
                  </div>
                </div>

                {error && <p className="modal-error">{error}</p>}

                <button
                  type="button"
                  className="btn-primary btn-large aj-save-btn"
                  onClick={sendVoiceConfirmQuote}
                  disabled={!qTotal.trim() || isNaN(parseFloat(qTotal)) || parseFloat(qTotal) <= 0 || confirmSendBusy}
                >
                  {confirmSendBusy
                    ? 'Preparing…'
                    : (customer.trim() ? `Send to ${customer.trim().split(' ')[0]} on WhatsApp` : 'Send quote on WhatsApp')}
                </button>

                {/* Demoted "Save quote" — a quiet text link, not a competing button */}
                <div className="aj-footer-links">
                  <button type="button" className="link-btn" onClick={saveQuote}>
                    Save quote
                  </button>
                </div>

                {/* Collapsed detail: phone / itemise / margin / edit-all-fields escape hatch */}
                <div className="aj-footer-links">
                  <button
                    type="button"
                    className="link-btn"
                    aria-expanded={showConfirmAddDetail}
                    onClick={() => setShowConfirmAddDetail(v => !v)}
                  >
                    {showConfirmAddDetail ? 'Hide detail' : 'Add detail'}
                  </button>
                </div>

                {showConfirmAddDetail && (
                  <div className="aj-confirm-add-detail">
                    <label>
                      <span>Customer phone</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="07700 900123 (for WhatsApp)"
                        aria-label="Customer phone"
                      />
                    </label>

                    {aiStatus === 'idle' && (
                      <button type="button" className="aj-ai-itemise-btn" onClick={handleItemiseClick}>
                        Itemise it for me
                      </button>
                    )}
                    {aiStatus === 'error' && aiError && (
                      <p className={`modal-error${aiError.includes('quota_exceeded') || aiError.includes("free AI quotes") ? ' aj-quota-error' : ''}`}>
                        {aiError}
                      </p>
                    )}

                    <MarginSection
                      estCost={estCost}
                      setEstCost={setEstCost}
                      price={qTotal.trim() ? parseFloat(qTotal) : 0}
                      showMarginSection={showMarginSection}
                      setShowMarginSection={setShowMarginSection}
                      showMarkupReveal={showMarkupReveal}
                      setShowMarkupReveal={setShowMarkupReveal}
                      seenReassurance={seenMarginReassurance}
                    />

                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        manualOverride.current = true;
                        setQuoteVoiceStatus('manual');
                      }}
                    >
                      Edit all fields
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Quote form: confirm (post-voice) and manual (typed) ── */}
            {quoteVoiceStatus === 'manual' && aiStatus !== 'building' && !showRatePrompt && (
              <>
                {/* When voice is not available or user chose type-first, show a mic button */}
                {quoteVoiceStatus === 'manual' && !quoteTranscript && SR && isOnline() && (
                  <button
                    className="aj-quote-mic-restart"
                    type="button"
                    onClick={() => {
                      hasAutoStartedQuote.current = false;
                      setQuoteTranscript('');
                      setQuoteVoiceStatus('listening');
                      startQuoteListening();
                    }}
                  >
                    <Icon name="voice" size={16} /> Use voice instead
                  </button>
                )}

                {/* Core fields */}
                <div className="modal-fields">
                  <label>
                    <span>Job description</span>
                    <input
                      type="text"
                      value={summary}
                      onChange={e => setSummary(e.target.value)}
                      placeholder="e.g. Bathroom tiling"
                      autoFocus={quoteVoiceStatus === 'manual'}
                    />
                  </label>
                  <label>
                    <span>Customer name</span>
                    <input
                      type="text"
                      value={customer}
                      onChange={e => setCustomer(e.target.value)}
                      placeholder="e.g. Dave Williams (optional)"
                    />
                  </label>
                  <label>
                    <span>Customer phone</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="07700 900123 (for WhatsApp)"
                    />
                  </label>
                </div>

                {/* "Itemise it for me" CTA — triggers AI build from the current description */}
                {aiStatus === 'idle' && (
                  <button
                    type="button"
                    className="aj-ai-itemise-btn"
                    onClick={handleItemiseClick}
                  >
                    Itemise it for me
                  </button>
                )}

                {/* Error from AI build — shown inline above manual form */}
                {aiStatus === 'error' && aiError && (
                  <p className={`modal-error${aiError.includes('quota_exceeded') || aiError.includes("free AI quotes") ? ' aj-quota-error' : ''}`}>
                    {aiError}
                  </p>
                )}

                {/* AI draft review banner — shown when AI has populated lines */}
                {aiStatus === 'draft' && (
                  <div className="aj-ai-draft-banner" role="status">
                    Draft — built from your prices. Check it before you send.
                  </div>
                )}

                {/* Total — hidden when line items are shown (auto-summed instead) */}
                {!showLineItems && (
                  <div className="aj-quote-total-row">
                    <span className="aj-quote-total-label">Total</span>
                    <div className="aj-quote-total-input-wrap">
                      <span className="aj-micro-currency aj-quote-currency">£</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        className="aj-quote-total-input"
                        value={qTotal}
                        onChange={e => { setQTotal(e.target.value); setError(''); }}
                        placeholder="0"
                        aria-label="Quote total in pounds"
                      />
                    </div>
                  </div>
                )}

                {/* Line items — revealed by "+ Add line item" or populated by AI */}
                {showLineItems && (
                  <div className="aj-quote-line-items">
                    <div className="aj-quote-line-items-header">
                      <span className="aj-quote-line-items-title">Line items</span>
                    </div>
                    {lineItems.map((li, idx) => (
                      <div key={idx} className="aj-quote-line-outer">
                        <div className="aj-quote-line-row">
                          <div className="aj-quote-line-desc-wrap">
                            <input
                              type="text"
                              className="aj-quote-line-desc"
                              value={li.desc}
                              onChange={e => {
                                updateLineItem(idx, 'desc', e.target.value);
                                setTypeAheadIdx(idx);
                              }}
                              onFocus={() => setTypeAheadIdx(idx)}
                              onBlur={() => {
                                // Delay hide so tapping a suggestion registers first
                                setTimeout(() => setTypeAheadIdx(i => i === idx ? -1 : i), 180);
                              }}
                              placeholder="Description"
                              aria-label={`Line item ${idx + 1} description`}
                              aria-autocomplete="list"
                              aria-expanded={typeAheadIdx === idx}
                            />
                            {/* Per-line provenance microcopy — only shown on AI-generated draft */}
                            {aiStatus === 'draft' && li.provenance === 'labour' && (
                              <span className="aj-line-provenance">your rate</span>
                            )}
                            {aiStatus === 'draft' && li.provenance === 'history' && (
                              <span className="aj-line-provenance">from your past jobs</span>
                            )}
                            {/* Material provenance — show markup chip on quote lines */}
                            {li.provenance === 'material' && li.buyPrice != null && (
                              <MarkupChip
                                buyPrice={li.buyPrice}
                                markup={resolveMarkup(li.lineMarkup, defaultMarkup)}
                                defaultMarkup={defaultMarkup ?? 20}
                                onChange={(newMarkup, newSell) => {
                                  setLineItems(prev => {
                                    const next = prev.map((l, i) => i === idx
                                      ? { ...l, lineMarkup: newMarkup, cost: String(newSell) }
                                      : l
                                    );
                                    const total = lineItemsTotal(next);
                                    if (total > 0) setQTotal(String(total));
                                    return next;
                                  });
                                }}
                              />
                            )}
                            {/* Low-confidence flag — amber, "check this" */}
                            {aiStatus === 'draft' && li.lowConfidence && (
                              <span className="aj-line-low-confidence" aria-label="Check this price">check this</span>
                            )}
                          </div>
                          <div className="aj-quote-line-cost-wrap">
                            <span className="aj-quote-line-currency">£</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              className={`aj-quote-line-cost${li.lowConfidence ? ' aj-quote-line-cost--warn' : ''}`}
                              value={li.cost}
                              onChange={e => updateLineItem(idx, 'cost', e.target.value)}
                              placeholder="0"
                              aria-label={`Line item ${idx + 1} cost`}
                            />
                          </div>
                          {/* Bookmark: save line to materials library */}
                          <button
                            type="button"
                            className="aj-quote-line-bookmark"
                            onClick={() => handleSaveLineToLibrary(li)}
                            aria-label="Save for next time"
                            title="Save for next time"
                          >
                            <Icon name="star" size={14} variant="muted" />
                          </button>
                          <button
                            type="button"
                            className="aj-quote-line-remove"
                            onClick={() => removeLineItem(idx)}
                            aria-label={`Remove line item ${idx + 1}`}
                          >
                            <Icon name="close" size={16} />
                          </button>
                        </div>
                        {/* Type-ahead dropdown — shown when this line's desc input is focused */}
                        {typeAheadIdx === idx && (
                          <MaterialTypeAhead
                            materials={Array.isArray(materials) ? materials : []}
                            query={li.desc}
                            context="quote"
                            defaultMarkup={defaultMarkup ?? 20}
                            onSelect={(selected) => handleMaterialSelect(idx, selected)}
                            onBrowseAll={() => { setTypeAheadIdx(-1); onBrowseMaterials?.(); }}
                            onSaveItem={({ desc, buyPrice, unit }) =>
                              handleSaveLineToLibrary({ desc, buyPrice, unit })
                            }
                          />
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="aj-quote-add-line-btn"
                      onClick={addLineItem}
                    >
                      + Add line item
                    </button>
                    <button
                      type="button"
                      className="aj-quote-add-line-btn aj-quote-add-line-btn--calc"
                      onClick={async () => {
                        const quota = await checkEstimatorQuota();
                        setEstimatorQuota(quota);
                        setShowEstimator(true);
                        logTelemetry('estimator_open', { source: 'quote_line_items' });
                      }}
                    >
                      <Icon name="wrench" size={14} />
                      {' '}+ Work it out
                    </button>
                    {lineItems.length > 0 && lineItemsTotal(lineItems) > 0 && (
                      <div className="aj-quote-line-total">
                        <span>Total</span>
                        <span>£{lineItemsTotal(lineItems).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Toggle for line items */}
                {!showLineItems && (
                  <div className="aj-quote-add-items-row">
                    <button
                      type="button"
                      className="aj-quote-add-items-link"
                      onClick={() => {
                        setShowLineItems(true);
                        if (lineItems.length === 0) addLineItem();
                      }}
                    >
                      + Add line item
                    </button>
                    <button
                      type="button"
                      className="aj-quote-add-items-link aj-quote-add-items-link--calc"
                      onClick={async () => {
                        setShowLineItems(true);
                        const quota = await checkEstimatorQuota();
                        setEstimatorQuota(quota);
                        setShowEstimator(true);
                        logTelemetry('estimator_open', { source: 'quote_toggle' });
                      }}
                    >
                      <Icon name="wrench" size={14} />
                      {' '}+ Work it out
                    </button>
                  </div>
                )}
                {showLineItems && (
                  <button
                    type="button"
                    className="aj-quote-add-items-link"
                    onClick={() => {
                      setShowLineItems(false);
                      if (aiStatus === 'draft') setAiStatus('idle');
                    }}
                  >
                    Show flat total instead
                  </button>
                )}

                {/* ── Margin-aware quote section — TRADER-ONLY ─────────────────────────
                    Collapsed by default so the default voice→price→Send flow is untouched.
                    estCost and all derived figures (profit/margin/markup) are for the
                    tradesperson only — they never appear in the customer quote or PDF. */}
                <MarginSection
                  estCost={estCost}
                  setEstCost={setEstCost}
                  price={
                    showLineItems
                      ? lineItemsTotal(lineItems)
                      : (qTotal.trim() ? parseFloat(qTotal) : 0)
                  }
                  showMarginSection={showMarginSection}
                  setShowMarginSection={setShowMarginSection}
                  showMarkupReveal={showMarkupReveal}
                  setShowMarkupReveal={setShowMarkupReveal}
                  seenReassurance={seenMarginReassurance}
                />

                {error && <p className="modal-error">{error}</p>}

                {/* Save as draft */}
                <button
                  className="btn-primary btn-large aj-save-btn"
                  onClick={saveQuote}
                >
                  Save quote
                </button>

                {/* Save + send to customer via WhatsApp */}
                {onSaveAndSend && (
                  <button
                    className="btn-secondary btn-large aj-save-btn"
                    style={{ marginTop: 8 }}
                    onClick={saveQuoteAndSend}
                  >
                    Send to customer
                  </button>
                )}
              </>
            )}

            {error && quoteVoiceStatus !== 'confirm' && quoteVoiceStatus !== 'manual' && (
              <p className="modal-error">{error}</p>
            )}
          </>
        )}

      </div>

      {/* Saved-to-library snackbar — appears after bookmark tap */}
      {savedSnack && (
        <div className="toast" role="status" aria-live="polite">
          {savedSnack}
        </div>
      )}

      {/* Work it out estimator sheet — mounted on top when open */}
      {showEstimator && (
        <EstimatorSheet
          materials={Array.isArray(materials) ? materials : []}
          defaultMarkup={defaultMarkup ?? 20}
          quotaAllowed={estimatorQuota.allowed}
          isPro={estimatorQuota.isPro}
          onAddLines={(newLines) => {
            // Increment the quota counter after a successful delivery
            import('../lib/estimatorQuota.js').then(m => m.incrementEstimatorQuota()).catch(() => {});
            setLineItems(prev => [...prev, ...newLines]);
            setShowLineItems(true);
            const total = lineItemsTotal([...lineItems, ...newLines]);
            if (total > 0) setQTotal(String(total));
            logTelemetry('estimator_lines_added', { count: newLines.length });
          }}
          onClose={() => setShowEstimator(false)}
          onOpenAddMaterial={onBrowseMaterials}
        />
      )}
    </div>
  );
}

function MoreOptionsFields({
  materials, setMaterials,
  labourHours, setLabourHours,
  notes, setNotes,
  phone, setPhone,
  address, setAddress,
  _deposit, _setDeposit,
}) {
  return (
    <div className="aj-more-fields">
      <div className="modal-fields">
        <label>
          <span>Materials cost (£)</span>
          <input
            type="number"
            inputMode="decimal"
            value={materials}
            onChange={e => setMaterials(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          <span>Labour hours</span>
          <input
            type="number"
            inputMode="decimal"
            value={labourHours}
            onChange={e => setLabourHours(e.target.value)}
            placeholder="e.g. 4"
          />
        </label>
        <label>
          <span>Notes</span>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Job notes or before/after details"
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="07700 900123"
          />
        </label>
        <label>
          <span>Address</span>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Job site address (optional)"
          />
        </label>
        {/* Legacy freeform deposit field removed (2026-06). Deposits are now
            set via the deposit_percent / deposit_amount_pence model, configured
            in Settings → Default deposit %, applied at quote-send time.
            Existing jobs with a stored `deposit` value are unaffected. */}
      </div>
    </div>
  );
}

// ── MarginSection — TRADER-ONLY profit/margin forecast ────────────────────────
//
// Collapsed by default. Tapping "See your margin" expands the cost field + live
// readout. estCost and all derived figures (profit/margin/markup) are for the
// tradesperson only — they never appear in the customer quote, PDF, or public page.
//
// Props:
//   estCost, setEstCost        — the trader's spend estimate (string while typing)
//   price                      — the current quote total (number)
//   showMarginSection          — whether the section is expanded
//   setShowMarginSection       — setter for showMarginSection
//   showMarkupReveal           — whether the markup teach copy is visible
//   setShowMarkupReveal        — setter for showMarkupReveal
//   seenReassurance            — whether the "only you see this" message has shown
function MarginSection({
  estCost, setEstCost,
  price,
  showMarginSection, setShowMarginSection,
  showMarkupReveal, setShowMarkupReveal,
  seenReassurance,
}) {
  // Collapsed trigger row — the only thing the user sees by default
  if (!showMarginSection) {
    return (
      <button
        type="button"
        className="aj-margin-trigger"
        onClick={() => {
          setShowMarginSection(true);
          // Mark reassurance as shown the first time the section is opened
          if (!seenReassurance) {
            try { localStorage.setItem('jp.margin_reassurance_shown', 'yes'); } catch {}
          }
        }}
        aria-expanded="false"
        aria-label="See your margin on this quote"
      >
        See your margin <span className="aj-margin-trigger-arrow" aria-hidden="true">&#9658;</span>
      </button>
    );
  }

  // Derive forecast from current inputs
  const parsedPrice   = Number(price)   || 0;
  const parsedCost    = estCost.trim() ? parseFloat(estCost) : null;
  const forecastState = marginForecastState(parsedCost, parsedPrice);

  let forecast = null;
  if (parsedCost !== null && !isNaN(parsedCost) && parsedPrice > 0) {
    forecast = calcMarginForecast(parsedPrice, parsedCost);
  }

  return (
    <div className="aj-margin-section" role="region" aria-label="Your margin on this quote">
      {/* Section header with collapse */}
      <div className="aj-margin-header">
        <span className="aj-margin-header-label">Your margin</span>
        <button
          type="button"
          className="aj-margin-collapse-btn"
          onClick={() => setShowMarginSection(false)}
          aria-label="Hide margin section"
        >
          <span aria-hidden="true">&#9660;</span>
        </button>
      </div>

      {/* First-use reassurance — shown once when the section is first opened */}
      {!seenReassurance && (
        <p className="aj-margin-reassurance">
          Only you see this. Your customer&rsquo;s quote shows the price, nothing else.
        </p>
      )}

      {/* Cost input */}
      <label className="aj-margin-cost-label">
        <span className="aj-margin-cost-label-text">What&rsquo;ll this job cost you?</span>
        <div className="aj-margin-cost-input-wrap">
          <span className="aj-micro-currency">£</span>
          <input
            type="number"
            inputMode="decimal"
            className="aj-margin-cost-input"
            value={estCost}
            onChange={e => {
              setEstCost(e.target.value);
              setShowMarkupReveal(false); // reset reveal on change
            }}
            placeholder="e.g. 140"
            aria-label="Estimated job cost in pounds"
          />
        </div>
        <span className="aj-margin-cost-helper">
          Just what you&rsquo;ll spend — materials, parts, hire. Don&rsquo;t include your own time; your time is the profit.
        </span>
      </label>

      {/* Live forecast readout */}
      {forecastState === 'empty' && (
        <p className="aj-margin-nudge">Add your costs to see your profit.</p>
      )}

      {forecastState === 'loss' && forecast && (
        <div className="aj-margin-readout aj-margin-readout--loss" role="status" aria-live="polite">
          <span className="aj-margin-profit aj-margin-profit--loss">
            &minus;£{Math.abs(forecast.profit).toFixed(2)}
          </span>
          <span className="aj-margin-pct aj-margin-pct--loss">
            &nbsp;&middot;&nbsp;you&rsquo;d lose money on this job.
          </span>
        </div>
      )}

      {(forecastState === 'ok' || forecastState === 'thin') && forecast && (
        <>
          <div
            className={`aj-margin-readout${forecastState === 'thin' ? ' aj-margin-readout--thin' : ''}`}
            role="status"
            aria-live="polite"
          >
            <span className="aj-margin-profit">
              You keep £{forecast.profit.toFixed(2)}
            </span>
            <span className="aj-margin-pct">
              &nbsp;&middot;&nbsp;Margin {Math.round(forecast.margin)}%
            </span>
          </div>
          {forecastState === 'thin' && (
            <p className="aj-margin-thin-advisory">Thin margin.</p>
          )}

          {/* Markup reveal — one tap, the teaching moment */}
          {forecast.markup !== null && !showMarkupReveal && (
            <button
              type="button"
              className="aj-margin-markup-reveal-btn"
              onClick={() => setShowMarkupReveal(true)}
            >
              What&rsquo;s my markup?
            </button>
          )}
          {forecast.markup !== null && showMarkupReveal && (
            <p className="aj-margin-markup-teach" role="status">
              {markupTeachCopy(
                Math.round(forecast.markup * 10) / 10,
                Math.round(forecast.margin * 10) / 10,
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
