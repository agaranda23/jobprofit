/**
 * jobPhotos.js — pure helpers for job-level photo entries.
 *
 * Photos are stored in the private `job-photos` bucket (Alan confirmed: private,
 * matching the `receipts` bucket pattern). All reads require signed URLs.
 *
 * Photo entry format in meta.photos[]:
 *   New (bucket): { path: '<uid>/<jobId>/<ts>-<filename>', uploadedAt: '<ISO>', caption?: string }
 *   Legacy:       '<data:image/jpeg;base64,...>'  (plain string)
 *
 * Both formats coexist in the array — no migration of legacy entries is planned.
 * Use isLegacyPhoto() to branch rendering logic.
 *
 * caption is an optional additive field on new-format entries. Legacy string
 * entries cannot carry captions (they have no wrapper object).
 *
 * Ordering: array order in meta.photos[] is the display order. Reordering is
 * a pure array mutation — no storage operation needed.
 *
 * Storage operations (upload, signed URL) live in store.js alongside all other
 * Supabase calls. Import them from there directly:
 *   import { uploadJobPhoto, getSignedPhotoUrl } from './store.js';
 */

/**
 * Returns true when a photos array entry is a legacy base64 data-URL string.
 * Returns false when it is the new { path, uploadedAt } object format.
 *
 * @param {string|object} entry
 * @returns {boolean}
 */
export function isLegacyPhoto(entry) {
  return typeof entry === 'string';
}

/**
 * Converts a base64 data-URL string to a Blob.
 * Used before uploading a compressed dataURL to Supabase storage.
 *
 * @param {string} dataUrl – e.g. "data:image/jpeg;base64,/9j/..."
 * @returns {Blob}
 */
export function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * Builds a new photo entry object for the meta.photos array.
 * Wraps the storage path with an uploadedAt timestamp and optional caption.
 *
 * @param {string} storagePath – path returned by uploadJobPhoto
 * @param {string} [caption]   – optional user-written caption
 * @returns {{ path: string, uploadedAt: string, caption?: string }}
 */
export function makePhotoEntry(storagePath, caption) {
  const entry = { path: storagePath, uploadedAt: new Date().toISOString() };
  if (caption && caption.trim()) entry.caption = caption.trim();
  return entry;
}

/**
 * Returns true when the entry supports captions (i.e. is a new-format object).
 * Legacy base64 string entries cannot carry captions.
 *
 * @param {string|object} entry
 * @returns {boolean}
 */
export function canHaveCaption(entry) {
  return !isLegacyPhoto(entry);
}

/**
 * Returns the caption for a photo entry, or '' when none is set.
 *
 * @param {string|object} entry
 * @returns {string}
 */
export function getCaption(entry) {
  if (isLegacyPhoto(entry)) return '';
  return entry.caption || '';
}

/**
 * Returns a new entry with the caption set (or removed when caption is blank).
 * Safe to call on legacy entries — returns the entry unchanged.
 *
 * @param {string|object} entry
 * @param {string} caption
 * @returns {string|object}
 */
export function setCaption(entry, caption) {
  if (isLegacyPhoto(entry)) return entry;
  const trimmed = (caption || '').trim();
  if (trimmed) return { ...entry, caption: trimmed };
  const { caption: _dropped, ...rest } = entry;
  return rest;
}

/**
 * Moves item at `fromIdx` to `toIdx` in the photos array.
 * Returns a new array — does not mutate the original.
 * No-op when either index is out of bounds.
 *
 * @param {Array} photos
 * @param {number} fromIdx
 * @param {number} toIdx
 * @returns {Array}
 */
export function reorderPhotos(photos, fromIdx, toIdx) {
  if (!Array.isArray(photos)) return photos;
  if (fromIdx === toIdx) return photos;
  if (fromIdx < 0 || fromIdx >= photos.length) return photos;
  if (toIdx < 0 || toIdx >= photos.length) return photos;
  const next = [...photos];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}
