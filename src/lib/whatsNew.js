/**
 * whatsNew — changelog entries for the "What's new" row in Settings.
 *
 * Add new entries at the TOP of the array (newest first).
 * Each entry: { date, title, emoji, blurb }
 *   date  — ISO date string (YYYY-MM-DD), displayed as e.g. "31 May 2026"
 *   title — short feature name, shown bold
 *   emoji — single emoji for visual scanning
 *   blurb — one sentence explaining the value, no internal jargon
 */

export const WHATS_NEW = [
  {
    date: '2026-07-04',
    title: 'Export your books for your accountant',
    emoji: '🧮',
    blurb: 'Tap "Export for your accountant" on the Money tab and pick a Xero-ready or QuickBooks-ready file — a correctly formatted export your accountant can import in one go instead of re-typing every invoice and receipt. Pro feature.',
  },
  {
    date: '2026-07-04',
    title: 'Your free trial, no card required',
    emoji: '🎁',
    blurb: 'Start your 14-day OHNAR Pro trial without entering a card, and you\'ll get a friendly "You\'ve got Pro" welcome the moment it kicks in.',
  },
  {
    date: '2026-07-03',
    title: 'Quotes and invoices look the part',
    emoji: '📄',
    blurb: 'The quote and invoice preview your customer opens now looks like a real document — a clear letterhead, a bold total, and a proper paper feel instead of a plain form.',
  },
  {
    date: '2026-07-03',
    title: 'Edit straight from the preview',
    emoji: '✏️',
    blurb: 'Tap any line on the quote or invoice preview — customer details, dates, prices, or line items — to edit it on the spot, no need to back out to a separate screen.',
  },
  {
    date: '2026-07-03',
    title: 'VAT and deposit due-date on your quotes',
    emoji: '🔢',
    blurb: 'Customer-facing quotes now show the VAT breakdown and the deposit due date clearly, matching what your invoices already display.',
  },
  {
    date: '2026-07-03',
    title: 'Never lose an in-progress quote',
    emoji: '💾',
    blurb: 'Get pulled away mid-quote by a phone call? OHNAR now autosaves your draft and offers to pick up right where you left off the next time you open the app.',
  },
  {
    date: '2026-07-03',
    title: 'Try it with sample data',
    emoji: '🧪',
    blurb: 'New to OHNAR? Load a set of realistic sample jobs from Settings to see how everything works, then clear it with one tap whenever you\'re ready to add your own.',
  },
  {
    date: '2026-07-02',
    title: 'Voice quotes, smarter and quicker',
    emoji: '🎙️',
    blurb: 'Quote by voice in one shorter step — OHNAR now picks up VAT and deposit details automatically as you talk, then sends straight from the confirm card.',
  },
  {
    date: '2026-07-01',
    title: 'Ask for a review, or book them again',
    emoji: '⭐',
    blurb: 'Once a job\'s marked paid, OHNAR prompts you to ask the customer for a Google review and offers a one-tap "Book them again" to start a repeat job.',
  },
  {
    date: '2026-06-28',
    title: 'Smarter chasing: Jobs badge + backup email',
    emoji: '🔔',
    blurb: 'Jobs that need chasing now show a badge on the Jobs tab, and if a push notification doesn\'t get through, we\'ll email you a nudge too.',
  },
  {
    date: '2026-06-25',
    title: 'OHNAR — new name, same app',
    emoji: '🔵',
    blurb: 'We\'ve renamed to OHNAR. Everything works the same — your jobs, invoices, and data are all still here.',
  },
  {
    date: '2026-06-20',
    title: 'Swipe between tabs',
    emoji: '👆',
    blurb: 'Swipe left and right to move between Jobs, Money, and Settings — no need to tap the bottom bar.',
  },
  {
    date: '2026-06-15',
    title: 'Six-stage job tracker',
    emoji: '📋',
    blurb: 'Jobs now move through six clear stages — Lead, Quoted, On, Invoiced, Overdue, Paid — so you always know exactly where each job stands.',
  },
  {
    date: '2026-06-10',
    title: 'True profit & Tax Pot',
    emoji: '💷',
    blurb: 'The Money tab now shows your real profit after job costs and monthly bills, plus a Tax Pot that tells you how much to set aside — Pro feature.',
  },
  {
    date: '2026-06-05',
    title: 'Import your existing jobs',
    emoji: '📥',
    blurb: 'Bring your jobs across from a CSV or Excel spreadsheet in Settings → Data & Privacy → Import jobs — no re-entering by hand.',
  },
  {
    date: '2026-06-02',
    title: 'Paid celebration',
    emoji: '🎉',
    blurb: 'Mark a job paid and get a satisfying buzz — a small reminder that the work was worth it.',
  },
  {
    date: '2026-05-30',
    title: 'Photo gallery picker',
    emoji: '📷',
    blurb: 'Pick photos from your camera roll directly when logging job evidence — no more camera-only restriction.',
  },
  {
    date: '2026-05-29',
    title: 'Offline reliability',
    emoji: '📶',
    blurb: 'Jobs and updates queue locally when you lose signal and sync automatically when you are back online.',
  },
  {
    date: '2026-05-28',
    title: 'Chase reminders list',
    emoji: '🔔',
    blurb: 'See every overdue invoice ranked by days outstanding — tap a row to jump straight to the job.',
  },
  {
    date: '2026-05-27',
    title: 'CSV export',
    emoji: '📊',
    blurb: 'Export all your jobs and revenue to a spreadsheet in one tap — ready to send to your accountant.',
  },
  {
    date: '2026-05-24',
    title: 'Jobs-tab search',
    emoji: '🔍',
    blurb: 'Search across all your jobs by customer name, description, or amount — results update as you type.',
  },
  {
    date: '2026-05-22',
    title: 'Part-paid chip',
    emoji: '💰',
    blurb: 'Jobs with a partial payment now show a "Part paid" chip so you always know what is still outstanding.',
  },
  {
    date: '2026-05-21',
    title: 'Quote-accepted notifications',
    emoji: '✅',
    blurb: 'Get a push notification the moment a customer signs your quote — even when the app is closed.',
  },
  {
    date: '2026-05-20',
    title: 'Send receipts',
    emoji: '🧾',
    blurb: 'Generate and share a professional receipt PDF straight from any paid job — one tap, done.',
  },
  {
    date: '2026-05-15',
    title: 'Create-quote flow',
    emoji: '📝',
    blurb: 'Build a quote with line items using voice or text, then send a link to the customer to sign on their phone.',
  },
];

/**
 * Format a YYYY-MM-DD date string as "D Month YYYY" (e.g. "31 May 2026").
 * @param {string} isoDate
 * @returns {string}
 */
export function formatWhatsNewDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
