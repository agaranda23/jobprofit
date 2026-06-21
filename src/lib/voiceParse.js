// Parse job transcripts via the Netlify AI proxy.
// Supports: English (en-GB), Polish (pl-PL), Romanian (ro-RO),
//           Portuguese (pt-PT), Spanish (es-ES), Italian (it-IT),
//           Russian (ru-RU), Lithuanian (lt-LT), Ukrainian (uk-UA),
//           Arabic (ar-SA).
// Falls back to regex if the AI proxy is unreachable or the user is not signed in.

import { supabase } from './supabase';

const MULTILINGUAL_SYSTEM_PROMPT = `Extract a job name, customer name (only if explicitly named), amount in GBP, and optional payment type from the transcript.
Respond ONLY with JSON: {"name": string, "customer": string|null, "amount": number|null, "paymentType": "cash"|"bank transfer"|"card"|"cheque"|null}.

The transcript may be in English, Polish, Romanian, Portuguese, Spanish, Italian, Russian, Lithuanian, Ukrainian, or Arabic. Keep the job name and customer name in the source language — the trader recognises their own words.

Rules:
- name: the job description (e.g. "Kitchen renovation", "Kuchnia", "Bucătărie", "Cozinha", "Cocina", "Cucina", "Кухня", "Virtuvė", "مطبخ"). NOT the customer name.
- customer: a person's name if EXPLICITLY mentioned. Set to null if no name is clearly given. Do NOT guess names from job descriptions or locations.
- amount: number in pounds with no symbol. null if not present. IMPORTANT: convert Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩) to Western digits (e.g. ٣٨٠ → 380).
- paymentType: normalise to the English enum below regardless of input language.

Payment type word list (normalise any of these to the English enum value):
- "cash": cash, gotówka (PL), numerar (RO), dinheiro (PT), efectivo (ES), contanti (IT), наличные/нал (RU), grynais (LT), готівка (UK), نقدا/كاش (AR)
- "bank transfer": bank transfer, przelew (PL), transfer bancar (RO), transferência (PT), transferencia (ES), bonifico (IT), перевод (RU), pavedimas (LT), переказ (UK), تحويل (AR), bacs
- "card": card, karta (PL), card (RO), cartão (PT), tarjeta (ES), carta (IT), картой/карта (RU), kortele (LT), карткою/карта (UK), بطاقة (AR), credit, debit
- "cheque": cheque, czek (PL), cec (RO), cheque (PT/ES), assegno (IT), чек (RU/UK), čekis (LT), شيك (AR)

Examples:
- "Kitchen job Sarah £380 cash" → {"name": "Kitchen job", "customer": "Sarah", "amount": 380, "paymentType": "cash"}
- "Kuchnia Sarah 380 gotówka" → {"name": "Kuchnia", "customer": "Sarah", "amount": 380, "paymentType": "cash"}
- "Bucătărie pentru Maria 250 numerar" → {"name": "Bucătărie", "customer": "Maria", "amount": 250, "paymentType": "cash"}
- "Cozinha 500 dinheiro" → {"name": "Cozinha", "customer": null, "amount": 500, "paymentType": "cash"}
- "Cocina 300 efectivo" → {"name": "Cocina", "customer": null, "amount": 300, "paymentType": "cash"}
- "Cucina Maria 380 contanti" → {"name": "Cucina", "customer": "Maria", "amount": 380, "paymentType": "cash"}
- "Кухня Сара 380 наличные" → {"name": "Кухня", "customer": "Сара", "amount": 380, "paymentType": "cash"}
- "Virtuvė 250 grynais" → {"name": "Virtuvė", "customer": null, "amount": 250, "paymentType": "cash"}
- "Кухня для Марії 300 готівка" → {"name": "Кухня", "customer": "Марія", "amount": 300, "paymentType": "cash"}
- "مطبخ ٣٨٠ نقدا" → {"name": "مطبخ", "customer": null, "amount": 380, "paymentType": "cash"}
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

// Arabic-Indic → Western digit map for the regex fallback path.
// The AI prompt handles this for the AI path; the regex fallback needs it too.
function normaliseArabicNumerals(text) {
  return text.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function regexAmount(text) {
  const t = normaliseArabicNumerals(text);

  // Prefer £-prefixed amounts — they are unambiguous.
  // Take the LAST match so "for 3 people £380" picks 380 not 3.
  const poundMatches = [...t.matchAll(/£\s*([\d,]+(?:\.\d+)?)\s*(k|pounds?|quid)?/gi)];
  if (poundMatches.length > 0) {
    const last = poundMatches[poundMatches.length - 1];
    let n = parseFloat(last[1].replace(/,/g, ''));
    if (last[2] && /^k$/i.test(last[2])) n *= 1000;
    return isNaN(n) ? null : n;
  }

  // Fallback: no £ sign present — match a bare number with optional suffix.
  // Take the LAST match (rightmost in text) so a leading count word like
  // "3 people 380 cash" picks 380 rather than 3.
  const bareMatches = [...t.matchAll(/([\d,]+(?:\.\d+)?)\s*(k|pounds?|quid)?/gi)];
  if (bareMatches.length === 0) return null;
  const last = bareMatches[bareMatches.length - 1];
  let n = parseFloat(last[1].replace(/,/g, ''));
  if (last[2] && /^k$/i.test(last[2])) n *= 1000;
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
    // Italian payment words
    .replace(/\b(contanti|bonifico)\b/gi, '')
    // Russian payment words (Cyrillic — no \b boundary; replace directly)
    .replace(/наличные|нал|перевод|картой/g, '')
    // Lithuanian payment words
    .replace(/\b(grynais|pavedimas|kortele)\b/gi, '')
    // Ukrainian payment words (Cyrillic)
    .replace(/готівка|переказ|карткою/g, '')
    // Arabic payment words
    .replace(/نقدا|كاش|تحويل|بطاقة|شيك/g, '')
    .replace(/\b(untuk|pentru|para|for|at|cost(s|ing)?|priced|paid|via|by)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function regexPayment(text) {
  const t = text.toLowerCase();
  // Cash — EN + PL + RO + PT + ES + IT + RU + LT + UK + AR
  if (/\bcash\b/.test(t)) return 'cash';
  if (/\bgotówka\b/.test(t)) return 'cash';
  if (/\bnumerar\b/.test(t)) return 'cash';
  if (/\bdinheiro\b/.test(t)) return 'cash';
  if (/\befectivo\b/.test(t)) return 'cash';
  if (/\bcontanti\b/.test(t)) return 'cash';
  if (/наличные|нал\b/.test(t)) return 'cash';        // RU (Cyrillic, no \b)
  if (/\bgrynais\b/.test(t)) return 'cash';
  if (/готівка/.test(t)) return 'cash';               // UK (Cyrillic)
  if (/نقدا|كاش/.test(t)) return 'cash';             // AR
  // Bank transfer — EN + PL + RO + PT + ES + IT + RU + LT + UK + AR
  if (/\bbank (transfer|payment)\b|\bbacs\b/.test(t)) return 'bank transfer';
  if (/\btransfer\b/.test(t)) return 'bank transfer';
  if (/\bprzelew\b/.test(t)) return 'bank transfer';
  if (/\btransfer bancar\b/.test(t)) return 'bank transfer';
  if (/\btransferên(cia)?\b/.test(t)) return 'bank transfer';
  if (/\btransferencia\b/.test(t)) return 'bank transfer';
  if (/\bbonifico\b/.test(t)) return 'bank transfer';
  if (/перевод/.test(t)) return 'bank transfer';      // RU (Cyrillic)
  if (/\bpavedimas\b/.test(t)) return 'bank transfer';
  if (/переказ/.test(t)) return 'bank transfer';      // UK (Cyrillic)
  if (/تحويل/.test(t)) return 'bank transfer';        // AR
  // Card — EN + PL + RO + PT + ES + IT + RU + LT + UK + AR
  if (/\bcard\b|\bcredit\b|\bdebit\b/.test(t)) return 'card';
  if (/\bkarta\b/.test(t)) return 'card';
  if (/\bcartão\b/.test(t)) return 'card';
  if (/\btarjeta\b/.test(t)) return 'card';
  if (/\bcarta\b/.test(t)) return 'card';             // IT
  if (/картой|карта/.test(t)) return 'card';          // RU (Cyrillic)
  if (/\bkortele\b/.test(t)) return 'card';
  if (/карткою/.test(t)) return 'card';               // UK (Cyrillic)
  if (/بطاقة/.test(t)) return 'card';                // AR
  // Cheque — EN + PL + RO + PT/ES + IT + RU + LT + UK + AR
  if (/\bcheque\b|\bcheck\b/.test(t)) return 'cheque';
  if (/\bczek\b/.test(t)) return 'cheque';
  if (/\bcec\b/.test(t)) return 'cheque';
  if (/\bassegno\b/.test(t)) return 'cheque';         // IT
  if (/\bčekis\b/.test(t)) return 'cheque';           // LT
  if (/чек/.test(t)) return 'cheque';                 // RU + UK (Cyrillic)
  if (/شيك/.test(t)) return 'cheque';                // AR
  return null;
}
