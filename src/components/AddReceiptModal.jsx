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
