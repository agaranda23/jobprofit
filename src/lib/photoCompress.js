/**
 * photoCompress — browser-side image compress to JPEG base64.
 *
 * Extracted verbatim from the App.jsx helpers (lines 58-59 of the monolith).
 * The logic is unchanged; this file exists so JobDetailDrawer can import it
 * without pulling in the whole App.jsx bundle.
 *
 * Usage:
 *   import { compressPhoto } from '../lib/photoCompress';
 *   const dataUrl = await compressPhoto(file);   // → "data:image/jpeg;base64,…"
 */

/**
 * Reads a File/Blob into a base64 data-URL.
 * @param {File} f
 * @returns {Promise<string>}
 */
function fileToB64(f) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });
}

/**
 * Resizes a base64 data-URL to at most `maxWidth` pixels wide, then
 * re-encodes as JPEG at quality `quality` (0–1).
 *
 * @param {string} dataUrl  – input data-URL (any image format the browser can decode)
 * @param {number} maxWidth – default 800 px  (matches legacy App.jsx default)
 * @param {number} quality  – JPEG quality 0–1, default 0.7
 * @returns {Promise<string>} – JPEG data-URL
 */
function compressDataUrl(dataUrl, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round(h * maxWidth / w);
        w = maxWidth;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

/**
 * Full pipeline: File → base64 → resize/compress → JPEG data-URL.
 *
 * @param {File} file
 * @param {{ maxWidth?: number, quality?: number }} [opts]
 * @returns {Promise<string>} JPEG data-URL
 */
export async function compressPhoto(file, { maxWidth = 800, quality = 0.7 } = {}) {
  const raw = await fileToB64(file);
  return compressDataUrl(raw, maxWidth, quality);
}
