/**
 * AddMaterialModal — manual add or edit a material in the library.
 *
 * Used from:
 *   a) MaterialsScreen "Add an item" CTA  (add mode: no existingMaterial prop)
 *   b) MaterialsScreen row tap            (edit mode: existingMaterial prop set)
 *
 * In add mode:   calls onSave({ desc, cost, unit, supplier_code, supplier, vat_rate })
 * In edit mode:  calls onSave(mergedPayload) with the same shape, patching the row.
 *
 * Props:
 *   onClose           () => void
 *   onSave            (payload) => Promise<void>
 *   existingMaterial  object | undefined
 *   defaultMarkup     number — profile default, shown as hint only
 */

import { useState } from 'react';
import Icon from './Icon';

export default function AddMaterialModal({
  onClose,
  onSave,
  existingMaterial,
  defaultMarkup = 20,
}) {
  const isEdit = !!existingMaterial;

  const [desc, setDesc]           = useState(existingMaterial?.desc ?? '');
  const [cost, setCost]           = useState(
    existingMaterial?.cost != null ? String(existingMaterial.cost) : ''
  );
  const [unit, setUnit]           = useState(existingMaterial?.unit ?? '');
  const [supplierCode, setSupplierCode] = useState(existingMaterial?.supplier_code ?? '');
  const [supplier, setSupplier]   = useState(existingMaterial?.supplier ?? '');
  const [markup, setMarkup]       = useState(
    existingMaterial?.default_markup != null ? String(existingMaterial.default_markup) : ''
  );
  const [error, setError]         = useState('');
  const [saving, setSaving]       = useState(false);

  const handleSave = async () => {
    const trimDesc = desc.trim();
    if (!trimDesc) { setError('Description is required'); return; }
    const buyPrice = parseFloat(cost);
    if (isNaN(buyPrice) || buyPrice < 0) { setError('Enter a valid buy price'); return; }

    setError('');
    setSaving(true);
    try {
      const parsedMarkup = markup.trim() ? parseFloat(markup) : null;
      await onSave({
        ...(isEdit ? { id: existingMaterial.id } : {}),
        desc:           trimDesc,
        cost:           buyPrice,
        unit:           unit.trim() || null,
        supplier_code:  supplierCode.trim() || null,
        supplier:       supplier.trim() || null,
        default_markup: parsedMarkup != null && !isNaN(parsedMarkup) ? parsedMarkup : null,
        vat_rate:       0.20,
      });
    } catch (e) {
      setError(e?.message || 'Save failed — check connection');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-tall" onClick={e => e.stopPropagation()}>
        <div className="aj-header">
          <h3 className="modal-title">{isEdit ? 'Edit material' : 'Add material'}</h3>
          <button className="aj-close-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="modal-fields">
          <label>
            <span>Description</span>
            <input
              type="text"
              value={desc}
              onChange={e => { setDesc(e.target.value); setError(''); }}
              placeholder="e.g. Copper pipe 22mm"
              autoFocus={!isEdit}
            />
          </label>

          <div className="field-row">
            <label style={{ flex: 2 }}>
              <span>Buy price (ex-VAT)</span>
              <div className="aj-micro-amount-wrap aj-micro-amount-wrap--inline">
                <span className="aj-micro-currency">£</span>
                <input
                  type="number"
                  inputMode="decimal"
                  className="aj-micro-amount aj-micro-amount--inline"
                  value={cost}
                  onChange={e => { setCost(e.target.value); setError(''); }}
                  placeholder="0.00"
                  aria-label="Buy price in pounds ex-VAT"
                />
              </div>
            </label>
            <label style={{ flex: 1 }}>
              <span>Unit (optional)</span>
              <input
                type="text"
                value={unit}
                onChange={e => setUnit(e.target.value)}
                placeholder="each"
              />
            </label>
          </div>

          <label>
            <span>Markup % on this item (optional)</span>
            <input
              type="number"
              inputMode="decimal"
              value={markup}
              onChange={e => setMarkup(e.target.value)}
              placeholder={`${defaultMarkup} (your standard)`}
              aria-label="Markup percentage override for this item"
            />
          </label>
          <p className="modal-help" style={{ marginTop: -8 }}>
            Leave blank to use your standard {defaultMarkup}%
          </p>

          <label>
            <span>Supplier code (optional)</span>
            <input
              type="text"
              value={supplierCode}
              onChange={e => setSupplierCode(e.target.value)}
              placeholder="SFX-123456"
              autoCapitalize="characters"
            />
          </label>

          <label>
            <span>Supplier (optional)</span>
            <input
              type="text"
              value={supplier}
              onChange={e => setSupplier(e.target.value)}
              placeholder="Screwfix"
            />
          </label>
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save material'}
          </button>
        </div>
      </div>
    </div>
  );
}
