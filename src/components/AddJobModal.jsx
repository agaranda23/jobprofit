import { useEffect, useRef, useState } from 'react';
import { parseJobFromSpeech } from '../lib/voiceParse';
import { logTelemetry } from '../lib/telemetry';

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

export default function AddJobModal({ onClose, onSave, onOpenDetailed, defaultMode, onSaveAndSend }) {
  // 'micro'    — Stage 1: fast capture (amount + paid-by + Save it)
  // 'details'  — Stage 2: full form (name, customer, date, more options)
  // 'quote'    — Create-quote surface: voice OR type, summary + total + optional line items
  // Voice sub-states within 'details' and 'quote': 'listening' | 'parsing' | 'confirm' | 'manual'
  //
  // defaultMode="voice"  — mounts into 'details', starts voice immediately (user tapped mic on Today).
  // defaultMode="quote"  — mounts into 'quote', starts voice immediately.
  // No prop (or 'micro') — default 'micro' keypad view (Stage 1).
  const [view, setView] = useState(
    defaultMode === 'voice' ? 'details' :
    defaultMode === 'quote' ? 'quote'   : 'micro'
  );

  // When the user navigates from Stage 1 to Stage 2 via the "+ Add the details →" button,
  // we do NOT want voice to auto-start (building-site noise). This ref tracks whether the
  // entry into details was an explicit voice request (defaultMode="voice") vs a manual nav.
  // true  = voice was explicitly requested on mount → auto-start is allowed once.
  // false = user navigated from micro → no auto-start.
  const voiceEntryExplicit = useRef(defaultMode === 'voice');

  // ── Shared field state (micro + details share these) ──────────────────────
  const [amount, setAmount]           = useState('');
  const [paymentChip, setPaymentChip] = useState('awaiting');
  const [name, setName]               = useState('');
  const [customer, setCustomer]       = useState('');
  const [phone, setPhone]             = useState('');
  const [jobDate, setJobDate]         = useState(todayISODate());
  const [materials, setMaterials]     = useState('');
  const [labourHours, setLabourHours] = useState('');
  const [notes, setNotes]             = useState('');
  const [deposit, setDeposit]         = useState('');
  const [address, setAddress]         = useState('');
  const [error, setError]             = useState('');
  const [moreOpen, setMoreOpen]       = useState(false);

  // ── Quote-specific state (only active in 'quote' view) ───────────────────
  // summary: short job description (e.g. "Kitchen renovation")
  // qTotal: the quote total amount (string while editing)
  // lineItems: array of { desc, cost } — optional breakdown rows
  // showLineItems: whether the + Add line item section is expanded
  const [summary, setSummary]           = useState('');
  const [qTotal, setQTotal]             = useState('');
  const [lineItems, setLineItems]       = useState([]);
  const [showLineItems, setShowLineItems] = useState(false);
  // quoteVoiceStatus mirrors voiceStatus but is owned by the quote view so
  // opening 'quote' and 'details' independently don't collide.
  const [quoteVoiceStatus, setQuoteVoiceStatus] = useState('listening');
  const [quoteTranscript, setQuoteTranscript]   = useState('');
  const hasAutoStartedQuote = useRef(false);

  // ── Voice state (active in 'details' and 'quote' views) ───────────────────
  const [voiceStatus, setVoiceStatus]       = useState('idle');
  const [transcript, setTranscript]         = useState('');
  const [retryCount, setRetryCount]         = useState(0);
  // showParsingSpinner: only true when parsing has taken >400ms — avoids a
  // distracting flash for responses that come back quickly.
  const [showParsingSpinner, setShowParsingSpinner] = useState(false);
  const recogRef        = useRef(null);
  const manualOverride  = useRef(false);
  const hasAutoStarted  = useRef(false);
  const spinnerTimerRef = useRef(null);

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
      // Offline or no Speech API — drop straight to manual form
      setVoiceStatus('manual');
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
          setVoiceStatus('manual');
        } else if (e.error === 'no-speech') {
          setError('');
          setVoiceStatus('idle');
        } else if (e.error === 'network') {
          setError('No signal — type it instead.');
          setVoiceStatus('manual');
        } else {
          setError(`Mic error: ${e.error}`);
          setVoiceStatus('manual');
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
      setVoiceStatus('manual');
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
        setVoiceStatus('manual');
        return;
      }

      setName(cleanName || autoJobName());
      setCustomer(cleanCustomer);
      setAmount(String(cleanAmt));
      if (parsed.paymentType) applyPaymentType(parsed.paymentType);
      else setPaymentChip('awaiting');
      setVoiceStatus('confirm');
    } catch {
      clearTimeout(spinnerTimerRef.current);
      setShowParsingSpinner(false);
      setVoiceStatus('manual');
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

  // Micro-log save: amount is optional (can be blank = "add price later").
  // Job name auto-fills to "Job · {day date}". Never blocks the user.
  const saveMicro = () => {
    const amt = amount.trim() ? parseFloat(amount) : null;
    if (amt !== null && (isNaN(amt) || amt <= 0)) {
      setError("That amount doesn't look right");
      return;
    }
    const isPaid = paymentChip !== 'awaiting';
    if (isPaid && amt === null) {
      setError('Add an amount before you can mark this paid');
      return;
    }
    setError('');
    onSave({
      id:          crypto.randomUUID(),
      name:        autoJobName(),
      customer:    null,
      phone:       null,
      amount:      amt,
      paymentType: isPaid ? paymentChip : null,
      paid:        isPaid,
      date:        new Date().toISOString(),
      createdAt:   new Date().toISOString(),
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
      ...(materials.trim()   ? { materialsCost: parseFloat(materials) || 0 } : {}),
      ...(labourHours.trim() ? { labourHours: parseFloat(labourHours) || 0 } : {}),
      ...(notes.trim()       ? { notes: notes.trim() } : {}),
      ...(deposit.trim()     ? { deposit: parseFloat(deposit) || 0 } : {}),
      ...(address.trim()     ? { address: address.trim() } : {}),
    };
  };

  const saveDetails = () => {
    const payload = buildDetailsPayload();
    if (!payload) return;
    onSave(payload);
  };

  // "Save & send quote" — confirm state only, awaiting jobs only.
  // Calls onSaveAndSend(payload) so the parent can persist the job then open
  // ReviewSheet in quote mode without an intermediate job screen.
  const saveAndSend = () => {
    const payload = buildDetailsPayload();
    if (!payload) return;
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
      r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      let finalText = '';
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript + ' ';
          else interim += res[0].transcript;
        }
        setQuoteTranscript((finalText + interim).trim());
      };
      r.onerror = (e) => {
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

      if (cleanAmt != null && !isNaN(cleanAmt) && cleanAmt > 0) {
        setQTotal(String(cleanAmt));
        setQuoteVoiceStatus('confirm');
      } else {
        setQTotal('');
        setQuoteVoiceStatus('manual');
      }
    } catch {
      clearTimeout(spinnerTimerRef.current);
      setShowParsingSpinner(false);
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
    return {
      id:           crypto.randomUUID(),
      name:         resolvedSummary,
      summary:      resolvedSummary,
      customer:     resolvedCustomer,
      phone:        resolvedPhone,
      amount:       resolvedTotal,
      total:        resolvedTotal,
      lineItems:    resolvedLineItems,
      paid:         false,
      paymentType:  null,
      status:       'lead',
      quoteStatus:  'draft',
      date:         new Date().toISOString(),
      createdAt:    new Date().toISOString(),
    };
  }

  /** Save as draft — persists to pipeline at Lead/Quoted stage. Nothing sent. */
  const saveQuote = () => {
    const payload = buildQuotePayload();
    if (!payload) return;
    logTelemetry('quote_save', { source: 'create_quote', hasLineItems: payload.lineItems.length > 1 });
    onSave(payload);
  };

  /** Save + open ReviewSheet in quote mode so the tradesperson can send via WhatsApp. */
  const saveQuoteAndSend = () => {
    const payload = buildQuotePayload();
    if (!payload) return;
    logTelemetry('quote_send', { source: 'create_quote', hasLineItems: payload.lineItems.length > 1 });
    onSaveAndSend?.(payload);
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

        {/* ══ STAGE 1 — MICRO-LOG VIEW (default entry) ══════════════════════ */}
        {view === 'micro' && (
          <>
            <div className="aj-header">
              <h3 className="modal-title">
                Add job
                {!isOnline() && (
                  <span className="aj-offline-pill" aria-label="Offline">⚡ Offline</span>
                )}
              </h3>
              <button className="aj-close-btn" onClick={onClose} aria-label="Close">✕</button>
            </div>

            {/* 2-dot stepper: ● ○ = Stage 1 of 2 */}
            <div className="aj-stepper" aria-label="Step 1 of 2">
              <span className="aj-stepper-dot aj-stepper-dot--on" aria-hidden="true" />
              <span className="aj-stepper-dot" aria-hidden="true" />
            </div>

            {/* Directional prompt — the screen asks, not just presents a field */}
            <p className="aj-capture-prompt">How much did you charge?</p>

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

            {/* Paid-by chip strip */}
            <div className="aj-chip-label">Got paid?</div>
            <div className="aj-chip-strip aj-chip-strip--micro">
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

            {error && <p className="modal-error">{error}</p>}

            {/* Primary action — thumb-default for the fast 2-tap logger */}
            <button
              className="btn-primary btn-large aj-save-btn"
              onClick={saveMicro}
            >
              Save it
            </button>

            {/* Secondary — real bordered button, not a faint text link */}
            <button
              className="aj-details-btn"
              type="button"
              onClick={() => {
                // voiceEntryExplicit stays false — voice does NOT auto-start
                setView('details');
              }}
            >
              <span className="aj-details-btn-plus">+</span> Add the details <span className="aj-details-btn-arrow">→</span>
            </button>

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
                <span className="aj-say-it-mic" aria-hidden="true">🎤</span>
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
                  try { recogRef.current?.abort(); } catch {} // eslint-disable-line no-empty
                  voiceEntryExplicit.current = false;
                  setView('micro');
                }}
                aria-label="Back to Step 1"
              >
                ←
              </button>
              <h3 className="modal-title">Add details</h3>
              <button className="aj-close-btn" onClick={onClose} aria-label="Close">✕</button>
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
                  <div className="aj-mic-icon">🎤</div>
                  <div className="aj-mic-label">Listening…</div>
                  <div className="aj-mic-sub">Say the job, customer, and amount</div>
                </div>
                {transcript && (
                  <div className="aj-transcript">&ldquo;{transcript}&rdquo;</div>
                )}
                {!transcript && (
                  <div className="aj-transcript aj-transcript--hint">
                    e.g. &ldquo;Kitchen job Sarah three eighty cash&rdquo;
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
                      setVoiceStatus('manual');
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
                  <div className="aj-mic-icon aj-mic-icon--idle">&#127908;</div>
                  <div className="aj-mic-label">Nothing heard</div>
                  <div className="aj-mic-sub">Tap to try again</div>
                </button>
                <div className="aj-footer-links">
                  <button
                    className="link-btn"
                    onClick={() => {
                      manualOverride.current = true;
                      setVoiceStatus('manual');
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
                    <div className="aj-mic-icon">&#x23F3;</div>
                    <div className="aj-mic-label">Understanding…</div>
                  </div>
                )}
                {transcript && (
                  <div className="aj-transcript">&ldquo;{transcript}&rdquo;</div>
                )}
              </>
            )}

            {/* ── Voice confirm + manual: shared form body ── */}
            {(voiceStatus === 'confirm' || voiceStatus === 'manual') && (
              <>
                {voiceStatus === 'confirm' && transcript && (
                  <div className="aj-transcript">&ldquo;{transcript}&rdquo;</div>
                )}

                {/* When */}
                <div className="aj-field-row">
                  <span className="aj-field-label">When</span>
                  <input
                    type="date"
                    className="aj-date-input"
                    value={jobDate}
                    onChange={e => setJobDate(e.target.value)}
                    max={todayISODate()}
                  />
                  <span className="aj-date-label">{formatDateLabel(jobDate)}</span>
                </div>

                {voiceStatus === 'confirm' ? (
                  <div className="preview-grid">
                    <div className="preview-row">
                      <span className="preview-label">Job</span>
                      <input
                        type="text"
                        className="preview-input"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Kitchen renovation"
                      />
                    </div>
                    <div className="preview-row">
                      <span className="preview-label">Customer</span>
                      <input
                        type="text"
                        className="preview-input"
                        value={customer}
                        onChange={e => setCustomer(e.target.value)}
                        placeholder="Sarah Mitchell (optional)"
                      />
                    </div>
                    <div className="preview-row">
                      <span className="preview-label">Amount</span>
                      <span className="preview-value preview-amount">£{amount}</span>
                    </div>
                  </div>
                ) : (
                  <div className="modal-fields">
                    <label>
                      <span>Job name</span>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Kitchen renovation"
                        autoFocus
                      />
                    </label>
                    <label>
                      <span>Customer</span>
                      <input
                        type="text"
                        value={customer}
                        onChange={e => setCustomer(e.target.value)}
                        placeholder="Sarah Mitchell (optional)"
                      />
                    </label>
                    <label>
                      <span>Amount (£)</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        placeholder="380"
                      />
                    </label>
                  </div>
                )}

                {/* Paid-status chip strip */}
                <div className="aj-chip-label">Paid by</div>
                <div className="aj-chip-strip">
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

                <button
                  className="btn-primary btn-large aj-save-btn"
                  onClick={saveDetails}
                >
                  {detailsSaveLabel()}
                </button>

                {/* Save & send quote — confirm state only, awaiting payment only. */}
                {voiceStatus === 'confirm' && paymentChip === 'awaiting' && onSaveAndSend && (
                  <button
                    className="btn-secondary btn-large aj-save-btn"
                    style={{ marginTop: 8 }}
                    onClick={saveAndSend}
                  >
                    Save &amp; send quote
                  </button>
                )}

                <div className="aj-footer-links">
                  {voiceStatus === 'confirm' && (
                    <>
                      <button
                        className="link-btn"
                        onClick={() => { setMoreOpen(v => !v); }}
                      >
                        {moreOpen ? 'Less options ⌃' : 'More options ⌄'}
                      </button>
                      <span className="aj-footer-sep">·</span>
                      <button
                        className="link-btn"
                        onClick={() => {
                          manualOverride.current = true;
                          setVoiceStatus('manual');
                        }}
                      >
                        Edit all fields
                      </button>
                    </>
                  )}
                  {voiceStatus === 'manual' && (
                    <button
                      className="link-btn"
                      onClick={() => { setMoreOpen(v => !v); }}
                    >
                      {moreOpen ? 'Less options ⌃' : 'More options ⌄'}
                    </button>
                  )}
                </div>

                {moreOpen && <MoreOptionsFields
                  materials={materials}     setMaterials={setMaterials}
                  labourHours={labourHours} setLabourHours={setLabourHours}
                  notes={notes}             setNotes={setNotes}
                  phone={phone}             setPhone={setPhone}
                  address={address}         setAddress={setAddress}
                  deposit={deposit}         setDeposit={setDeposit}
                />}

                {voiceStatus === 'manual' && (
                  <div className="modal-actions" style={{ marginTop: 12 }}>
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                  </div>
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
              <button className="aj-close-btn" onClick={onClose} aria-label="Close">✕</button>
            </div>

            {/* ── Voice: listening state ── */}
            {quoteVoiceStatus === 'listening' && (
              <>
                <div className="aj-mic-box">
                  <div className="aj-mic-icon">&#127908;</div>
                  <div className="aj-mic-label">Listening…</div>
                  <div className="aj-mic-sub">Say the job, customer, and price</div>
                </div>
                {quoteTranscript && (
                  <div className="aj-transcript">&ldquo;{quoteTranscript}&rdquo;</div>
                )}
                {!quoteTranscript && (
                  <div className="aj-transcript aj-transcript--hint">
                    e.g. &ldquo;Bathroom tiling Dave five hundred&rdquo;
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
                  <div className="aj-mic-icon aj-mic-icon--idle">&#127908;</div>
                  <div className="aj-mic-label">Nothing heard</div>
                  <div className="aj-mic-sub">Tap to try again</div>
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
                    <div className="aj-mic-icon">&#x23F3;</div>
                    <div className="aj-mic-label">Understanding…</div>
                  </div>
                )}
                {quoteTranscript && (
                  <div className="aj-transcript">&ldquo;{quoteTranscript}&rdquo;</div>
                )}
              </>
            )}

            {/* ── Quote form: confirm (post-voice) and manual (typed) ── */}
            {(quoteVoiceStatus === 'confirm' || quoteVoiceStatus === 'manual') && (
              <>
                {quoteVoiceStatus === 'confirm' && quoteTranscript && (
                  <div className="aj-transcript">&ldquo;{quoteTranscript}&rdquo;</div>
                )}

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
                    &#127908; Use voice instead
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

                {/* Line items — revealed by "+ Add line item" */}
                {showLineItems && (
                  <div className="aj-quote-line-items">
                    <div className="aj-quote-line-items-header">
                      <span className="aj-quote-line-items-title">Line items</span>
                    </div>
                    {lineItems.map((li, idx) => (
                      <div key={idx} className="aj-quote-line-row">
                        <input
                          type="text"
                          className="aj-quote-line-desc"
                          value={li.desc}
                          onChange={e => updateLineItem(idx, 'desc', e.target.value)}
                          placeholder="Description"
                          aria-label={`Line item ${idx + 1} description`}
                        />
                        <div className="aj-quote-line-cost-wrap">
                          <span className="aj-quote-line-currency">£</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            className="aj-quote-line-cost"
                            value={li.cost}
                            onChange={e => updateLineItem(idx, 'cost', e.target.value)}
                            placeholder="0"
                            aria-label={`Line item ${idx + 1} cost`}
                          />
                        </div>
                        <button
                          type="button"
                          className="aj-quote-line-remove"
                          onClick={() => removeLineItem(idx)}
                          aria-label={`Remove line item ${idx + 1}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="aj-quote-add-line-btn"
                      onClick={addLineItem}
                    >
                      + Add line item
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
                )}
                {showLineItems && (
                  <button
                    type="button"
                    className="aj-quote-add-items-link"
                    onClick={() => setShowLineItems(false)}
                  >
                    Show flat total instead
                  </button>
                )}

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

                {quoteVoiceStatus === 'confirm' && (
                  <div className="aj-footer-links">
                    <button
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

            {error && quoteVoiceStatus !== 'confirm' && quoteVoiceStatus !== 'manual' && (
              <p className="modal-error">{error}</p>
            )}
          </>
        )}

      </div>
    </div>
  );
}

function MoreOptionsFields({
  materials, setMaterials,
  labourHours, setLabourHours,
  notes, setNotes,
  phone, setPhone,
  address, setAddress,
  deposit, setDeposit,
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
        <label>
          <span>Deposit taken (£)</span>
          <input
            type="number"
            inputMode="decimal"
            value={deposit}
            onChange={e => setDeposit(e.target.value)}
            placeholder="0"
          />
        </label>
      </div>
    </div>
  );
}
