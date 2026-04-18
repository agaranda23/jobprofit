#!/usr/bin/env bash
# JobProfit — Today Screen patch
# Run from jobprofit/ repo root:  bash patch-today.sh
# Last good commit before this patch: ff1397f (App.jsx restore)

set -e

echo "→ Creating TodayScreen.jsx"

mkdir -p src/screens src/components src/lib

# ─────────────────────────────────────────────────────────────
# 1. TodayScreen — the new default landing view
# ─────────────────────────────────────────────────────────────
cat > src/screens/TodayScreen.jsx << 'JSXEOF'
import { useState, useMemo } from 'react';
import AddJobModal from '../components/AddJobModal';
import AddReceiptModal from '../components/AddReceiptModal';
import { gbp, todayKey, formatToday } from '../lib/today';

export default function TodayScreen({ jobs = [], receipts = [], onAddJob, onAddReceipt }) {
  const [jobOpen, setJobOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const key = todayKey();

  const { earned, spent, profit, recent } = useMemo(() => {
    const todaysJobs = jobs.filter(j => (j.date || '').slice(0, 10) === key);
    const todaysReceipts = receipts.filter(r => (r.date || '').slice(0, 10) === key);

    const earned = todaysJobs.reduce((s, j) => s + Number(j.amount || 0), 0);
    const spent = todaysReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);

    const entries = [
      ...todaysJobs.map(j => ({ id: 'j' + j.id, kind: 'job', label: j.name || 'Job', amount: Number(j.amount || 0), ts: j.createdAt || j.date })),
      ...todaysReceipts.map(r => ({ id: 'r' + r.id, kind: 'receipt', label: r.label || 'Receipt', amount: -Number(r.amount || 0), ts: r.createdAt || r.date })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 3);

    return { earned, spent, profit: earned - spent, recent: entries };
  }, [jobs, receipts, key]);

  return (
    <div className="today-screen">
      {/* Section 1 — Header */}
      <header className="today-header">
        <h1>Today</h1>
        <p className="today-date">{formatToday()}</p>
      </header>

      {/* Section 2 — Daily totals */}
      <section className="totals">
        <div className="total-row">
          <span className="total-label">Earned</span>
          <span className="total-value">{gbp(earned)}</span>
        </div>
        <div className="total-row">
          <span className="total-label">Spent</span>
          <span className="total-value">{gbp(spent)}</span>
        </div>
        <div className="total-row profit-row">
          <span className="total-label">Profit</span>
          <span className="total-value profit-value">{gbp(profit)}</span>
        </div>
      </section>

      {/* Section 3 — Primary actions */}
      <section className="actions">
        <button className="action-btn action-primary" onClick={() => setJobOpen(true)}>
          <span className="action-icon">🎤</span>
          <span>Add job</span>
        </button>
        <button className="action-btn action-secondary" onClick={() => setReceiptOpen(true)}>
          <span className="action-icon">📸</span>
          <span>Add receipt</span>
        </button>
      </section>

      {/* Section 4 — Recent today */}
      {recent.length > 0 && (
        <section className="recent">
          <h2>Recent today</h2>
          <ul className="recent-list">
            {recent.map(e => (
              <li key={e.id} className="recent-item">
                <span className="recent-label">{e.label}</span>
                <span className={`recent-amount ${e.amount >= 0 ? 'pos' : 'neg'}`}>
                  {e.amount >= 0 ? '+' : '−'}{gbp(Math.abs(e.amount))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {jobOpen && (
        <AddJobModal
          onClose={() => setJobOpen(false)}
          onSave={(payload) => { onAddJob?.(payload); setJobOpen(false); }}
        />
      )}
      {receiptOpen && (
        <AddReceiptModal
          onClose={() => setReceiptOpen(false)}
          onSave={(payload) => { onAddReceipt?.(payload); setReceiptOpen(false); }}
        />
      )}
    </div>
  );
}
JSXEOF

# ─────────────────────────────────────────────────────────────
# 2. AddJobModal — Web Speech + AI parse
# ─────────────────────────────────────────────────────────────
echo "→ Creating AddJobModal.jsx"

cat > src/components/AddJobModal.jsx << 'JSXEOF'
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
JSXEOF

# ─────────────────────────────────────────────────────────────
# 3. AddReceiptModal — camera capture + manual amount
# ─────────────────────────────────────────────────────────────
echo "→ Creating AddReceiptModal.jsx"

cat > src/components/AddReceiptModal.jsx << 'JSXEOF'
import { useRef, useState } from 'react';

export default function AddReceiptModal({ onClose, onSave }) {
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(null); // data URL
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const openCamera = () => fileRef.current?.click();

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(f);
  };

  const save = () => {
    const amt = parseFloat(amount);
    if (isNaN(amt)) { setError('Amount required'); return; }
    onSave({
      id: Date.now(),
      label: label.trim() || 'Receipt',
      amount: amt,
      photo, // data URL — swap for Supabase/Netlify blob upload later
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Add receipt</h3>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={onFile}
        />

        {!photo ? (
          <button className="btn-primary btn-large" onClick={openCamera}>
            📸 Take photo
          </button>
        ) : (
          <>
            <img src={photo} alt="Receipt" className="receipt-preview" />
            <button className="link-btn" onClick={openCamera}>Retake</button>
          </>
        )}

        <div className="modal-fields">
          <label>
            <span>Label (optional)</span>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Screwfix" />
          </label>
          <label>
            <span>Amount (£)</span>
            <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="42.00" autoFocus />
          </label>
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save receipt</button>
        </div>
      </div>
    </div>
  );
}
JSXEOF

# ─────────────────────────────────────────────────────────────
# 4. BottomNav — Today / History / More
# ─────────────────────────────────────────────────────────────
echo "→ Creating BottomNav.jsx"

cat > src/components/BottomNav.jsx << 'JSXEOF'
export default function BottomNav({ view, onChange }) {
  const tabs = [
    { id: 'today', label: 'Today', icon: '●' },
    { id: 'history', label: 'History', icon: '≡' },
    { id: 'more', label: 'More', icon: '⋯' },
  ];
  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`nav-tab ${view === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span className="nav-icon">{t.icon}</span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
JSXEOF

# ─────────────────────────────────────────────────────────────
# 5. lib helpers
# ─────────────────────────────────────────────────────────────
echo "→ Creating lib/today.js and lib/voiceParse.js"

cat > src/lib/today.js << 'JSEOF'
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatToday(d = new Date()) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function gbp(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: v % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
}
JSEOF

cat > src/lib/voiceParse.js << 'JSEOF'
// Parse "Bathroom tiling £650" style transcripts via the existing
// Netlify AI proxy at /.netlify/functions/ai.
// Falls back to regex if the API is unreachable.

export async function parseJobFromSpeech(transcript) {
  const text = (transcript || '').trim();
  if (!text) return { name: '', amount: null };

  // Try AI parse first
  try {
    const res = await fetch('/.netlify/functions/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        system: 'Extract a job name and amount in GBP from the user\'s transcript. Respond ONLY with JSON: {"name": string, "amount": number}. Amount should be a number in pounds (no currency symbol). If no amount found, set amount to null.',
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const block = (data.content || []).find(b => b.type === 'text');
      if (block?.text) {
        const clean = block.text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return {
          name: parsed.name || regexName(text),
          amount: parsed.amount ?? regexAmount(text),
        };
      }
    }
  } catch {
    // fall through to regex
  }

  return { name: regexName(text), amount: regexAmount(text) };
}

function regexAmount(text) {
  // Matches £650, 650 pounds, 1,250.50, 1.2k etc.
  const m = text.match(/£?\s*([\d,]+(?:\.\d+)?)\s*(k|pounds?|quid)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2] && /^k$/i.test(m[2])) n *= 1000;
  return isNaN(n) ? null : n;
}

function regexName(text) {
  // Strip amount mentions, trim trailing "for/at/£..." clauses
  return text
    .replace(/£?\s*[\d,]+(?:\.\d+)?\s*(k|pounds?|quid)?/gi, '')
    .replace(/\b(for|at|cost(s|ing)?|priced)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
JSEOF

# ─────────────────────────────────────────────────────────────
# 6. CSS — append Today screen styles
# ─────────────────────────────────────────────────────────────
echo "→ Appending styles to src/index.css"

python3 - << 'PYEOF'
from pathlib import Path
css_path = Path('src/index.css')
if not css_path.exists():
    css_path = Path('src/App.css')
if not css_path.exists():
    # create a minimal one
    css_path = Path('src/index.css')
    css_path.write_text('')

marker = '/* === TODAY SCREEN === */'
current = css_path.read_text()
if marker in current:
    print(f'  styles already present in {css_path}, skipping')
else:
    addition = '''

/* === TODAY SCREEN === */
:root {
  --bg: #0b0d10;
  --surface: #151a1f;
  --surface-2: #1d242b;
  --text: #f5f7fa;
  --text-dim: #8a95a2;
  --accent: #22c55e;
  --danger: #ef4444;
  --border: #2a333c;
}

body { background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }

.today-screen {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 20px 96px;
  min-height: 100vh;
}

.today-header h1 {
  font-size: 40px;
  font-weight: 700;
  margin: 0 0 6px;
  letter-spacing: -0.02em;
}
.today-date {
  color: var(--text-dim);
  font-size: 16px;
  margin: 0 0 28px;
}

.totals {
  background: var(--surface);
  border-radius: 16px;
  padding: 8px 20px;
  margin-bottom: 24px;
  border: 1px solid var(--border);
}
.total-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.total-row:last-child { border-bottom: none; }
.total-label { color: var(--text-dim); font-size: 16px; }
.total-value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.profit-row .total-label { color: var(--text); font-weight: 600; }
.profit-value { font-size: 32px; font-weight: 700; color: var(--accent); letter-spacing: -0.01em; }

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 32px;
}
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  padding: 20px;
  border-radius: 14px;
  border: none;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.05s ease, background 0.15s ease;
}
.action-btn:active { transform: scale(0.98); }
.action-icon { font-size: 22px; }
.action-primary { background: var(--accent); color: #0b1f10; }
.action-primary:hover { background: #16a34a; }
.action-secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.action-secondary:hover { background: #242d36; }

.recent h2 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 12px;
}
.recent-list { list-style: none; padding: 0; margin: 0; }
.recent-item {
  display: flex;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  font-size: 16px;
}
.recent-item:last-child { border-bottom: none; }
.recent-amount.pos { color: var(--accent); font-variant-numeric: tabular-nums; }
.recent-amount.neg { color: var(--danger); font-variant-numeric: tabular-nums; }

/* Bottom nav */
.bottom-nav {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  display: flex;
  background: rgba(11, 13, 16, 0.92);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--border);
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
  z-index: 10;
}
.nav-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text-dim);
  padding: 8px;
  font-size: 12px;
  cursor: pointer;
}
.nav-tab.active { color: var(--text); }
.nav-icon { font-size: 18px; }

/* Modals */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--surface);
  width: 100%;
  max-width: 480px;
  border-radius: 20px 20px 0 0;
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom));
  border: 1px solid var(--border);
  border-bottom: none;
}
@media (min-width: 481px) {
  .modal-backdrop { align-items: center; }
  .modal { border-radius: 20px; border-bottom: 1px solid var(--border); }
}
.modal-title { font-size: 22px; font-weight: 700; margin: 0 0 16px; }
.modal-help { color: var(--text-dim); font-size: 15px; margin: 0 0 12px; }
.modal-fields { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
.modal-fields label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: var(--text-dim); }
.modal-fields input {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 18px;
  padding: 14px;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
}
.modal-fields input:focus { outline: 2px solid var(--accent); outline-offset: -2px; }
.modal-actions { display: flex; gap: 10px; margin-top: 8px; }
.modal-actions button { flex: 1; }
.btn-primary {
  background: var(--accent);
  color: #0b1f10;
  border: none;
  padding: 14px;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary.btn-large { padding: 20px; font-size: 18px; width: 100%; margin-bottom: 16px; }
.btn-secondary {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 14px;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
}
.link-btn { background: none; border: none; color: var(--accent); font-size: 14px; cursor: pointer; padding: 8px 0; }
.modal-error { color: var(--danger); font-size: 14px; margin: 8px 0 0; }

.voice-indicator {
  font-size: 20px;
  font-weight: 600;
  text-align: center;
  padding: 24px;
  background: var(--surface-2);
  border-radius: 12px;
  margin: 12px 0;
}
.transcript-preview {
  font-size: 16px;
  color: var(--text-dim);
  text-align: center;
  min-height: 24px;
  margin: 12px 0;
  font-style: italic;
}

.receipt-preview {
  width: 100%;
  max-height: 280px;
  object-fit: contain;
  border-radius: 12px;
  background: #000;
  margin-bottom: 8px;
}
'''
    css_path.write_text(current + addition)
    print(f'  appended Today screen styles to {css_path}')
PYEOF

# ─────────────────────────────────────────────────────────────
# 7. Patch App.jsx — add view state, render TodayScreen + BottomNav
# ─────────────────────────────────────────────────────────────
echo "→ Patching src/App.jsx"

python3 - << 'PYEOF'
from pathlib import Path
import re

p = Path('src/App.jsx')
if not p.exists():
    print('  ⚠️  src/App.jsx not found — skipping')
    raise SystemExit(0)

src = p.read_text()
original = src

# 1. Ensure imports
imports_to_add = [
    ("import TodayScreen",   "import TodayScreen from './screens/TodayScreen';"),
    ("import BottomNav",     "import BottomNav from './components/BottomNav';"),
]
# Find the last top-level import line
import_lines = list(re.finditer(r'^import .+?;$', src, re.MULTILINE))
if import_lines:
    last_import_end = import_lines[-1].end()
    additions = []
    for marker, line in imports_to_add:
        if marker not in src:
            additions.append(line)
    if additions:
        src = src[:last_import_end] + '\n' + '\n'.join(additions) + src[last_import_end:]
        print(f'  added {len(additions)} import(s)')

# 2. Inject view state + handlers into the App component
# Strategy: find `function App(` and insert state right after its opening brace.
if 'const [view, setView]' not in src:
    m = re.search(r'(function\s+App\s*\([^)]*\)\s*\{)', src)
    if m:
        insertion = """

  // --- Today screen state (added by patch-today) ---
  const [view, setView] = useState('today');
  const [todayJobs, setTodayJobs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jp.jobs') || '[]'); } catch { return []; }
  });
  const [todayReceipts, setTodayReceipts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jp.receipts') || '[]'); } catch { return []; }
  });
  const handleAddJob = (job) => {
    setTodayJobs(prev => {
      const next = [job, ...prev];
      try { localStorage.setItem('jp.jobs', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const handleAddReceipt = (receipt) => {
    setTodayReceipts(prev => {
      const next = [receipt, ...prev];
      try { localStorage.setItem('jp.receipts', JSON.stringify(next)); } catch {}
      return next;
    });
  };
"""
        src = src[:m.end()] + insertion + src[m.end():]
        print('  injected view state into App()')
    else:
        print('  ⚠️  could not find `function App(` — state not injected')

# 3. Ensure useState is imported from react
if 'useState' not in src.split('\n', 50)[0] and not re.search(r"import\s*\{[^}]*useState[^}]*\}\s*from\s*['\"]react['\"]", src):
    # Try to augment an existing `import ... from 'react'` line
    m = re.search(r"import\s+(\w+)\s*,?\s*\{([^}]*)\}\s*from\s*['\"]react['\"];", src)
    if m:
        names = [n.strip() for n in m.group(2).split(',') if n.strip()]
        if 'useState' not in names:
            names.append('useState')
            new = f"import {m.group(1)}, {{ {', '.join(names)} }} from 'react';"
            src = src[:m.start()] + new + src[m.end():]
            print('  added useState to existing react import')
    else:
        m2 = re.search(r"import\s+(\w+)\s+from\s*['\"]react['\"];", src)
        if m2:
            new = f"import {m2.group(1)}, {{ useState }} from 'react';"
            src = src[:m2.start()] + new + src[m2.end():]
            print('  augmented react default import with useState')
        else:
            # Prepend a fresh import
            src = "import { useState } from 'react';\n" + src
            print('  prepended useState import')

# 4. Wrap the existing JSX return with view-conditional rendering + BottomNav.
# Heuristic: find the `return (` inside App and wrap its content.
# We look for the FIRST `return (` after `function App(` to be safe.
app_match = re.search(r'function\s+App\s*\([^)]*\)\s*\{', src)
if app_match and '{/* patched-today-root */}' not in src:
    ret = re.search(r'return\s*\(', src[app_match.end():])
    if ret:
        ret_abs_start = app_match.end() + ret.start()
        ret_abs_open = app_match.end() + ret.end()  # position right after `(`
        # Find matching closing `)`
        depth = 1
        i = ret_abs_open
        while i < len(src) and depth > 0:
            c = src[i]
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            i += 1
        if depth == 0:
            ret_abs_close = i - 1  # position of the matching `)`
            inner = src[ret_abs_open:ret_abs_close].strip()
            wrapped = f"""(
    <>
      {{/* patched-today-root */}}
      {{view === 'today' && (
        <TodayScreen
          jobs={{todayJobs}}
          receipts={{todayReceipts}}
          onAddJob={{handleAddJob}}
          onAddReceipt={{handleAddReceipt}}
        />
      )}}
      {{view === 'history' && (
        <div className="today-screen">
          {inner}
        </div>
      )}}
      {{view === 'more' && (
        <div className="today-screen">
          <h1 style={{{{ fontSize: 32, marginTop: 16 }}}}>More</h1>
          <p style={{{{ color: 'var(--text-dim)' }}}}>Reports, analytics, exports and settings will move here.</p>
          {inner}
        </div>
      )}}
      <BottomNav view={{view}} onChange={{setView}} />
    </>
  )"""
            src = src[:ret_abs_start] + 'return ' + wrapped + src[ret_abs_close + 1:]
            print('  wrapped App return() with view router + BottomNav')

if src != original:
    p.write_text(src)
    print('✓ App.jsx patched')
else:
    print('  App.jsx already up to date')
PYEOF

echo ""
echo "✅ Patch complete."
echo ""
echo "Next steps:"
echo "  1. npm run dev — verify Today screen loads as default"
echo "  2. Test: voice add job, photo receipt, localStorage persistence"
echo "  3. git add -A && git commit -m 'feat(today): simplified Today screen with voice/receipt entry + bottom nav'"
