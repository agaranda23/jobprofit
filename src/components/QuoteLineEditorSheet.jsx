/**
 * QuoteLineEditorSheet — bottom sheet for adding or editing a single quote/invoice
 * line item (description + amount).
 *
 * Extracted from JobDetailDrawer.jsx (was a private, unexported component used
 * only by QuoteBreakdownSection's Price accordion) so DocumentPreview's tappable
 * line-item rows (Preview & Edit — full-tap slice) can open the exact same
 * editor the job-edit drawer uses — no second line-item editor implementation.
 *
 * Reuses .modal-backdrop + .modal-sheet + .edit-field-* styles shared with
 * EditFieldModal/LogoModal.
 *
 * Props:
 *   open      boolean
 *   item      { desc, cost } | null   — null means "add a new line"
 *   onSave    ({ desc, cost }) => void
 *   onDelete  () => void | undefined  — omit to hide the Delete button (e.g. new line)
 *   onCancel  () => void
 */
import { useState, useEffect } from 'react';

export default function QuoteLineEditorSheet({ open, item, onSave, onDelete, onCancel }) {
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState('');

  // Resets the local form fields whenever the sheet opens targeting a
  // (possibly different) item — pre-existing pattern, unchanged from before
  // this component was extracted from JobDetailDrawer.jsx. Intentional: this
  // is a one-shot reset gated on `open`, not a render-loop risk.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDesc(item?.desc || '');
      // Present empty (not '0') when cost is 0 so the user does not have to
      // clear the field — matches the EditFieldModal pattern for needsPrice jobs.
      setCost(item != null && Number(item.cost) !== 0 ? String(item.cost ?? '') : '');
    }
  }, [open, item]);

  if (!open) return null;

  const parsedCost = parseFloat(cost) || 0;
  const canSave = desc.trim().length > 0 || parsedCost > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ desc: desc.trim(), cost: parsedCost });
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={item ? 'Edit line item' : 'Add line item'}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal-sheet edit-field-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">{item ? 'Edit line' : 'Add a line'}</h3>
          <button type="button" className="modal-sheet-close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <div className="edit-field-body">
          <div className="edit-field-group">
            <label className="edit-field-label">Description</label>
            <input
              type="text"
              className="edit-field-input"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="e.g. Labour, Materials, Skip hire"
              aria-label="Line item description"
              autoFocus
              maxLength={200}
            />
          </div>
          <div className="edit-field-group">
            <label className="edit-field-label">Amount (£)</label>
            <input
              type="number"
              className="edit-field-input"
              value={cost}
              onChange={e => setCost(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              aria-label="Line item amount"
              inputMode="decimal"
            />
          </div>
          <div className="edit-field-actions">
            {item && onDelete && (
              <button type="button" className="btn-ghost btn-ghost--danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
                Delete
              </button>
            )}
            <button type="button" className="btn-ghost edit-field-cancel" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-primary edit-field-save" onClick={handleSave} disabled={!canSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
