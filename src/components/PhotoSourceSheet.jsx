import { useRef, useEffect } from 'react';
import Icon from './Icon';

/**
 * PhotoSourceSheet — bottom action sheet that asks the user whether to take
 * a new photo or pick from their gallery.
 *
 * Shared by AddReceiptModal and JobDetailDrawer.  Depends only on Icon and the
 * global .photo-source-* CSS classes (index.css ~15199), so it is leaf-level
 * with no circular-dependency risk.
 *
 * Props:
 *   open        – boolean; controlled by parent
 *   onTakePhoto  – callback: close sheet then click the camera input
 *   onUploadPhoto – callback: close sheet then click the gallery input
 *   onClose     – callback: close with no action (Cancel, backdrop, Escape)
 *   triggerRef  – ref to the Add/Change-photo button; focus returned on close
 */
export default function PhotoSourceSheet({ open, onTakePhoto, onUploadPhoto, onClose, triggerRef }) {
  const firstRowRef = useRef(null);

  // Focus first row on open; return focus to trigger on close
  useEffect(() => {
    if (open) {
      // rAF ensures the sheet is in the DOM before we focus
      const id = requestAnimationFrame(() => { firstRowRef.current?.focus(); });
      return () => cancelAnimationFrame(id);
    } else {
      triggerRef?.current?.focus();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="photo-source-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Add photo — choose source"
      onClick={onClose}
    >
      <div
        className="photo-source-sheet"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          ref={firstRowRef}
          className="photo-source-row"
          onClick={onTakePhoto}
        >
          <span className="photo-source-icon"><Icon name="camera" size={20} variant="muted" /></span>
          Take photo
        </button>
        <button
          type="button"
          className="photo-source-row"
          onClick={onUploadPhoto}
        >
          <span className="photo-source-icon"><Icon name="photos" size={20} variant="muted" /></span>
          Upload from photos
        </button>
        <button
          type="button"
          className="photo-source-row photo-source-row--cancel"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
