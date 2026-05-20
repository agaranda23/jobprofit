/**
 * jobPhotos.js — pure helpers for job-level photo entries.
 *
 * Photos are stored in the private `job-photos` bucket (Alan confirmed: private,
 * matching the `receipts` bucket pattern). All reads require signed URLs.
 *
 * Photo entry format in meta.photos[]:
 *   New (bucket): { path: '<uid>/<jobId>/<ts>-<filename>', uploadedAt: '<ISO>' }
 *   Legacy:       '<data:image/jpeg;base64,...>'  (plain string)
 *
 * Both formats coexist in the array — no migration of legacy entries is planned.
 * Use isLegacyPhoto() to branch rendering logic.
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
 * Wraps the storage path with an uploadedAt timestamp.
 *
 * @param {string} storagePath – path returned by uploadJobPhoto
 * @returns {{ path: string, uploadedAt: string }}
 */
export function makePhotoEntry(storagePath) {
  return { path: storagePath, uploadedAt: new Date().toISOString() };
}
