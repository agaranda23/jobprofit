/**
 * LogoModal — logo upload / paste-URL editor.
 *
 * Extracted from SettingsScreen.jsx (was a private, unexported component) so
 * DocumentPreview's tappable "Add your logo" region (Preview & Edit slice 1)
 * can open the exact same editor Settings uses — no second logo-upload
 * implementation.
 *
 * Two input paths:
 *   A) Upload image  — file input → Supabase Storage (logos bucket) → public URL
 *   B) Paste a URL   — text input → saved directly as logo_url
 *
 * On any save failure the modal stays open and shows the error inline.
 * On success it closes and the save-toast fires in the caller (via onSave).
 *
 * Props:
 *   currentUrl  string        — existing profile.logo_url, or ''
 *   userId      string        — auth user id, used for the Storage upload path
 *   onSave      async (patch: { logo_url: string|null }) => void
 *   onClose     () => void
 */
import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { secureImageUrl } from '../lib/secureImageUrl.js';
import Icon from './Icon.jsx';

const LOGOS_BUCKET = 'logos';
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — matches bucket file_size_limit

export default function LogoModal({ currentUrl, userId, onSave, onClose }) {
  const fileInputRef = useRef(null);
  const [urlValue, setUrlValue]   = useState(currentUrl || '');
  const [preview, setPreview]     = useState(currentUrl || '');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState('');
  const [error, setError]         = useState('');
  const [tab, setTab]             = useState('upload'); // 'upload' | 'url'

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    if (!file.type.startsWith('image/')) {
      setError('Please pick an image file (JPEG, PNG, WebP…)');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`);
      return;
    }

    if (!userId) {
      setError('Not signed in — please sign out and back in then try again.');
      return;
    }

    setUploading(true);
    setProgress('Uploading…');

    try {
      const ext      = file.name.split('.').pop().toLowerCase() || 'jpg';
      const filename = `logo-${Date.now()}.${ext}`;
      const path     = `${userId}/${filename}`;

      const { error: uploadErr } = await supabase.storage
        .from(LOGOS_BUCKET)
        .upload(path, file, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from(LOGOS_BUCKET)
        .getPublicUrl(path);

      const publicUrl = urlData?.publicUrl;
      if (!publicUrl) throw new Error('Could not get public URL after upload');

      setProgress('Saving…');
      await onSave({ logo_url: publicUrl });
      // onSave resolves → caller shows the toast and closes this modal
    } catch (err) {
      setError(err?.message || 'Upload failed — try again');
      setUploading(false);
      setProgress('');
    }
  };

  const handleUrlSave = async () => {
    setError('');
    const trimmed = urlValue.trim();

    if (!trimmed) {
      setUploading(true);
      setProgress('Saving…');
      try {
        await onSave({ logo_url: null });
      } catch (err) {
        setError(err?.message || 'Could not save — try again');
        setUploading(false);
        setProgress('');
      }
      return;
    }

    // Auto-upgrade a bare http:// paste to https:// — never store an
    // http:// logo_url again, or it renders as mixed content on every
    // https page that shows this logo (including public customer-facing
    // quote/invoice/receipt pages).
    const secured = secureImageUrl(trimmed);
    if (!/^(https:\/\/|\/\/|data:)/i.test(secured)) {
      setError('Enter a valid image URL starting with https://');
      return;
    }

    setUploading(true);
    setProgress('Saving…');
    try {
      await onSave({ logo_url: secured });
    } catch (err) {
      setError(err?.message || 'Could not save — try again');
      setUploading(false);
      setProgress('');
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Logo"
      onClick={e => { if (e.target === e.currentTarget && !uploading) onClose(); }}
    >
      <div
        className="modal-sheet edit-field-sheet logo-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">Logo</h3>
          <button
            className="modal-sheet-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
            disabled={uploading}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Current logo preview */}
        {preview && (
          <div className="logo-modal__preview">
            <img
              src={secureImageUrl(preview)}
              alt="Current logo"
              className="logo-modal__img"
              onError={() => setPreview('')}
            />
          </div>
        )}

        {/* Tab switcher */}
        <div className="logo-modal__tabs work-segments" role="group" aria-label="Logo input method">
          <button
            type="button"
            className={`work-segment${tab === 'upload' ? ' work-segment--active' : ''}`}
            onClick={() => { setTab('upload'); setError(''); }}
            disabled={uploading}
          >
            Upload image
          </button>
          <button
            type="button"
            className={`work-segment${tab === 'url' ? ' work-segment--active' : ''}`}
            onClick={() => { setTab('url'); setError(''); }}
            disabled={uploading}
          >
            Paste URL
          </button>
        </div>

        <div className="edit-field-body">
          {tab === 'upload' ? (
            <>
              <p className="edit-field-help">
                Pick an image from your phone (JPEG, PNG or WebP, max 2 MB).
              </p>
              {/* Hidden real file input — triggered by the button below */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="logo-modal__file-input"
                aria-hidden="true"
                tabIndex={-1}
                onChange={handleFileChange}
                disabled={uploading}
              />
              <button
                type="button"
                className="btn-primary logo-modal__pick-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? progress : 'Choose image'}
              </button>
            </>
          ) : (
            <>
              <div className="edit-field-group">
                <label className="edit-field-label" htmlFor="logo-url-input">
                  Image URL
                </label>
                <input
                  id="logo-url-input"
                  type="url"
                  inputMode="url"
                  className="edit-field-input"
                  value={urlValue}
                  placeholder="https://yourdomain.com/logo.png"
                  onChange={e => { setUrlValue(e.target.value); setPreview(e.target.value); setError(''); }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={uploading}
                />
                <span className="edit-field-help">Paste a public image URL.</span>
              </div>
            </>
          )}

          {error && (
            <p className="edit-field-save-error" role="alert">{error}</p>
          )}
        </div>

        {tab === 'url' && (
          <div className="edit-field-actions">
            <button
              type="button"
              className="btn-ghost edit-field-cancel"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary edit-field-save"
              onClick={handleUrlSave}
              disabled={uploading}
            >
              {uploading ? progress : 'Save'}
            </button>
          </div>
        )}
        {tab === 'upload' && (
          <div className="edit-field-actions">
            <button
              type="button"
              className="btn-ghost edit-field-cancel"
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
