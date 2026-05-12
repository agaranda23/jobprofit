// Parse "Kitchen job Sarah £380 cash" via the Netlify AI proxy.
// Falls back to regex if unreachable.

export async function parseJobFromSpeech(transcript) {
  const text = (transcript || '').trim();
  if (!text) return { name: '', customer: null, amount: null, paymentType: null };

  try {
    const res = await fetch('/.netlify/functions/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 160,
        system: 'Extract a job name, customer name (only if explicitly named), amount in GBP, and optional payment type from the transcript. Respond ONLY with JSON: {"name": string, "customer": string|null, "amount": number|null, "paymentType": "cash"|"bank transfer"|"card"|"cheque"|null}.\n\nRules:\n- name: the job description (e.g. "Kitchen renovation", "Bathroom refit", "Plastering"). NOT the customer name.\n- customer: a person\'s name if EXPLICITLY mentioned (e.g. "for Sarah", "Mrs Mitchell", "John\'s"). Set to null if no name is clearly given. Do NOT guess names from job descriptions, locations, or generic nouns. Common job-type words (kitchen, bathroom, electrics, plumbing, garden, fence, etc.) are NOT customer names.\n- amount: number in pounds with no symbol. null if not present.\n- paymentType: as listed, or null if not mentioned.\n\nExamples:\n- "Kitchen job Sarah £380 cash" → {"name": "Kitchen job", "customer": "Sarah", "amount": 380, "paymentType": "cash"}\n- "Plastering 250" → {"name": "Plastering", "customer": null, "amount": 250, "paymentType": null}\n- "Bathroom refit for Mrs Mitchell £2950 bank transfer" → {"name": "Bathroom refit", "customer": "Mrs Mitchell", "amount": 2950, "paymentType": "bank transfer"}\n- "Garden fence £450" → {"name": "Garden fence", "customer": null, "amount": 450, "paymentType": null}',
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
          customer: parsed.customer ?? null,
          amount: parsed.amount ?? regexAmount(text),
          paymentType: parsed.paymentType ?? regexPayment(text),
        };
      }
    }
  } catch {}

  // Fallback: regex can't reliably extract personal names without false positives,
  // so customer is always null here. User fills it in via the manual form.
  return {
    name: regexName(text),
    customer: null,
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
