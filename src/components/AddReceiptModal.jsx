import { useRef, useState } from 'react';

const isMobile = typeof navigator !== 'undefined' &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export default function AddReceiptModal({ onClose, onSave }) {
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const openPicker = () => fileRef.current?.click();

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
      photo,
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
          {...(isMobile ? { capture: 'environment' } : {})}
          style={{ display: 'none' }}
          onChange={onFile}
        />

        {!photo ? (
          <button type="button" className="btn-primary btn-large" onClick={openPicker}>
            📸 {isMobile ? 'Take photo' : 'Choose photo'}
          </button>
        ) : (
          <>
            <img src={photo} alt="Receipt" className="receipt-preview" />
            <button type="button" className="link-btn" onClick={openPicker}>Change photo</button>
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
