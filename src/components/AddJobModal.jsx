import { useEffect, useRef, useState } from 'react';
import { parseJobFromSpeech } from '../lib/voiceParse';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export default function AddJobModal({ onClose, onSave, onOpenDetailed }) {
  const [status, setStatus] = useState('idle'); // idle | listening | parsing | preview | manual
  const [transcript, setTranscript] = useState('');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState(null);
  const [unpaid, setUnpaid] = useState(false);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const recogRef = useRef(null);
  const manualOverride = useRef(false);

  // Clean up any active recognition on unmount
  useEffect(() => {
    return () => { try { recogRef.current?.abort(); } catch {} };
  }, []);

  const startListening = () => {
    setError('');
    setTranscript('');
    if (!SR) { setStatus('manual'); return; }
    try {
      const r = new SR();
      r.lang = 'en-GB'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
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
          setError('Microphone blocked. Allow it in the address bar.');
          setStatus('manual');
        } else if (e.error === 'no-speech') {
          setError('Say the job and amount');
          setStatus('idle');
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
            setError('Say the job and amount');
            return 'idle';
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

  const stopListening = () => { try { recogRef.current?.stop(); } catch {} };

  const parse = async (text) => {
    try {
      const parsed = await parseJobFromSpeech(text);
      const cleanName = (parsed.name || '').trim();
      const cleanCustomer = (parsed.customer || '').trim();
      const cleanAmt = parsed.amount;

      if (cleanAmt == null || isNaN(cleanAmt) || cleanAmt <= 0) {
        // No amount detected → prompt retry (auto)
        if (retryCount < 1) {
          setError("Couldn't find an amount — try again");
          setRetryCount(c => c + 1);
          setTimeout(() => startListening(), 600);
          return;
        }
        // After one retry, drop to manual with what we have
        setName(cleanName);
        setCustomer(cleanCustomer);
        setAmount('');
        setPaymentType(parsed.paymentType || null);
        setStatus('manual');
        return;
      }

      setName(cleanName || 'Job');
      setCustomer(cleanCustomer);
      setAmount(String(cleanAmt));
      setPaymentType(parsed.paymentType || null);
      setStatus('preview');
    } catch {
      setStatus('manual');
    }
  };

  const save = () => {
    const amt = parseFloat(amount);
    if (!name.trim() || isNaN(amt)) { setError('Name and amount required'); return; }
    onSave({
      id: Date.now(),
      name: name.trim(),
      customer: customer.trim() || null,
      phone: phone.trim() || null,
      amount: amt,
      paymentType: paymentType || null,
      paid: !unpaid,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Add job</h3>

        {status === 'idle' && (
          <>
            <p className="modal-help">Say what you earned</p>
            <p className="modal-example">Example: "Kitchen job Sarah £380 cash"</p>
            <button className="mic-button" onClick={startListening}>🎤 Tap to speak</button>
            <button className="link-btn centered" onClick={() => { setError(''); setStatus('manual'); }}>Type instead</button>
          </>
        )}

        {status === 'listening' && (
          <>
            <p className="modal-help">Say what you earned</p>
            <div className="voice-indicator pulsing">🎤 Listening…</div>
            <p className="transcript-preview">{transcript || 'Example: "Kitchen job Sarah £380 cash"'}</p>
            <button className="btn-primary" onClick={stopListening} style={{ width: '100%', marginBottom: 8 }}>Done</button>
            <button className="link-btn centered" onClick={() => { manualOverride.current = true; stopListening(); setStatus('manual'); }}>Type instead</button>
          </>
        )}

        {status === 'parsing' && (
          <>
            <p className="modal-help">Understanding…</p>
            <p className="transcript-preview">{transcript}</p>
          </>
        )}

        {status === 'preview' && (
          <>
            <div className="preview-grid">
              <div className="preview-row">
                <span className="preview-label">Job</span>
                <span className="preview-value">{name}</span>
              </div>
              {customer && (
                <div className="preview-row">
                  <span className="preview-label">Customer</span>
                  <span className="preview-value">{customer}</span>
                </div>
              )}
              <div className="preview-row">
                <span className="preview-label">Amount</span>
                <span className="preview-value preview-amount">£{amount}</span>
              </div>
              {paymentType && (
                <div className="preview-row">
                  <span className="preview-label">Payment</span>
                  <span className="preview-value">{paymentType}</span>
                </div>
              )}
            </div>
            <label className="unpaid-toggle">
              <input type="checkbox" checked={unpaid} onChange={e => setUnpaid(e.target.checked)} />
              <span>Still waiting to be paid</span>
            </label>
            <button className="btn-primary btn-large" onClick={save} style={{ marginTop: 8 }}>Save job</button>
            <button className="link-btn centered" onClick={() => setStatus('manual')}>Edit details</button>
          </>
        )}

        {status === 'manual' && (
          <>
            <div className="modal-fields">
              <label><span>Job</span>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Kitchen renovation" autoFocus />
              </label>
              <label><span>Customer</span>
                <input type="text" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Sarah Mitchell" />
              </label>
              <label><span>Phone</span>
                <input type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="07700 900123" />
              </label>
              <label><span>Amount (£)</span>
                <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="380" />
              </label>
            </div>
            <label className="unpaid-toggle">
              <input type="checkbox" checked={unpaid} onChange={e => setUnpaid(e.target.checked)} />
              <span>Still waiting to be paid</span>
            </label>
            <div className="modal-actions">
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
