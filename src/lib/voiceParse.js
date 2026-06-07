// Parse job transcripts via the Netlify AI proxy.
// Supports: English (en-GB), Polish (pl-PL), Romanian (ro-RO),
//           Portuguese (pt-PT), Spanish (es-ES).
// Falls back to regex if the AI proxy is unreachable or the user is not signed in.

import { supabase } from './supabase';

const MULTILINGUAL_SYSTEM_PROMPT = `Extract a job name, customer name (only if explicitly named), amount in GBP, and optional payment type from the transcript.
Respond ONLY with JSON: {"name": string, "customer": string|null, "amount": number|null, "paymentType": "cash"|"bank transfer"|"card"|"cheque"|null}.

The transcript may be in English, Polish, Romanian, Portuguese, or Spanish. Keep the job name and customer name in the source language — the trader recognises their own words.

Rules:
- name: the job description (e.g. "Kitchen renovation", "Kuchnia", "Bucătărie", "Cozinha", "Cocina"). NOT the customer name.
- customer: a person's name if EXPLICITLY mentioned. Set to null if no name is clearly given. Do NOT guess names from job descriptions or locations.
- amount: number in pounds with no symbol. null if not present.
- paymentType: normalise to the English enum below regardless of input language.

Payment type word list (normalise any of these to the English enum value):
- "cash": cash, gotówka (PL), numerar (RO), dinheiro (PT), efectivo (ES)
- "bank transfer": bank transfer, przelew (PL), transfer bancar (RO), transferência (PT), transferencia (ES), bacs
- "card": card, karta (PL), card (RO), cartão (PT), tarjeta (ES), credit, debit
- "cheque": cheque, czek (PL), cec (RO), cheque (PT/ES)

Examples:
- "Kitchen job Sarah £380 cash" → {"name": "Kitchen job", "customer": "Sarah", "amount": 380, "paymentType": "cash"}
- "Kuchnia Sarah 380 gotówka" → {"name": "Kuchnia", "customer": "Sarah", "amount": 380, "paymentType": "cash"}
- "Bucătărie pentru Maria 250 numerar" → {"name": "Bucătărie", "customer": "Maria", "amount": 250, "paymentType": "cash"}
- "Cozinha 500 dinheiro" → {"name": "Cozinha", "customer": null, "amount": 500, "paymentType": "cash"}
- "Cocina 300 efectivo" → {"name": "Cocina", "customer": null, "amount": 300, "paymentType": "cash"}
- "Plastering 250" → {"name": "Plastering", "customer": null, "amount": 250, "paymentType": null}
- "Bathroom refit for Mrs Mitchell £2950 bank transfer" → {"name": "Bathroom refit", "customer": "Mrs Mitchell", "amount": 2950, "paymentType": "bank transfer"}`;

export async function parseJobFromSpeech(transcript) {
  const text = (transcript || '').trim();
  if (!text) return { name: '', customer: null, amount: null, paymentType: null };

  // Get the session token so the server-side function can verify identity.
  // If not signed in, fall through to the regex fallback — no error thrown.
  let accessToken;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    accessToken = session?.access_token;
  } catch {
    // Session fetch failed — fall through to regex
  }

  if (accessToken) {
    try {
      const res = await fetch('/.netlify/functions/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 160,
          system: MULTILINGUAL_SYSTEM_PROMPT,
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
  }

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
    // Polish payment words
    .replace(/\b(gotówka|przelew)\b/gi, '')
    // Romanian payment words
    .replace(/\b(numerar|transfer bancar|cec)\b/gi, '')
    // Portuguese payment words
    .replace(/\b(dinheiro|transferência|cartão)\b/gi, '')
    // Spanish payment words
    .replace(/\b(efectivo|transferencia|tarjeta)\b/gi, '')
    .replace(/\b(pentru|para|for|at|cost(s|ing)?|priced|paid|via|by)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function regexPayment(text) {
  const t = text.toLowerCase();
  // Cash — EN + PL + RO + PT + ES
  if (/\bcash\b/.test(t)) return 'cash';
  if (/\bgotówka\b/.test(t)) return 'cash';
  if (/\bnumerar\b/.test(t)) return 'cash';
  if (/\bdinheiro\b/.test(t)) return 'cash';
  if (/\befectivo\b/.test(t)) return 'cash';
  // Bank transfer — EN + PL + RO + PT + ES
  if (/\bbank (transfer|payment)\b|\btransfer\b|\bbacs\b/.test(t)) return 'bank transfer';
  if (/\bprzelew\b/.test(t)) return 'bank transfer';
  if (/\btransfer bancar\b/.test(t)) return 'bank transfer';
  if (/\btransferên(cia)?\b/.test(t)) return 'bank transfer';
  if (/\btransferencia\b/.test(t)) return 'bank transfer';
  // Card — EN + PL + RO + PT + ES
  if (/\bcard\b|\bcredit\b|\bdebit\b/.test(t)) return 'card';
  if (/\bkarta\b/.test(t)) return 'card';
  if (/\bcartão\b/.test(t)) return 'card';
  if (/\btarjeta\b/.test(t)) return 'card';
  // Cheque — EN + PL + RO + PT/ES
  if (/\bcheque\b|\bcheck\b/.test(t)) return 'cheque';
  if (/\bczek\b/.test(t)) return 'cheque';
  if (/\bcec\b/.test(t)) return 'cheque';
  return null;
}
