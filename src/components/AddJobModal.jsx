import { useEffect, useRef, useState } from 'react';
import { parseJobFromSpeech } from '../lib/voiceParse';

export default function AddJobModal({ onClose, onSave }) {
  const [status, setStatus] = useState('idle'); // idle | listening | parsing | review | error
  const [transcript, setTranscript] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const recogRef = useRef(null);

  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  useEffect(() => {
    if (!SpeechRecognition) return;
    const r = new SpeechRecognition();
    r.lang = 'en-GB';
    r.interimResults = true;
    r.continuous = false;

    r.onresult = (e) => {
      const text = Array.from(e.results).map(res => res[0].transcript).join(' ');
      setTranscript(text);
    };
    r.onend = async () => {
      setStatus(s => (s === 'listening' ? 'parsing' : s));
    };
    r.onerror = (e) => {
      setError(e.error || 'Speech error');
      setStatus('error');
    };

    recogRef.current = r;
    return () => { try { r.abort(); } catch {} };
  }, [SpeechRecognition]);

  // Kick off listening as soon as the modal opens
  useEffect(() => {
    if (!SpeechRecognition) return;
    try {
      recogRef.current?.start();
      setStatus('listening');
    } catch {}
  }, [SpeechRecognition]);

  // When listening ends and we have a transcript, parse it
  useEffect(() => {
    if (status !== 'parsing') return;
    (async () => {
      try {
        const parsed = await parseJobFromSpeech(transcript);
        setName(parsed.name || '');
        setAmount(parsed.amount != null ? String(parsed.amount) : '');
        setStatus('review');
      } catch (e) {
        setError(e.message || 'Could not parse');
        setStatus('review'); // still let user edit
      }
    })();
  }, [status, transcript]);

  const stop = () => {
    try { recogRef.current?.stop(); } catch {}
  };

  const save = () => {
    const amt = parseFloat(amount);
    if (!name || isNaN(amt)) { setError('Name and amount required'); return; }
    onSave({
      id: Date.now(),
      name: name.trim(),
      amount: amt,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  };

  if (!SpeechRecognition) {
    // Fallback: plain manual entry
    return (
      <ModalShell onClose={onClose} title="Add job">
        <p className="modal-help">Voice input not supported here — enter manually.</p>
        <ManualFields name={name} setName={setName} amount={amount} setAmount={setAmount} />
        <ModalActions onCancel={onClose} onSave={save} />
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} title="Say the job and amount">
      {status === 'listening' && (
        <>
          <p className="modal-help">Example: "Bathroom tiling £650"</p>
          <div className="voice-indicator">🎤 Listening…</div>
          <p className="transcript-preview">{transcript || '...'}</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={stop}>Done</button>
          </div>
        </>
      )}
      {status === 'parsing' && (
        <>
          <p className="modal-help">Understanding…</p>
          <p className="transcript-preview">{transcript}</p>
        </>
      )}
      {status === 'review' && (
        <>
          <p className="modal-help">Confirm and save</p>
          <ManualFields name={name} setName={setName} amount={amount} setAmount={setAmount} />
          {error && <p className="modal-error">{error}</p>}
          <ModalActions onCancel={onClose} onSave={save} saveLabel="Save job" />
        </>
      )}
      {status === 'error' && (
        <>
          <p className="modal-error">{error}</p>
          <ManualFields name={name} setName={setName} amount={amount} setAmount={setAmount} />
          <ModalActions onCancel={onClose} onSave={save} saveLabel="Save job" />
        </>
      )}
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ManualFields({ name, setName, amount, setAmount }) {
  return (
    <div className="modal-fields">
      <label>
        <span>Job</span>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Bathroom tiling" />
      </label>
      <label>
        <span>Amount (£)</span>
        <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="650" />
      </label>
    </div>
  );
}

function ModalActions({ onCancel, onSave, saveLabel = 'Save' }) {
  return (
    <div className="modal-actions">
      <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      <button className="btn-primary" onClick={onSave}>{saveLabel}</button>
    </div>
  );
}
