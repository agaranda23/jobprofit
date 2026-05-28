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

export default function AddJobModal({ onClose, onSave, onOpenDetailed }) {
  // listening | parsing | confirm | manual
  const [status, setStatus] = useState('listening');
  const [transcript, setTranscript] = useState('');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  // paymentChip: 'awaiting' | 'cash' | 'bank' | 'card'
  const [paymentChip, setPaymentChip] = useState('awaiting');
  const [jobDate, setJobDate] = useState(todayISODate());
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [materials, setMaterials] = useState('');
  const [labourHours, setLabourHours] = useState('');
  const [notes, setNotes] = useState('');
  const [deposit, setDeposit] = useState('');
  const [address, setAddress] = useState('');
  const recogRef = useRef(null);
  const manualOverride = useRef(false);
  const hasAutoStarted = useRef(false);

  const stopListening = () => { try { recogRef.current?.stop(); } catch {} };

  const startListening = () => {
    setError('');
    setTranscript('');
    if (!SR) { setStatus('manual'); return; }
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
          setStatus('manual');
        } else if (e.error === 'no-speech') {
          setError('Nothing heard — say the job and amount');
          setStatus('listening');
        } else {
          setError(`Mic error: ${e.error}`);
          setStatus('manual');
        }
      };
      r.onend = () => {
        if (manualOverride.current) { manualOverride.current = false; return; }
        setStatus(s => {
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
      setStatus('listening');
    } catch (err) {
      setError(`Couldn't start mic: ${err.message}`);
      setStatus('manual');
    }
  };

  // Auto-start mic on mount (hot-mic)
  useEffect(() => {
    if (hasAutoStarted.current) return;
    hasAutoStarted.current = true;
    startListening();
    return () => { try { recogRef.current?.abort(); } catch {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parse = async (text) => {
    try {
      const parsed = await parseJobFromSpeech(text);
      const cleanName = (parsed.name || '').trim();
      const cleanCustomer = (parsed.customer || '').trim();
      const cleanAmt = parsed.amount;

      if (cleanAmt == null || isNaN(cleanAmt) || cleanAmt <= 0) {
        if (retryCount < 1) {
          setError("Couldn't find an amount — try again");
          setRetryCount(c => c + 1);
          setTimeout(() => startListening(), 600);
          return;
        }
        // After one retry drop to manual with what we have
        setName(cleanName);
        setCustomer(cleanCustomer);
        setAmount('');
        if (parsed.paymentType) applyPaymentType(parsed.paymentType);
        setStatus('manual');
        return;
      }

      setName(cleanName || 'Job');
      setCustomer(cleanCustomer);
      setAmount(String(cleanAmt));
      if (parsed.paymentType) applyPaymentType(parsed.paymentType);
      else setPaymentChip('awaiting');
      setStatus('confirm');
    } catch {
      setStatus('manual');
    }
  };

  function applyPaymentType(pt) {
    const t = (pt || '').toLowerCase();
    if (t === 'cash') setPaymentChip('cash');
    else if (t === 'bank' || t === 'bacs' || t === 'transfer') setPaymentChip('bank');
    else if (t === 'card') setPaymentChip('card');
    else setPaymentChip('awaiting');
  }

  const save = () => {
    const amt = parseFloat(amount);
    if (!name.trim() || isNaN(amt) || amt <= 0) {
      setError('Job name and amount are required');
      return;
    }
    const isPaid = paymentChip !== 'awaiting';
    onSave({
      id: Date.now(),
      name: name.trim(),
      customer: customer.trim() || null,
      phone: phone.trim() || null,
      amount: amt,
      paymentType: isPaid ? paymentChip : null,
      paid: isPaid,
      date: jobDate ? new Date(jobDate + 'T12:00:00').toISOString() : new Date().toISOString(),
      createdAt: new Date().toISOString(),
      ...(materials.trim() ? { materialsCost: parseFloat(materials) || 0 } : {}),
      ...(labourHours.trim() ? { labourHours: parseFloat(labourHours) || 0 } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(deposit.trim() ? { deposit: parseFloat(deposit) || 0 } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
    });
  };

  const saveLabel = () => {
    if (paymentChip === 'awaiting') {
      const who = customer.trim() || 'This job';
      return `Save · ${who} goes on the chase list`;
    }
    return `Save · paid by ${paymentChip}`;
  };

  const chipClass = (id) =>
    `aj-chip${paymentChip === id ? ' aj-chip--on' : ''}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-tall" onClick={e => e.stopPropagation()}>
        <div className="aj-header">
          <h3 className="modal-title">Add job</h3>
          <button className="aj-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Listening state ── */}
        {status === 'listening' && (
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
                  setStatus('manual');
                }}
              >
                Type instead
              </button>
            </div>
          </>
        )}

        {/* ── Parsing state ── */}
        {status === 'parsing' && (
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

        {/* ── Confirm state (voice parsed OK) ── */}
        {status === 'confirm' && (
          <>
            {transcript && (
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

            <button className="btn-primary btn-large aj-save-btn" onClick={save}>
              {saveLabel()}
            </button>

            <div className="aj-footer-links">
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
                  setStatus('manual');
                }}
              >
                Edit all fields
              </button>
            </div>

            {moreOpen && <MoreOptionsFields
              materials={materials} setMaterials={setMaterials}
              labourHours={labourHours} setLabourHours={setLabourHours}
              notes={notes} setNotes={setNotes}
              phone={phone} setPhone={setPhone}
              address={address} setAddress={setAddress}
              deposit={deposit} setDeposit={setDeposit}
            />}
          </>
        )}

        {/* ── Manual (type instead) state ── */}
        {status === 'manual' && (
          <>
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

            <div className="modal-fields">
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
                <span>Job</span>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Kitchen renovation"
                  autoFocus
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

            <div className="aj-footer-links" style={{ marginTop: 4 }}>
              <button
                className="link-btn"
                onClick={() => { setMoreOpen(v => !v); }}
              >
                {moreOpen ? 'Less options ⌃' : 'More options ⌄'}
              </button>
            </div>

            {moreOpen && <MoreOptionsFields
              materials={materials} setMaterials={setMaterials}
              labourHours={labourHours} setLabourHours={setLabourHours}
              notes={notes} setNotes={setNotes}
              phone={phone} setPhone={setPhone}
              address={address} setAddress={setAddress}
              deposit={deposit} setDeposit={setDeposit}
            />}

            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={save}>Save job</button>
            </div>
          </>
        )}

        {error && <p className="modal-error">{error}</p>}
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
