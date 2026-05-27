/**
 * EditFieldModal — single-field edit sheet.
 *
 * Reuses .modal-backdrop + .modal-sheet styles shared with SendInvoiceModal
 * and JobDetailDrawer. Each editable Settings row opens one instance of this.
 *
 * For composite fields (Name = first+last, Bank = 3 fields) the caller passes
 * fields[] instead of fieldKey+fieldLabel — see prop docs below.
 *
 * Props (single-field mode):
 *   open          boolean
 *   fieldKey      string        e.g. 'business_name'
 *   fieldLabel    string        e.g. "Business name"
 *   currentValue  string|number
 *   inputType     'text'|'number'|'textarea'   default 'text'
 *   rows          number        textarea row count — default 4, only used when inputType='textarea'
 *   placeholder   string
 *   helpText      string        caption below input
 *   validate      (value) => string|null
 *   formatOnBlur  (value) => value
 *   onSave        async (patch: Record<string,string|number>) => void
 *   onClose       () => void
 *
 * Composite mode — pass instead of the single-field props:
 *   title         string        modal header text
 *   fields        Array<{
 *                   key, label, value, inputType?,
 *                   placeholder?, helpText?, validate?, formatOnBlur?, rows?
 *                 }>
 */
import { useEffect, useRef, useState } from 'react';

// ── Single field state row inside the modal ───────────────────────────────

function FieldRow({ field, value, onChange, error }) {
  const inputRef = useRef(null);

  // On mount, focus the first field and place cursor at end
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      const len = String(value || '').length;
      // setSelectionRange not supported on all input types — ignore if it throws
      try { inputRef.current.setSelectionRange(len, len); } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sharedProps = {
    ref: inputRef,
    id: `ef-${field.key}`,
    className: `edit-field-input${error ? ' edit-field-input--error' : ''}`,
    value,
    placeholder: field.placeholder || '',
    onChange: e => onChange(field.key, e.target.value),
    onBlur: e => {
      if (field.formatOnBlur) {
        onChange(field.key, field.formatOnBlur(e.target.value));
      }
    },
    autoComplete: 'off',
    autoCorrect: 'off',
    spellCheck: false,
  };

  return (
    <div className="edit-field-group">
      <label className="edit-field-label" htmlFor={`ef-${field.key}`}>
        {field.label}
      </label>
      {field.inputType === 'textarea' ? (
        <textarea
          {...sharedProps}
          className={`edit-field-input edit-field-textarea${error ? ' edit-field-input--error' : ''}`}
          rows={field.rows || 4}
          autoCapitalize="sentences"
        />
      ) : (
        <input
          {...sharedProps}
          type={field.inputType === 'number' ? 'text' : 'text'}
          inputMode={
            field.inputType === 'number' ? 'numeric' :
            field.inputType === 'tel' ? 'tel' :
            field.inputType === 'email' ? 'email' :
            'text'
          }
          autoCapitalize={
            field.inputType === 'number' || field.inputType === 'tel' || field.inputType === 'email'
              ? 'none'
              : 'words'
          }
        />
      )}
      {error && <span className="edit-field-error">{error}</span>}
      {field.helpText && !error && (
        <span className="edit-field-help">{field.helpText}</span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function EditFieldModal({
  open,
  // single-field mode
  fieldKey,
  fieldLabel,
  currentValue = '',
  inputType = 'text',
  rows,
  placeholder,
  helpText,
  validate,
  formatOnBlur,
  // composite mode
  title,
  fields,
  // shared
  onSave,
  onClose,
}) {
  // Normalise to composite shape internally — simpler logic below.
  const isComposite = Array.isArray(fields) && fields.length > 0;
  const normFields = isComposite
    ? fields
    : [{
        key: fieldKey,
        label: fieldLabel,
        value: currentValue,
        inputType,
        rows,
        placeholder,
        helpText,
        validate,
        formatOnBlur,
      }];

  // values: { [key]: string }
  const [values, setValues] = useState(() =>
    Object.fromEntries(normFields.map(f => [f.key, String(f.value ?? '')]))
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  // Reset state whenever the modal opens with new initial values
  useEffect(() => {
    if (open) {
      setValues(Object.fromEntries(normFields.map(f => [f.key, String(f.value ?? '')])));
      setErrors({});
      setSaveError('');
      setSaved(false);
      setSaving(false);
    }
    // normFields identity changes every render, so depend on open + a stable key
    // built from the field keys + values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleChange = (key, val) => {
    setValues(prev => ({ ...prev, [key]: val }));
    // Clear field error on type
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }));
    setSaveError('');
    setSaved(false);
  };

  const isDirty = normFields.some(
    f => values[f.key] !== String(f.value ?? '')
  );

  const runValidation = () => {
    const errs = {};
    for (const f of normFields) {
      if (f.validate) {
        const msg = f.validate(values[f.key]);
        if (msg) errs[f.key] = msg;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!isDirty || saving) return;
    if (!runValidation()) return;

    setSaving(true);
    setSaveError('');
    try {
      const patch = Object.fromEntries(
        normFields.map(f => [f.key, values[f.key]])
      );
      await onSave(patch);
      setSaved(true);
      // Brief "Saved" flash before closing
      setTimeout(onClose, 600);
    } catch (err) {
      setSaveError(err?.message || 'Could not save — try again');
    } finally {
      setSaving(false);
    }
  };

  const modalTitle = title || (isComposite ? 'Edit' : fieldLabel);

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${modalTitle}`}
    >
      <div className="modal-sheet edit-field-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">{modalTitle}</h3>
          <button
            className="modal-sheet-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="edit-field-body">
          {normFields.map(f => (
            <FieldRow
              key={f.key}
              field={f}
              value={values[f.key]}
              onChange={handleChange}
              error={errors[f.key]}
            />
          ))}

          {saveError && (
            <p className="edit-field-save-error" role="alert">{saveError}</p>
          )}
        </div>

        <div className="edit-field-actions">
          <button
            type="button"
            className="btn-ghost edit-field-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn-primary edit-field-save${saved ? ' edit-field-save--saved' : ''}`}
            onClick={handleSave}
            disabled={!isDirty || saving}
          >
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
