import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { extractReceipt } from '../lib/receiptOCR';
import { saveLineItemToLibrary } from '../lib/materials';
import Icon from './Icon';
import PhotoSourceSheet from './PhotoSourceSheet';
import { meaningfulItemCount, computeItemsSubtotal, itemsDirty } from '../lib/receiptItemsHelpers';

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
  // Ref to track the index of the newest item so we can focus its desc input
  const newItemDescRef = useRef(null);
  const pendingFocusRef = useRef(false);
  // Ref to the expanded Itemise panel — used for scrollIntoView on manual open
  const itemsPanelRef = useRef(null);
  // Photo-source chooser refs — must sit above early returns (rules-of-hooks)
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const addPhotoBtnRef = useRef(null); // focus returned to this when sheet closes

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
  // savedItemIdx: which item row just flashed the bookmark confirm
  const [savedItemIdx, setSavedItemIdx] = useState(-1);
  // confirm: null | 'discard' | 'delete'
  const [confirm, setConfirm]           = useState(null);
  // Phase 2: collapsible Itemise section — collapsed by default (fast-path)
  const [isItemiseOpen, setIsItemiseOpen] = useState(false);
  // Photo-source bottom-sheet — MUST be above early returns (rules-of-hooks)
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);

  // Focus the last item's desc input after a new row is added.
  // Dep array [items] ensures this fires only when the items array changes
  // (i.e. after addItem/removeItem), not on every form keystroke.
  useEffect(() => {
    if (pendingFocusRef.current && newItemDescRef.current) {
      newItemDescRef.current.focus();
      pendingFocusRef.current = false;
    }
  }, [items]);

  // ── Dirty detection ───────────────────────────────────────────────────────
  // Blank-desc rows are stripped before comparing so that opening Itemise +
  // tapping "+ Add item" + closing does NOT pop a spurious "Discard changes?".
  const isDirty = (
    photoFile !== null ||
    label !== seed.label ||
    amount !== seed.amount ||
    vat !== seed.vat ||
    receiptDate !== seed.receiptDate ||
    invoiceNumber !== seed.invoiceNumber ||
    itemsDirty(items, seed.items)
  );

  // ── Close guard — routes through dirty check ──────────────────────────────
  const requestClose = () => {
    if (isDirty) {
      setConfirm('discard');
    } else {
      onClose();
    }
  };

  const openPhotoSheet = () => setPhotoSheetOpen(true);

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
          if (result.items?.length) {
            setItems(result.items);
            // Auto-open so the user sees what OCR read — no auto-scroll
            setIsItemiseOpen(true);
          }
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

  // Store the raw string verbatim for every field — incl. cost. Eager-parsing
  // cost on keystroke made the field un-clearable (parseFloat('')||0 === 0 stuck
  // a "0" in) and blocked decimal entry (parseFloat('1.') === 1). Cost is coerced
  // to a Number only at the boundaries: subtotal, save-to-materials, save payload.
  const updateItem = (idx, field, value) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const addItem = useCallback(() => {
    setIsItemiseOpen(true);
    setItems(prev => [...prev, { desc: '', cost: undefined }]);
    pendingFocusRef.current = true;
  }, []);

  const saveItemToMaterials = async (idx) => {
    const item = items[idx];
    if (!item?.desc?.trim()) return;
    const result = await saveLineItemToLibrary(
      { desc: item.desc, buyPrice: Number(item.cost) || 0 },
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
          // Coerce the raw-string cost back to a Number at the persist boundary
          // (empty/NaN => 0) so on-disk items keep the numeric data contract.
          items: items.filter(i => i.desc?.trim()).map(it => ({ ...it, cost: Number(it.cost) || 0 })),
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
            // Coerce the raw-string cost back to a Number at the persist boundary
            // (empty/NaN => 0) so on-disk items keep the numeric data contract.
            items: items.filter(i => i.desc?.trim()).map(it => ({ ...it, cost: Number(it.cost) || 0 })),
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
              className="btn-secondary arm-confirm__discard"
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

  // ── Derived values for Itemise section ───────────────────────────────────
  const mCount = meaningfulItemCount(items);
  const subtotal = computeItemsSubtotal(items);

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
          {/* Camera input — opens rear camera directly on iOS Safari / Android Chrome */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={onFile}
          />
          {/* Gallery input — opens photo library / file picker (no capture attr) */}
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onFile}
          />

          {!photo ? (
            <>
              <button
                type="button"
                ref={addPhotoBtnRef}
                className="btn-primary btn-large"
                onClick={openPhotoSheet}
              >
                <Icon name="camera" size={16} /> Add photo
              </button>
              <p className="modal-help" style={{ textAlign: 'center', marginTop: 8 }}>
                Take a photo or choose one from your phone
              </p>
            </>
          ) : (
            <>
              <img src={photo} alt="Receipt" className="receipt-preview" />
              <button
                type="button"
                ref={addPhotoBtnRef}
                className="link-btn centered"
                onClick={openPhotoSheet}
              >Change photo</button>
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

          {/* ── Itemise section (Phase 2) ─────────────────────────────────── */}
          <div className="receipt-items">
            {/* Collapse toggle header.
                aria-controls is only set when the panel is in the DOM (expanded),
                so screen readers following the reference always find the target. */}
            <button
              type="button"
              className="receipt-items-toggle"
              aria-expanded={isItemiseOpen}
              aria-controls={isItemiseOpen ? 'receipt-items-panel' : undefined}
              onClick={() => {
                setIsItemiseOpen(o => {
                  const next = !o;
                  // On manual open: scroll panel into view so it isn't hidden
                  // behind the sticky footer on short screens (e.g. iPhone SE).
                  // OCR auto-open deliberately skips this scroll (spec decision).
                  if (next && itemsPanelRef.current) {
                    setTimeout(() => itemsPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
                  }
                  return next;
                });
              }}
            >
              <span className="receipt-items-toggle__label">
                {mCount > 0
                  ? `Items · ${mCount}`
                  : 'Itemise (optional)'}
              </span>
              {/* aria-hidden: hint + chevron are decorative; label span carries the a11y name */}
              <span className={`receipt-items-toggle__chevron${isItemiseOpen ? ' receipt-items-toggle__chevron--open' : ''}`} aria-hidden="true">
                ›
              </span>
            </button>

            {/* Expanded panel */}
            {isItemiseOpen && (
              <div id="receipt-items-panel" ref={itemsPanelRef}>
                {/* Empty-state hint — shown when no meaningful items exist yet,
                    so the user knows what to type even after opening the panel. */}
                {mCount === 0 && (
                  <p className="receipt-items-empty-hint" aria-hidden="true">Add nails, timber, fixings…</p>
                )}
                {items.length > 0 && (
                  <ul className="receipt-items-list">
                    {items.map((it, i) => (
                      <li key={i} className="receipt-item">
                        <input
                          type="text"
                          value={it.desc}
                          onChange={e => updateItem(i, 'desc', e.target.value)}
                          className="receipt-item-desc"
                          placeholder="Item name"
                          // Attach ref to the LAST item so addItem() can focus it
                          ref={i === items.length - 1 ? newItemDescRef : null}
                        />
                        <input
                          type="number"
                          inputMode="decimal"
                          value={it.cost ?? ''}
                          onChange={e => updateItem(i, 'cost', e.target.value)}
                          className="receipt-item-cost"
                          placeholder="0.00"
                        />
                        {/* Bookmark — saves this line to the materials library at buy price */}
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
                        <button
                          className="receipt-item-x"
                          type="button"
                          onClick={() => removeItem(i)}
                          title="Remove item"
                          aria-label="Remove item"
                        >×</button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Add item button */}
                <button
                  type="button"
                  className="receipt-items-add"
                  onClick={addItem}
                >
                  + Add item
                </button>

                {/* Subtotal hint — NOT a roll-up; does not affect Amount.
                    Only shown when there is at least one meaningful item so
                    we never display a misleading "Items add up to £0.00". */}
                {mCount > 0 && (
                  <p className="receipt-items-subtotal">
                    Items add up to £{subtotal.toFixed(2)}
                  </p>
                )}
              </div>
            )}
          </div>

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

      {/* Photo-source chooser — sibling of .modal (inside .modal-backdrop) so its
          own fixed backdrop layers above the modal. PhotoSourceSheet stops click
          propagation on its backdrop, so a backdrop tap dismisses only the sheet
          and never bubbles to .modal-backdrop's requestClose. */}
      <PhotoSourceSheet
        open={photoSheetOpen}
        triggerRef={addPhotoBtnRef}
        onTakePhoto={() => { setPhotoSheetOpen(false); cameraInputRef.current?.click(); }}
        onUploadPhoto={() => { setPhotoSheetOpen(false); galleryInputRef.current?.click(); }}
        onClose={() => setPhotoSheetOpen(false)}
      />
    </div>
  );
}
