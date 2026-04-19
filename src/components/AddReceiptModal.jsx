import { useRef, useState } from 'react';
import { extractReceipt } from '../lib/receiptOCR';

export default function AddReceiptModal({ onClose, onSave }) {
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [vat, setVat] = useState('');
  const [items, setItems] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [error, setError] = useState('');

  const openPicker = () => fileRef.current?.click();

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setPhoto(dataUrl);
      setExtractError('');
      setExtracting(true);
      try {
        const result = await extractReceipt(dataUrl);
        if (result?.error) {
          setExtractError("OCR failed: " + result.error);
        } else if (result) {
          if (result.merchant) setLabel(result.merchant);
          if (result.total != null) setAmount(String(result.total));
          if (result.vat != null) setVat(String(result.vat));
          if (result.items?.length) setItems(result.items);
          if (!result.merchant && result.total == null) {
            setExtractError("Couldn't read this receipt - fill in below");
          }
        }
      } finally {
        setExtracting(false);
      }
    };
    reader.readAsDataURL(f);
  };

  const updateItem = (idx, field, value) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: field === 'cost' ? parseFloat(value) || 0 : value } : it));
  };
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const save = () => {
    const amt = parseFloat(amount);
    if (isNaN(amt)) { setError('Amount required'); return; }
    const vatNum = vat === '' ? 0 : parseFloat(vat);
    onSave({
      id: Date.now(),
      label: label.trim() || 'Receipt',
      amount: amt,
      vat: isNaN(vatNum) ? 0 : vatNum,
      items: items.filter(i => i.desc?.trim()),
      photo,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-tall" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Add receipt</h3>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFile}
        />

        {!photo ? (
          <>
            <button type="button" className="btn-primary btn-large" onClick={openPicker}>
              📸 Add photo
            </button>
            <p className="modal-help" style={{ textAlign: 'center', marginTop: 8 }}>
              Take a photo or choose one from your phone
            </p>
          </>
        ) : (
          <>
            <img src={photo} alt="Receipt" className="receipt-preview" />
            <button type="button" className="link-btn centered" onClick={openPicker}>Change photo</button>
          </>
        )}

        {extracting && (
          <div className="ocr-status">
            <span className="ocr-spinner" /> Reading receipt…
          </div>
        )}
        {extractError && !extracting && (
          <p className="modal-help" style={{ color: 'var(--text-dim)', marginTop: 8 }}>{extractError}</p>
        )}

        <div className="modal-fields">
          <label>
            <span>Merchant</span>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Screwfix" />
          </label>
          <div className="field-row">
            <label style={{ flex: 2 }}>
              <span>Amount (£)</span>
              <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="42.00" />
            </label>
            <label style={{ flex: 1 }}>
              <span>VAT (£)</span>
              <input type="number" inputMode="decimal" value={vat} onChange={e => setVat(e.target.value)} placeholder="7.00" />
            </label>
          </div>
        </div>

        {items.length > 0 && (
          <div className="receipt-items">
            <div className="receipt-items-header">
              <span>Items</span>
              <span>{items.length}</span>
            </div>
            <ul className="receipt-items-list">
              {items.map((it, i) => (
                <li key={i} className="receipt-item">
                  <input
                    type="text"
                    value={it.desc}
                    onChange={e => updateItem(i, 'desc', e.target.value)}
                    className="receipt-item-desc"
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    value={it.cost ?? ''}
                    onChange={e => updateItem(i, 'cost', e.target.value)}
                    className="receipt-item-cost"
                  />
                  <button className="receipt-item-x" onClick={() => removeItem(i)} title="Remove">×</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={extracting}>Save receipt</button>
        </div>
      </div>
    </div>
  );
}
