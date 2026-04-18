import { useEffect, useRef, useState } from 'react';
import { parseJobFromSpeech } from '../lib/voiceParse';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export default function AddJobModal({ onClose, onSave }) {
  const [status, setStatus] = useState('ready');
  const [transcript, setTranscript] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unpaid, setUnpaid] = useState(false);
  const [error, setError] = useState('');
  const recogRef = useRef(null);
  const unpaidRef = useRef(false);

  useEffect(() => { unpaidRef.current = unpaid; }, [unpaid]);
  useEffect(() => () => { try { recogRef.current?.abort(); } catch {} }, []);

  const startListening = () => {
    setError('');
    if (!SR) { setError('Voice input not supported here. Type below instead.'); return; }
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
        const msg = e.error === 'not-allowed' ? 'Microphone blocked. Enable it in the address bar.'
          : e.error === 'no-speech' ? "Didn't catch that. Tap the mic and try again."
          : `Mic error: ${e.error}`;
        setError(msg); setStatus('ready');
      };
      r.onend = () => {
        setStatus(s => {
          if (s === 'listening') {
            const t = (finalText || transcript || '').trim();
            if (t) { parse(t); return 'parsing'; }
            return 'ready';
          }
          return s;
        });
      };
      recogRef.current = r;
      r.start();
      setStatus('listening');
    } catch (err) {
      setError(`Couldn't start mic: ${err.message}`);
      setStatus('ready');
    }
  };

  const stopListening = () => { try { recogRef.current?.stop(); } catch {} };

  const parse = async (text) => {
    try {
      const parsed = await parseJobFromSpeech(text);
      const cleanName = (parsed.name || '').trim();
      const cleanAmt = parsed.amount;

      if (cleanName && cleanAmt != null && !isNaN(cleanAmt) && cleanAmt > 0) {
        onSave({
          id: Date.now(),
          name: cleanName,
          amount: cleanAmt,
          paid: !unpaidRef.current,
          date: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
        return;
      }

      setName(cleanName);
      setAmount(cleanAmt != null ? String(cleanAmt) : '');
      setStatus('review');
    } catch {
      setStatus('review');
    }
  };

  const save = () => {
    const amt = parseFloat(amount);
    if (!name.trim() || isNaN(amt)) { setError('Name and amount required'); return; }
    onSave({
      id: Date.now(), name: name.trim(), amount: amt,
      paid: !unpaid,
      date: new Date().toISOString(), createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Add job</h3>

        {status === 'ready' && (
          <>
            <p className="modal-help">Tap the mic and say the job + amount, or type below.</p>
            <button className="mic-button" onClick={startListening}>🎤 Tap to speak</button>
            <p className="modal-or">— or —</p>
          </>
        )}

        {status === 'listening' && (
          <>
            <div className="voice-indicator pulsing">🎤 Listening…</div>
            <p className="transcript-preview">{transcript || 'Say something like "bathroom tiling 650"'}</p>
            <button className="btn-primary" onClick={stopListening} style={{ width: '100%', marginBottom: 12 }}>Done</button>
          </>
        )}

        {status === 'parsing' && (
          <>
            <p className="modal-help">Saving…</p>
            <p className="transcript-preview">{transcript}</p>
          </>
        )}

        {(status === 'review' || status === 'ready') && (
          <>
            <div className="modal-fields">
              <label><span>Job</span>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Bathroom tiling" />
              </label>
              <label><span>Amount (£)</span>
                <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="650" />
              </label>
            </div>
            <label className="unpaid-toggle">
              <input type="checkbox" checked={unpaid} onChange={e => setUnpaid(e.target.checked)} />
              <span>Still waiting to be paid</span>
            </label>
          </>
        )}

        {error && <p className="modal-error">{error}</p>}

        {status !== 'listening' && status !== 'parsing' && (
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save}>Save job</button>
          </div>
        )}
      </div>
    </div>
  );
}
