import { useRef, useState, useMemo } from 'react';
import { extractReceipt } from '../lib/receiptOCR';
import { saveLineItemToLibrary } from '../lib/materials';
import Icon from './Icon';

/**
 * AddReceiptModal — add a new receipt or edit an existing one.
 *
 * Props:
 *   onClose              () => void
 *   onSave               ({ payload, photoFile }) => Promise  — add mode
 *   existingReceipt      object | undefined  — when present, modal opens in edit mode:
 *                        seeds all fields from the receipt, calls onUpdateReceipt(updatedReceipt)
 *                        on save instead of onSave.
 *   onUpdateReceipt      (updatedReceipt) => void  — required when existingReceipt is provided
 *   onDeleteReceipt      (id) => void|Promise  — edit mode only; when omitted, Delete is hidden
 *   materialsLibrary     Material[] | undefined  — global materials library from AppShell
 *   onMaterialSaved      (savedRow) => void  — callback when a line item is bookmarked
 *
 * confirm state machine:
 *   null       — normal view
 *   'discard'  — user tapped X/Cancel/backdrop while dirty; show "Discard changes?" prompt
 *   'delete'   — user tapped Delete in edit mode; show "Delete this receipt?" prompt
 */
export default function AddReceiptModal({
  onClose,
  onSave,
  existingReceipt,
  onUpdateReceipt,
  onDeleteReceipt,
  materialsLibrary,
  onMaterialSaved,
}) {
  const isEditMode = !!existingReceipt;
  const fileRef = useRef(null);

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  // Seed values captured once at mount — used to compute isDirty.
  const seed = useMemo(() => ({
    photo:         isEditMode ? (existingReceipt.photo || null) : null,
    label:         isEditMode ? (existingReceipt.label || '') : '',
    amount:        isEditMode ? String(existingReceipt.amount ?? '') : '',
    vat:           isEditMode ? String(existingReceipt.vat ?? '') : '',
    items:         isEditMode ? (existingReceipt.items || []) : [],
    receiptDate:   isEditMode ? (existingReceipt.date || todayStr()) : todayStr(),
    invoiceNumber: isEditMode ? (existingReceipt.invoiceNumber || '') : '',
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []); // intentionally empty dep array — seed is fixed at mount

  // ── Field state — ALL hooks must stay above any early return ──────────────
  const [photo, setPhoto]               = useState(seed.photo);
  const [photoFile, setPhotoFile]       = useState(null);
  const [label, setLabel]               = useState(seed.label);
  const [amount, setAmount]             = useState(seed.amount);
  const [vat, setVat]                   = useState(seed.vat);
  const [items, setItems]               = useState(seed.items);
  const [receiptDate, setReceiptDate]   = useState(seed.receiptDate);
  const [invoiceNumber, setInvoiceNumber] = useState(seed.invoiceNumber);
  const [extracting, setExtracting]     = useState(false);
  const [extractError, setExtractError] = useState('');
  const [error, setError]               = useState('');
  const [saving, setSaving]             = useState(false);
  // savedItemIdx: which OCR item row just flashed the bookmark confirm
  const [savedItemIdx, setSavedItemIdx] = useState(-1);
  // confirm: null | 'discard' | 'delete'
  const [confirm, setConfirm]           = useState(null);

  // ── Dirty detection ───────────────────────────────────────────────────────
  const isDirty = (
    photoFile !== null ||
    label !== seed.label ||
    amount !== seed.amount ||
    vat !== seed.vat ||
    receiptDate !== seed.receiptDate ||
    invoiceNumber !== seed.invoiceNumber ||
    JSON.stringify(items) !== JSON.stringify(seed.items)
  );

  // ── Close guard — routes through dirty check ──────────────────────────────
  const requestClose = () => {
    if (isDirty) {
      setConfirm('discard');
    } else {
      onClose();
    }
  };

  const openPicker = () => fileRef.current?.click();

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
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
          if (result.date) setReceiptDate(result.date);
          if (result.invoiceNumber) setInvoiceNumber(result.invoiceNumber);
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

  const saveItemToMaterials = async (idx) => {
    const item = items[idx];
    if (!item?.desc?.trim()) return;
    const result = await saveLineItemToLibrary(
      { desc: item.desc, buyPrice: item.cost || 0 },
      Array.isArray(materialsLibrary) ? materialsLibrary : []
    );
    if (result) {
      onMaterialSaved?.(result.saved);
      setSavedItemIdx(idx);
      setTimeout(() => setSavedItemIdx(-1), 1800);
    }
  };

  const save = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt)) { setError('Amount required'); return; }
    const vatNum = vat === '' ? 0 : parseFloat(vat);
    setSaving(true);
    setError('');
    try {
      const d = new Date();
      const dateISO = receiptDate || `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      if (isEditMode) {
        const updatedReceipt = {
          ...existingReceipt,
          label: label.trim() || 'Receipt',
          amount: amt,
          vat: isNaN(vatNum) ? 0 : vatNum,
          items: items.filter(i => i.desc?.trim()),
          invoiceNumber: invoiceNumber.trim() || null,
          date: dateISO,
          ...(photoFile ? { photo } : {}),
        };
        onUpdateReceipt(updatedReceipt);
        setSaving(false); // guard against future async drift — modal normally unmounts here
      } else {
        await onSave({
          payload: {
            id: Date.now(),
            label: label.trim() || 'Receipt',
            amount: amt,
            vat: isNaN(vatNum) ? 0 : vatNum,
            items: items.filter(i => i.desc?.trim()),
            invoiceNumber: invoiceNumber.trim() || null,
            photo,
            date: dateISO,
            createdAt: new Date().toISOString(),
          },
          photoFile,
        });
      }
    } catch (e) {
      setError(e?.message || 'Save failed — check connection');
      setSaving(false);
    }
  };

  // ── Confirm: discard ──────────────────────────────────────────────────────
  if (confirm === 'discard') {
    return (
      <div className="modal-backdrop" onClick={() => setConfirm(null)}>
        <div className="modal modal-tall arm-confirm" onClick={e => e.stopPropagation()}>
          <div className="arm-confirm__body">
            <p className="arm-confirm__title">Discard changes?</p>
            <p className="arm-confirm__sub">Your edits will be lost.</p>
          </div>
          <div className="arm-confirm__actions">
            {/* autoFocus moves keyboard/screen-reader focus to the safe action on reveal (WCAG 2.4.3) */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirm(null)}
              autoFocus
            >
              Keep editing
            </button>
            <button
              type="button"
              className="btn-danger-filled"
              onClick={onClose}
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Confirm: delete ───────────────────────────────────────────────────────
  if (confirm === 'delete') {
    const handleConfirmDelete = async () => {
      try {
        await onDeleteReceipt?.(existingReceipt.id);
        onClose();
      } catch {
        // The parent (JobDetailDrawer) shows its own flash on failure.
        // Return the modal to the main edit view so the user isn't stranded.
        setConfirm(null);
      }
    };
    return (
      <div className="modal-backdrop" onClick={() => setConfirm(null)}>
        <div className="modal modal-tall arm-confirm" onClick={e => e.stopPropagation()}>
          <div className="arm-confirm__body">
            <p className="arm-confirm__title">Delete this receipt?</p>
            <p className="arm-confirm__sub">The receipt and its photo will be permanently removed. This can&apos;t be undone.</p>
          </div>
          <div className="arm-confirm__actions">
            {/* autoFocus moves keyboard/screen-reader focus to the safe action on reveal (WCAG 2.4.3) */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirm(null)}
              autoFocus
            >
              Keep
            </button>
            <button
              type="button"
              className="btn-danger-filled"
              onClick={handleConfirmDelete}
            >
              Delete receipt
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal view ───────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop" onClick={requestClose}>
      {/*
        IMPORTANT: Do NOT wrap .modal-body-scroll in overflow:hidden —
        iOS position:sticky requires an ancestor with overflow:auto/scroll,
        which is .modal-tall itself. Wrapping in overflow:hidden breaks sticky.
      */}
      <div className="modal modal-tall arm-modal" onClick={e => e.stopPropagation()}>

        {/* ── Sticky header ──────────────────────────────────────────────── */}
        <div className="arm-header">
          <h3 className="arm-header__title">
            {isEditMode ? 'Edit receipt' : 'Add receipt'}
          </h3>
          <button
            type="button"
            className="arm-header__close"
            aria-label="Close"
            onClick={requestClose}
          >
            ×
          </button>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────────── */}
        <div className="arm-body">
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
            <div className="field-row">
              <label style={{ flex: 1 }}>
                <span>Date</span>
                <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
              </label>
              <label style={{ flex: 1 }}>
                <span>Invoice no.</span>
                <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="optional" />
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
                    {/* Bookmark — saves this OCR line to the materials library at buy price */}
                    <button
                      className={`receipt-item-bookmark${savedItemIdx === i ? ' receipt-item-bookmark--saved' : ''}`}
                      type="button"
                      onClick={() => saveItemToMaterials(i)}
                      title="Save to my materials"
                      aria-label="Save to my materials"
                    >
                      {savedItemIdx === i
                        ? <Icon name="check" size={14} variant="success" />
                        : <Icon name="star"  size={14} variant="muted"   />
                      }
                    </button>
                    <button className="receipt-item-x" onClick={() => removeItem(i)} title="Remove">×</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="modal-error">{error}</p>}
        </div>

        {/* ── Sticky footer ──────────────────────────────────────────────── */}
        <div className="arm-footer">
          {/* Edit mode: [Delete (text-danger)] [Cancel] [Save changes] */}
          {/* Add mode:  [Cancel] [Save receipt]                        */}
          {isEditMode && onDeleteReceipt && (
            <button
              type="button"
              className="btn-secondary arm-footer__delete"
              onClick={() => setConfirm('delete')}
              disabled={saving}
            >
              Delete
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={requestClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={extracting || saving}
          >
            {saving ? 'Saving…' : isEditMode ? 'Save changes' : 'Save receipt'}
          </button>
        </div>

      </div>
    </div>
  );
}
