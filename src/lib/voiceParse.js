// Parse "Bathroom tiling £650" style transcripts via the existing
// Netlify AI proxy at /.netlify/functions/ai.
// Falls back to regex if the API is unreachable.

export async function parseJobFromSpeech(transcript) {
  const text = (transcript || '').trim();
  if (!text) return { name: '', amount: null };

  // Try AI parse first
  try {
    const res = await fetch('/.netlify/functions/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        system: 'Extract a job name and amount in GBP from the user\'s transcript. Respond ONLY with JSON: {"name": string, "amount": number}. Amount should be a number in pounds (no currency symbol). If no amount found, set amount to null.',
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
        };
      }
    }
  } catch {
    // fall through to regex
  }

  return { name: regexName(text), amount: regexAmount(text) };
}

function regexAmount(text) {
  // Matches £650, 650 pounds, 1,250.50, 1.2k etc.
  const m = text.match(/£?\s*([\d,]+(?:\.\d+)?)\s*(k|pounds?|quid)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2] && /^k$/i.test(m[2])) n *= 1000;
  return isNaN(n) ? null : n;
}

function regexName(text) {
  // Strip amount mentions, trim trailing "for/at/£..." clauses
  return text
    .replace(/£?\s*[\d,]+(?:\.\d+)?\s*(k|pounds?|quid)?/gi, '')
    .replace(/\b(for|at|cost(s|ing)?|priced)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
