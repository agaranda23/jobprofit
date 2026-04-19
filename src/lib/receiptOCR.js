// Send a receipt photo (data URL) to the Netlify AI proxy for extraction.
// Returns { merchant, total, vat, items, date } with nulls where data isn't found.

const MAX_DIM = 1568;            // Anthropic's recommended max image dimension
const TARGET_QUALITY = 0.85;     // JPEG quality for re-encode

async function downsizeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= MAX_DIM && height <= MAX_DIM) {
        resolve(dataUrl);
        return;
      }
      const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', TARGET_QUALITY));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function extractReceipt(photoDataUrl) {
  if (!photoDataUrl) return { error: 'No photo' };

  let processed = photoDataUrl;
  try {
    processed = await downsizeImage(photoDataUrl);
  } catch (e) {
    console.warn('Resize failed, using original', e);
  }

  const m = processed.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if (!m) return { error: 'Bad image format' };
  const mediaType = m[1];
  const base64 = m[2];

  const payload = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 800,
    system: `You read UK trade receipts. Extract the data and respond ONLY with valid JSON, no preamble, no code fences.

Schema: {"merchant": string|null, "total": number|null, "vat": number|null, "date": string|null, "items": [{"desc": string, "cost": number}]}

Rules:
- "total" = gross amount paid in pounds (number, not string, no currency symbol)
- "vat" = VAT amount in pounds if shown separately. Null if not shown or unclear.
- "merchant" = shop name (e.g. "Screwfix", "Toolstation", "B&Q")
- "date" = ISO YYYY-MM-DD if visible, else null
- "items" = each line item with description and cost in pounds. Group similar items if many. Skip subtotal/VAT/total lines.
- If receipt unreadable or not a receipt, return all nulls and empty items array.
- Numbers must be JSON numbers (e.g. 12.50 not "£12.50").`,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Extract the receipt data as JSON.' },
      ],
    }],
  };

  let res;
  try {
    res = await fetch('/.netlify/functions/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { error: 'Network failure: ' + e.message };
  }

  if (!res.ok) {
    return { error: `HTTP ${res.status}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { error: 'Bad JSON response' };
  }

  // Surface API-level errors that come back inside a 200
  if (data.error) {
    console.warn('Anthropic API error:', data.error);
    return { error: data.error.message || JSON.stringify(data.error) };
  }
  if (data.type === 'error') {
    console.warn('Anthropic error:', data);
    return { error: data.error?.message || 'API error' };
  }

  const block = (data.content || []).find(b => b.type === 'text');
  if (!block?.text) {
    return { error: 'No text in response' };
  }

  try {
    const clean = block.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      merchant: parsed.merchant || null,
      total: typeof parsed.total === 'number' ? parsed.total : null,
      vat: typeof parsed.vat === 'number' ? parsed.vat : null,
      date: parsed.date || null,
      items: Array.isArray(parsed.items) ? parsed.items.filter(i => i?.desc) : [],
    };
  } catch (e) {
    console.warn('Parse failed:', block.text);
    return { error: 'Could not parse model output' };
  }
}
