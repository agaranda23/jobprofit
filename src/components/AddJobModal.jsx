import { useEffect, useRef, useState } from 'react';
import { parseJobFromSpeech } from '../lib/voiceParse';

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

export default function AddJobModal({ onClose, onSave, onOpenDetailed }) {
  // 'micro'    — Two-Tap Micro-Log (new default entry)
  // 'details'  — full Direction A form (reached via "+ Add details" link)
  // 'listening'| 'parsing' | 'confirm' | 'manual' — voice states within 'details'
  const [view, setView] = useState('micro');

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

  // ── Voice state (only active in 'details' view) ───────────────────────────
  const [voiceStatus, setVoiceStatus] = useState('listening');
  const [transcript, setTranscript]   = useState('');
  const [retryCount, setRetryCount]   = useState(0);
  const recogRef        = useRef(null);
  const manualOverride  = useRef(false);
  const hasAutoStarted  = useRef(false);

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
          setError('Nothing heard — say the job and amount');
          setVoiceStatus('listening');
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
            setError('Nothing heard — say the job and amount');
            return 'listening';
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
    try {
      const parsed = await parseJobFromSpeech(text);
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
  const saveDetails = () => {
    const resolvedName = name.trim() || autoJobName();
    const isPaid = paymentChip !== 'awaiting';
    if (isPaid && !amount.trim()) {
      setError('Add an amount before you can mark this paid');
      return;
    }
    const amt = amount.trim() ? parseFloat(amount) : null;
    if (amt !== null && (isNaN(amt) || amt <= 0)) {
      setError("That amount doesn't look right");
      return;
    }
    setError('');
    onSave({
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
    });
  };

  // Auto-start voice only when entering the 'details' view.
  useEffect(() => {
    if (view !== 'details') return;
    if (hasAutoStarted.current) return;
    hasAutoStarted.current = true;
    startListening();
    return () => { try { recogRef.current?.abort(); } catch {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-tall" onClick={e => e.stopPropagation()}>

        {/* ══ MICRO-LOG VIEW (default entry) ════════════════════════════════ */}
        {view === 'micro' && (
          <>
            <div className="aj-header">
              <h3 className="modal-title">
                Add job
                {!isOnline() && (
                  <span className="aj-offline-pill" aria-label="Offline">⚡ Offline</span>
                )}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Voice shortcut — secondary, not the default */}
                {SR && isOnline() && (
                  <button
                    className="aj-mic-shortcut"
                    aria-label="Use voice instead"
                    title="Use voice"
                    type="button"
                    onClick={() => {
                      setView('details');
                      // hasAutoStarted is still false at this point → voice will auto-start
                    }}
                  >
                    🎤
                  </button>
                )}
                <button className="aj-close-btn" onClick={onClose} aria-label="Close">✕</button>
              </div>
            </div>

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

            <button
              className="btn-primary btn-large aj-save-btn"
              onClick={saveMicro}
            >
              Save
            </button>

            <button
              className="aj-details-link"
              type="button"
              onClick={() => setView('details')}
            >
              + Add details (name, customer, when)
            </button>
          </>
        )}

        {/* ══ DETAILS VIEW (full Direction A form) ══════════════════════════ */}
        {view === 'details' && (
          <>
            <div className="aj-header">
              <h3 className="modal-title">Add details</h3>
              <button className="aj-close-btn" onClick={onClose} aria-label="Close">✕</button>
            </div>

            <p className="aj-details-sub">Add name, customer, and date</p>

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

            {/* ── Voice: parsing state ── */}
            {voiceStatus === 'parsing' && (
              <>
                <div className="aj-mic-box aj-mic-box--parsing">
                  <div className="aj-mic-icon">⏳</div>
                  <div className="aj-mic-label">Understanding…</div>
                </div>
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
