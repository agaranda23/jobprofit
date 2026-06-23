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
 * Returns true when a PNG data-URL contains meaningful (non-trivial) alpha.
 *
 * Draws the image into an offscreen canvas and samples the alpha channel.
 * "Meaningful" means at least one pixel has alpha < 250 (i.e. not fully opaque).
 * Non-PNG inputs are treated as opaque (return false).
 *
 * @param {string} dataUrl
 * @returns {Promise<boolean>}
 */
function hasMeaningfulAlpha(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl.startsWith('data:image/png')) {
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      // Sample at a capped resolution to keep this fast
      const MAX = 256;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 250) { resolve(true); return; }
      }
      resolve(false);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

/**
 * Downscales a logo data-URL so its longest edge is ≤ maxEdge pixels,
 * then re-encodes as JPEG (quality q) on a white background.
 *
 * Transparency guard: if the source is a PNG with meaningful alpha, the
 * image is flattened onto white before JPEG encoding (safe because the PDF
 * header background is white). The result is always JPEG — smaller and
 * sufficient for a small header logo.
 *
 * Non-image or already-small inputs are passed through as-is when both
 * dimensions are already ≤ maxEdge AND the source is already JPEG.
 *
 * @param {string}  dataUrl  – any browser-decodable image data-URL
 * @param {number}  maxEdge  – longest edge cap in pixels (default 600)
 * @param {number}  q        – JPEG quality 0–1 (default 0.85)
 * @returns {Promise<{ dataUrl: string, format: 'JPEG' }>}
 */
export async function downscaleDataUrl(dataUrl, maxEdge = 600, q = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;

      // Scale so longest edge ≤ maxEdge
      const longest = Math.max(w, h);
      if (longest > maxEdge) {
        const ratio = maxEdge / longest;
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // White background — ensures transparent PNGs are flattened cleanly
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      resolve({ dataUrl: canvas.toDataURL('image/jpeg', q), format: 'JPEG' });
    };
    img.onerror = () => {
      // Decode failed — return the original unchanged so the caller can decide
      resolve({ dataUrl, format: dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG' });
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
