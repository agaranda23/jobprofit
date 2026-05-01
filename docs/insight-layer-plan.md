# JobProfit insight layer plan

Last good commit before insight work: `2a4bd94` (theme contrast bump).

## Positioning

Shift from "profit tracker" → "early-warning system for your business."
Headline answers "will I be okay?" not "how did I do?"
Numbers stay below as evidence; findings lead.

## Build order (locked)

1. Rename History → Insights *(copy-only, 5 min)*
2. Money owed card *(half-built, surface from chase logic)*
3. Hourly rate this week vs last week
4. 30-day cover card *(forward-looking — the wedge)*
5. Headline insight picker *(meta-card, picks strongest signal)*
6. Weekly scoreboard *(aggregator, last)*

Picker built last so it sees all 4 signals.
Scoreboard last because it depends on everything else.

## Empty states (ship-blocking)

| Card | Empty state copy |
|---|---|
| Money owed | "All caught up — nothing outstanding right now." |
| Hourly rate (week 0) | "Log a couple of jobs to see your real hourly rate." |
| Hourly rate (week 1) | "Your comparison appears next week." |
| 30-day cover (no scheduled) | "Add 1–2 upcoming jobs to see your forward cover." |
| 30-day cover (no spend history) | "Log a few expenses to estimate your monthly baseline." |
| 30-day cover (neither) | "Add upcoming jobs and expenses to unlock your 30-day cover." |
| Weekly scoreboard | Hide section entirely — silence reads as "still learning". |
| Headline insight | "Start logging jobs to see patterns in your business." |

## 30-day cover math
Use *last 30 days spending*, not "typical monthly spend" — works earlier
for new users, no 2-month minimum, simpler.

NEVER show shortfall warning unless real data backs it. Trust > cleverness.

## Headline insight priority order

Picker selects strongest available signal:

1. 30-day cover warning (e.g. "Short £420 for next 30 days")
2. Money owed > threshold
3. Hourly rate drop vs last week
4. Best job type improvement
5. Default greeting fallback

## Data sources

| Card | Reads | Where it lives |
|---|---|---|
| Money owed | jobs.paymentStatus = 'unpaid' | App.jsx local state (legacy) |
| Hourly rate | job total + hours + completion date | App.jsx local state |
| 30-day cover | scheduledDate + recent expenses | App.jsx local state |
| Best work | job type/category + margin | App.jsx local state |
| Scoreboard | aggregates of above | computed |
| Headline | strongest of above | computed |

Note: data lives in legacy App.jsx state, NOT the new Supabase
cloud-sync flow. Insight cards live in the Business tab (App.jsx
OverviewTab). Future migration to cloud is a separate concern.

## Discipline rules

- One card per commit
- `npm run build` green before every push
- Verify live deploy + check existing data untouched after each
- No back-button work this week (parked)
- No App.jsx split this week (parked)
- No invoicing/calendar/scheduling/RAMS scope creep
