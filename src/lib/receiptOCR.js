// Send a receipt photo (data URL) to the Netlify AI proxy for extraction.
// Returns { merchant, total, vat, items, date } with nulls where data isn't found.

export async function extractReceipt(photoDataUrl) {
  if (!photoDataUrl) return null;

  const m = photoDataUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if (!m) return null;
  const mediaType = m[1];
  const base64 = m[2];

  try {
    const res = await fetch('/.netlify/functions/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: `You read UK trade receipts. Extract the data and respond ONLY with valid JSON, no preamble.

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
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content || []).find(b => b.type === 'text');
    if (!block?.text) return null;

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
    console.warn('Receipt OCR failed', e);
    return null;
  }
}
