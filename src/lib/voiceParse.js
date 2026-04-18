// Parse "Kitchen job Sarah £380 cash" via the Netlify AI proxy.
// Falls back to regex if unreachable.

export async function parseJobFromSpeech(transcript) {
  const text = (transcript || '').trim();
  if (!text) return { name: '', amount: null, paymentType: null };

  try {
    const res = await fetch('/.netlify/functions/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 160,
        system: 'Extract a job name, amount in GBP, and optional payment type from the transcript. Respond ONLY with JSON: {"name": string, "amount": number, "paymentType": "cash"|"bank transfer"|"card"|"cheque"|null}. Amount must be a number in pounds (no symbol). If no amount, set amount to null. If payment type not mentioned, set to null.',
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const block = (data.content || []).find(b => b.type === 'text');
      if (block?.text) {
        const clean = block.text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return {
          name: parsed.name || regexName(text),
          amount: parsed.amount ?? regexAmount(text),
          paymentType: parsed.paymentType ?? regexPayment(text),
        };
      }
    }
  } catch {}

  return {
    name: regexName(text),
    amount: regexAmount(text),
    paymentType: regexPayment(text),
  };
}

function regexAmount(text) {
  const m = text.match(/£?\s*([\d,]+(?:\.\d+)?)\s*(k|pounds?|quid)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2] && /^k$/i.test(m[2])) n *= 1000;
  return isNaN(n) ? null : n;
}

function regexName(text) {
  return text
    .replace(/£?\s*[\d,]+(?:\.\d+)?\s*(k|pounds?|quid)?/gi, '')
    .replace(/\b(cash|bank transfer|card|cheque|check)\b/gi, '')
    .replace(/\b(for|at|cost(s|ing)?|priced|paid|via|by)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function regexPayment(text) {
  const t = text.toLowerCase();
  if (/\bcash\b/.test(t)) return 'cash';
  if (/\bbank (transfer|payment)\b|\btransfer\b|\bbacs\b/.test(t)) return 'bank transfer';
  if (/\bcard\b|\bcredit\b|\bdebit\b/.test(t)) return 'card';
  if (/\bcheque\b|\bcheck\b/.test(t)) return 'cheque';
  return null;
}
