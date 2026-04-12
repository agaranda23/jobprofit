import sys

f = 'src/App.jsx'
s = open(f).read()
original_len = len(s)

# ── 1. Extend seedJobs to include new fields (add defaults to first job as example)
# We just need to make sure new fields default gracefully — handled in calcProfitFull below

# ── 2. Add calcProfitFull helper after existing calcProfit function
new_calc = '''
function calcProfitFull(job, expenses) {
  const price = job.total || 0;
  const discountType = job.discountType || "fixed";
  const discountValue = Number(job.discountValue) || 0;
  const discountAmount = discountType === "percent" ? price * (discountValue / 100) : discountValue;
  const priceAfterDiscount = Math.max(0, price - discountAmount);
  const vatEnabled = job.vatEnabled || false;
  const vatRate = job.vatRate || 0.2;
  const vatAmount = vatEnabled ? priceAfterDiscount * vatRate : 0;
  const totalWithVAT = priceAfterDiscount + vatAmount;
  const depositPercent = Number(job.depositPercent) || 0;
  const depositAmount = priceAfterDiscount * (depositPercent / 100);
  const remainingBalance = priceAfterDiscount - depositAmount;
  const labourCost = Number(job.labourCost) || 0;
  const matCost = expenses.filter(e => e.jobId === job.id).reduce((s, e) => s + e.amount, 0);
  const profit = priceAfterDiscount - matCost - labourCost;
  const margin = priceAfterDiscount > 0 ? Math.round((profit / priceAfterDiscount) * 100) : 0;
  const marginStatus = margin >= 40 ? { label: "Strong profit", color: "#16A34A", dot: "🟢" }
    : margin >= 20 ? { label: "Tight margin", color: "#EA580C", dot: "🟠" }
    : { label: "Risky job", color: "#DC2626", dot: "🔴" };
  return { price, discountAmount, priceAfterDiscount, vatAmount, totalWithVAT, depositAmount, remainingBalance, labourCost, matCost, profit, margin, marginStatus, vatEnabled, depositPercent };
}
'''

s = s.replace(
    'function calcProfit(job, expenses) {',
    new_calc + '\nfunction calcProfit(job, expenses) {'
)

# ── 3. Add QuoteFinancials component (used in both AddJob + JobDetail)
quote_financials = '''
/* ─── Quote Financials Panel ─────────────────────── */
function QuoteFinancials({ job, onChange }) {
  const price = job.total || 0;
  const discountType = job.discountType || "fixed";
  const discountValue = Number(job.discountValue) || 0;
  const discountAmount = discountType === "percent" ? price * (discountValue / 100) : discountValue;
  const priceAfterDiscount = Math.max(0, price - discountAmount);
  const vatEnabled = job.vatEnabled || false;
  const vatRate = job.vatRate || 0.2;
  const vatAmount = vatEnabled ? priceAfterDiscount * vatRate : 0;
  const totalWithVAT = priceAfterDiscount + vatAmount;
  const depositPercent = Number(job.depositPercent) || 0;
  const depositAmount = priceAfterDiscount * (depositPercent / 100);
  const remainingBalance = priceAfterDiscount - depositAmount;
  const labourCost = Number(job.labourCost) || 0;
  const [labourMode, setLabourMode] = useState("manual");
  const [labourHours, setLabourHours] = useState("");
  const [labourRate, setLabourRate] = useState(String(job.hourlyRate || 45));

  const handleLabourCalc = () => {
    const hrs = Number(labourHours);
    const rate = Number(labourRate);
    if (hrs > 0 && rate > 0) onChange("labourCost", String(hrs * rate));
  };

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    {/* Labour */}
    <div style={{ background: T.surfaceAlt, borderRadius: T.rSm, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5 }}>Labour Cost</label>
        <div style={{ display: "flex", gap: 4 }}>
          {["manual","calc"].map(m => <button key={m} onClick={() => setLabourMode(m)} style={{ ...S.btn, padding: "4px 10px", fontSize: 11, minHeight: 28, background: labourMode === m ? T.primary : T.surface, color: labourMode === m ? "#fff" : T.textMed, border: `1px solid ${T.border}` }}>{m === "manual" ? "Manual" : "Calculate"}</button>)}
        </div>
      </div>
      {labourMode === "manual"
        ? <input type="number" value={job.labourCost || ""} onChange={e => onChange("labourCost", e.target.value)} placeholder="e.g. 1200" style={S.inp} />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" value={labourHours} onChange={e => setLabourHours(e.target.value)} placeholder="Hours" style={{ ...S.inp, flex: 1 }} />
              <input type="number" value={labourRate} onChange={e => setLabourRate(e.target.value)} placeholder="£/hr" style={{ ...S.inp, width: 80 }} />
              <button onClick={handleLabourCalc} style={{ ...pri, padding: "12px 14px", fontSize: 13, minHeight: 46 }}>Calc</button>
            </div>
            {job.labourCost > 0 && <div style={{ fontSize: 13, color: T.accent, fontWeight: 700 }}>Labour: {GBP(labourCost)}</div>}
          </div>
      }
    </div>

    {/* Discount */}
    <div style={{ background: T.surfaceAlt, borderRadius: T.rSm, padding: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5, marginBottom: 10, display: "block" }}>Discount</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["fixed","percent"].map(t => <button key={t} onClick={() => onChange("discountType", t)} style={{ ...S.btn, padding: "8px 12px", fontSize: 12, minHeight: 36, background: discountType === t ? T.primary : T.surface, color: discountType === t ? "#fff" : T.textMed, border: `1px solid ${T.border}` }}>{t === "fixed" ? "£" : "%"}</button>)}
        </div>
        <input type="number" value={job.discountValue || ""} onChange={e => onChange("discountValue", e.target.value)} placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 150"} style={{ ...S.inp, flex: 1 }} />
      </div>
      {discountAmount > 0 && <div style={{ fontSize: 13, color: T.warn, fontWeight: 600, marginTop: 8 }}>Discount: −{GBP(discountAmount)} → {GBP(priceAfterDiscount)}</div>}
    </div>

    {/* VAT */}
    <div style={{ background: T.surfaceAlt, borderRadius: T.rSm, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: vatEnabled ? 10 : 0 }}>
        <input type="checkbox" id="qf-vat" checked={vatEnabled} onChange={e => onChange("vatEnabled", e.target.checked)} style={{ width: 18, height: 18, accentColor: T.primary }} />
        <label htmlFor="qf-vat" style={{ fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Add VAT (20%)</label>
      </div>
      {vatEnabled && <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMed }}><span>Subtotal (ex VAT)</span><span style={{ fontWeight: 600 }}>{GBP(priceAfterDiscount)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.warn }}><span>VAT (20%)</span><span style={{ fontWeight: 600 }}>+{GBP(vatAmount)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, color: T.text, borderTop: `1px solid ${T.border}`, paddingTop: 6, marginTop: 2 }}><span>Total (inc VAT)</span><span>{GBP(totalWithVAT)}</span></div>
      </div>}
    </div>

    {/* Deposit */}
    <div style={{ background: T.surfaceAlt, borderRadius: T.rSm, padding: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5, marginBottom: 10, display: "block" }}>Deposit %</label>
      <input type="number" value={job.depositPercent || ""} onChange={e => onChange("depositPercent", e.target.value)} placeholder="e.g. 30" style={S.inp} min="0" max="100" />
      {depositPercent > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMed }}><span>Deposit due ({depositPercent}%)</span><span style={{ fontWeight: 700, color: T.accent }}>{GBP(depositAmount)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMed }}><span>Remaining balance</span><span style={{ fontWeight: 600 }}>{GBP(remainingBalance)}</span></div>
      </div>}
    </div>
  </div>;
}

/* ─── Profit Summary Card ─────────────────────────── */
function ProfitSummaryCard({ job, expenses }) {
  const r = calcProfitFull(job, expenses);
  if (r.priceAfterDiscount === 0) return null;
  return <div style={{ background: T.surface, borderRadius: T.r, padding: 16, border: `1px solid ${T.border}`, boxShadow: T.cardShadow }}>
    <span style={{ ...S.lbl, marginBottom: 12 }}>Job Profit Summary</span>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
      <div><div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Price</div><div style={{ fontSize: 18, fontWeight: 800, color: T.primary }}>{GBP(r.priceAfterDiscount)}</div>{r.discountAmount > 0 && <div style={{ fontSize: 11, color: T.warn }}>−{GBP(r.discountAmount)} discount</div>}</div>
      <div><div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Materials</div><div style={{ fontSize: 18, fontWeight: 800, color: T.danger }}>{GBP(r.matCost)}</div></div>
      <div><div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Labour</div><div style={{ fontSize: 18, fontWeight: 800, color: T.warn }}>{GBP(r.labourCost)}</div></div>
      <div><div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Margin</div><div style={{ fontSize: 18, fontWeight: 800, color: r.marginStatus.color }}>{r.margin}%</div></div>
    </div>
    <div style={{ background: r.profit >= 0 ? "linear-gradient(135deg,#1f9d55,#178a4a)" : "linear-gradient(135deg,#dc2626,#b91c1c)", borderRadius: T.rSm, padding: "14px 16px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div><div style={{ fontSize: 11, opacity: .75, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Profit</div><div style={{ fontSize: 28, fontWeight: 800 }}>{GBP(r.profit)}</div></div>
      <div style={{ fontSize: 20 }}>{r.marginStatus.dot} <span style={{ fontSize: 13, fontWeight: 700 }}>{r.marginStatus.label}</span></div>
    </div>
    {r.vatEnabled && <div style={{ marginTop: 10, padding: "10px 12px", background: T.warnLight, borderRadius: T.rSm, fontSize: 13, color: T.warn, fontWeight: 600 }}>Total inc VAT: {GBP(r.totalWithVAT)}</div>}
    {r.depositPercent > 0 && <div style={{ marginTop: 8, padding: "10px 12px", background: T.accentLight, borderRadius: T.rSm, display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: T.accent, fontWeight: 700 }}>Deposit due: {GBP(r.depositAmount)}</span><span style={{ color: T.textMed }}>Balance: {GBP(r.remainingBalance)}</span></div>}
  </div>;
}
'''

s = s.replace(
    '/* ═══ INSIGHTS CARD ═════════════════════════════════ */',
    quote_financials + '\n/* ═══ INSIGHTS CARD ═════════════════════════════════ */'
)

# ── 4. In JobDetail — add QuoteFinancials + ProfitSummaryCard after ProfitBar
# Find the ProfitBar usage in JobDetail and add panels after it
old_profitbar = '''    {showVat && totVat > 0 && <div style={{ marginTop: 8, padding: "10px 14px", background: T.warnLight, borderRadius: T.rSm }}><span style={{ fontSize: 13, color: T.warn, fontWeight: 700 }}>VAT reclaim: {GBP(totVat)}</span></div>}
    {/* Pipeline buttons */}'''

new_profitbar = '''    {showVat && totVat > 0 && <div style={{ marginTop: 8, padding: "10px 14px", background: T.warnLight, borderRadius: T.rSm }}><span style={{ fontSize: 13, color: T.warn, fontWeight: 700 }}>VAT reclaim: {GBP(totVat)}</span></div>}
    {/* Profit Summary */}
    <div style={{ marginTop: 16 }}><ProfitSummaryCard job={job} expenses={expenses} /></div>
    {/* Quote Financials */}
    <div style={{ marginTop: 16, marginBottom: 4 }}><span style={{ ...S.lbl }}>Discount / VAT / Deposit</span><QuoteFinancials job={job} onChange={(field, val) => onUpdate({ ...job, [field]: val })} /></div>
    {/* Pipeline buttons */}'''

s = s.replace(old_profitbar, new_profitbar)

# ── 5. In AddJobTab — after quote is generated, show QuoteFinancials
# Find onGen call and the generate button area — we add a post-gen state
# Find the textarea+generate button block and add QuoteFinancials after generation
# We do this by adding a generated job state to AddJobTab

old_addjobtab_start = '''function AddJobTab({ onGen, biz }) {
  const [rec, setRec] = useState(false); const [txt, setTxt] = useState(""); const [busy, setBusy] = useState(false);
  const [tmr, setTmr] = useState(0); const [manual, setManual] = useState(false); const [err, setErr] = useState(""); const [showTpl, setShowTpl] = useState(false);
  const [source, setSource] = useState("");'''

new_addjobtab_start = '''function AddJobTab({ onGen, biz }) {
  const [rec, setRec] = useState(false); const [txt, setTxt] = useState(""); const [busy, setBusy] = useState(false);
  const [tmr, setTmr] = useState(0); const [manual, setManual] = useState(false); const [err, setErr] = useState(""); const [showTpl, setShowTpl] = useState(false);
  const [source, setSource] = useState("");
  const [pendingJob, setPendingJob] = useState(null);
  const updatePending = (field, val) => setPendingJob(p => p ? { ...p, [field]: val } : p);'''

s = s.replace(old_addjobtab_start, new_addjobtab_start)

# Update proc to set pendingJob instead of calling onGen directly
old_proc = '''  const proc = async raw => { const s = raw || txt; if (!s.trim() || lk.current) return; lk.current = true; setBusy(true); const r = await aiQuote(s, biz); setBusy(false); lk.current = false; if (r) { onGen({ id: mkId("J"), date: td(), quoteStatus: "draft", jobStatus: "quote", invoiceStatus: "none", paymentStatus: "unpaid", paymentDate: "", paymentMethod: "", source: source || "", jobNotes: [], photos: [], invoiceId: "", phone: r.phone || "", email: r.email || "", ...r }); setTxt(""); setTmr(0); setSource(""); } else setErr("Couldn't generate quote."); };'''

new_proc = '''  const proc = async raw => { const s = raw || txt; if (!s.trim() || lk.current) return; lk.current = true; setBusy(true); const r = await aiQuote(s, biz); setBusy(false); lk.current = false; if (r) { const newJob = { id: mkId("J"), date: td(), quoteStatus: "draft", jobStatus: "quote", invoiceStatus: "none", paymentStatus: "unpaid", paymentDate: "", paymentMethod: "", source: source || "", jobNotes: [], photos: [], invoiceId: "", phone: r.phone || "", email: r.email || "", discountType: "fixed", discountValue: 0, vatEnabled: false, vatRate: 0.2, depositPercent: 0, labourCost: 0, ...r }; setPendingJob(newJob); setTxt(""); setTmr(0); setSource(""); } else setErr("Couldn't generate quote."); };'''

s = s.replace(old_proc, new_proc)

# Add pending job review UI — insert before the closing </div> of AddJobTab return
old_addjobtab_end = '''    <div style={{ width: "100%", maxWidth: 500 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><span style={S.lbl}>{manual ? "Job Description" : "Transcript"}</span><button onClick={() => setManual(!manual)} style={{ ...S.ghost, fontSize: 13 }}>{manual ? "🎙️ Use mic" : "⌨️ Type"}</button></div><textarea value={txt} onChange={e => setTxt(e.target.value)} placeholder={manual ? "Kitchen reno for Mrs Smith at 14 Elm Road…" : "Voice appears here…"} style={{ ...S.inp, minHeight: 110, resize: "vertical", lineHeight: 1.6 }} /><button onClick={() => proc()} disabled={!txt.trim() || busy} style={{ ...pri, width: "100%", marginTop: 16, opacity: !txt.trim() || busy ? .5 : 1 }}>{busy ? <><Spinner /> Generating…</> : <>🔨 Generate Quote</>}</button></div>
  </div>;
}'''

new_addjobtab_end = '''    {!pendingJob && <div style={{ width: "100%", maxWidth: 500 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><span style={S.lbl}>{manual ? "Job Description" : "Transcript"}</span><button onClick={() => setManual(!manual)} style={{ ...S.ghost, fontSize: 13 }}>{manual ? "🎙️ Use mic" : "⌨️ Type"}</button></div><textarea value={txt} onChange={e => setTxt(e.target.value)} placeholder={manual ? "Kitchen reno for Mrs Smith at 14 Elm Road…" : "Voice appears here…"} style={{ ...S.inp, minHeight: 110, resize: "vertical", lineHeight: 1.6 }} /><button onClick={() => proc()} disabled={!txt.trim() || busy} style={{ ...pri, width: "100%", marginTop: 16, opacity: !txt.trim() || busy ? .5 : 1 }}>{busy ? <><Spinner /> Generating…</> : <>🔨 Generate Quote</>}</button></div>}
    {pendingJob && <div style={{ width: "100%", maxWidth: 500 }}>
      <div style={{ background: T.accentLight, borderRadius: T.rSm, padding: "12px 16px", marginBottom: 16, border: "1px solid #BBF7D0" }}><div style={{ fontWeight: 700, fontSize: 15 }}>{pendingJob.customer}</div><div style={{ fontSize: 13, color: T.textMed, marginTop: 2 }}>{pendingJob.summary}</div><div style={{ fontSize: 20, fontWeight: 800, color: T.primary, marginTop: 6 }}>{GBP(pendingJob.total)}</div></div>
      <span style={{ ...S.lbl, marginBottom: 12 }}>Discount / VAT / Deposit</span>
      <QuoteFinancials job={pendingJob} onChange={updatePending} />
      <ProfitSummaryCard job={pendingJob} expenses={[]} />
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button onClick={() => { onGen(pendingJob); setPendingJob(null); }} style={{ ...grn, flex: 2 }}>Save Quote</button>
        <button onClick={() => setPendingJob(null)} style={{ ...sec, flex: 1 }}>Discard</button>
      </div>
    </div>}
  </div>;
}'''

s = s.replace(old_addjobtab_end, new_addjobtab_end)

# ── 6. Update OverviewTab month profit to use calcProfitFull
old_mo_profit = '''  const moProfit = moPaid - moMat;'''
new_mo_profit = '''  const moProfit = jobs.filter(j => j.paymentDate?.startsWith(mo)).reduce((sum, j) => { const r = calcProfitFull(j, expenses); return sum + r.profit; }, 0);'''
s = s.replace(old_mo_profit, new_mo_profit)

# Write
open(f, 'w').write(s)

# Verify key changes
checks = [
    ('calcProfitFull', 'profit engine'),
    ('QuoteFinancials', 'financials component'),
    ('ProfitSummaryCard', 'profit card'),
    ('pendingJob', 'pending job state'),
    ('discountType', 'discount field'),
    ('vatEnabled', 'VAT toggle'),
    ('depositPercent', 'deposit field'),
]
print(f"Original: {original_len} chars → New: {len(s)} chars (+{len(s)-original_len})")
for key, label in checks:
    count = s.count(key)
    status = "OK" if count > 0 else "MISSING"
    print(f"  {status}: {label} ({key} x{count})")
