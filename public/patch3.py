import sys

f = 'src/App.jsx'
s = open(f).read()
orig_len = len(s)

# ─── 1. calcProfitFull — insert before calcProfit ───────────────────────
CALC_FULL = r"""
function calcProfitFull(job, expenses) {
  const price = job.total || 0;
  const discountType = job.discountType || "fixed";
  const discountValue = Number(job.discountValue) || 0;
  const discountAmount = discountType === "percent" ? price * (discountValue / 100) : discountValue;
  const priceAfterDiscount = Math.max(0, price - discountAmount);
  const vatEnabled = job.vatEnabled || false;
  const vatAmount = vatEnabled ? priceAfterDiscount * 0.2 : 0;
  const totalWithVAT = priceAfterDiscount + vatAmount;
  const depositPercent = Number(job.depositPercent) || 0;
  const depositAmount = priceAfterDiscount * (depositPercent / 100);
  const remainingBalance = priceAfterDiscount - depositAmount;
  const labourCost = Number(job.labourCost) || 0;
  const matCost = expenses.filter(e => e.jobId === job.id).reduce((s, e) => s + e.amount, 0);
  const profit = priceAfterDiscount - matCost - labourCost;
  const margin = priceAfterDiscount > 0 ? Math.round((profit / priceAfterDiscount) * 100) : 0;
  const marginColor = margin >= 40 ? "#16A34A" : margin >= 20 ? "#EA580C" : "#DC2626";
  const marginLabel = margin >= 40 ? "Strong profit" : margin >= 20 ? "Tight margin" : "Risky job";
  return { price, discountAmount, priceAfterDiscount, vatAmount, totalWithVAT, depositAmount, remainingBalance, labourCost, matCost, profit, margin, marginColor, marginLabel, vatEnabled, depositPercent };
}
"""

OLD1 = "function calcProfit(job, expenses) {"
if OLD1 in s:
    s = s.replace(OLD1, CALC_FULL + "\n" + OLD1)
    print("OK: calcProfitFull inserted")
else:
    print("FAIL: calcProfit marker not found"); sys.exit(1)

# ─── 2. QuoteFinancials + ProfitSummaryCard — insert before INSIGHTS CARD ──
COMPONENTS = r"""
/* --- Quote Financials Panel --- */
function QuoteFinancials({ job, onChange }) {
  const price = job.total || 0;
  const discountType = job.discountType || "fixed";
  const discountValue = Number(job.discountValue) || 0;
  const discountAmount = discountType === "percent" ? price * (discountValue / 100) : discountValue;
  const priceAfterDiscount = Math.max(0, price - discountAmount);
  const vatEnabled = job.vatEnabled || false;
  const vatAmount = vatEnabled ? priceAfterDiscount * 0.2 : 0;
  const totalWithVAT = priceAfterDiscount + vatAmount;
  const depositPercent = Number(job.depositPercent) || 0;
  const depositAmount = priceAfterDiscount * (depositPercent / 100);
  const remainingBalance = priceAfterDiscount - depositAmount;
  const [labourMode, setLabourMode] = useState("manual");
  const [labourHours, setLabourHours] = useState("");
  const [labourRate, setLabourRate] = useState(String(job.hourlyRate || 45));
  const handleLabourCalc = () => {
    const hrs = Number(labourHours);
    const rate = Number(labourRate);
    if (hrs > 0 && rate > 0) onChange("labourCost", String(hrs * rate));
  };
  const btnStyle = (active) => ({ ...S.btn, padding: "4px 10px", fontSize: 11, minHeight: 28, background: active ? T.primary : T.surface, color: active ? "#fff" : T.textMed, border: "1px solid " + T.border });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: T.surfaceAlt, borderRadius: T.rSm, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5 }}>Labour Cost</label>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setLabourMode("manual")} style={btnStyle(labourMode === "manual")}>Manual</button>
            <button onClick={() => setLabourMode("calc")} style={btnStyle(labourMode === "calc")}>Calculate</button>
          </div>
        </div>
        {labourMode === "manual" ? (
          <input type="number" value={job.labourCost || ""} onChange={e => onChange("labourCost", e.target.value)} placeholder="e.g. 1200" style={S.inp} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" value={labourHours} onChange={e => setLabourHours(e.target.value)} placeholder="Hours" style={{ ...S.inp, flex: 1 }} />
              <input type="number" value={labourRate} onChange={e => setLabourRate(e.target.value)} placeholder="£/hr" style={{ ...S.inp, width: 80 }} />
              <button onClick={handleLabourCalc} style={{ ...pri, padding: "12px 14px", fontSize: 13, minHeight: 46 }}>Calc</button>
            </div>
            {Number(job.labourCost) > 0 && <div style={{ fontSize: 13, color: T.accent, fontWeight: 700 }}>Labour: {GBP(Number(job.labourCost))}</div>}
          </div>
        )}
      </div>
      <div style={{ background: T.surfaceAlt, borderRadius: T.rSm, padding: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5, marginBottom: 10, display: "block" }}>Discount</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => onChange("discountType", "fixed")} style={btnStyle(discountType === "fixed")}>£</button>
            <button onClick={() => onChange("discountType", "percent")} style={btnStyle(discountType === "percent")}>%</button>
          </div>
          <input type="number" value={job.discountValue || ""} onChange={e => onChange("discountValue", e.target.value)} placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 150"} style={{ ...S.inp, flex: 1 }} />
        </div>
        {discountAmount > 0 && <div style={{ fontSize: 13, color: T.warn, fontWeight: 600, marginTop: 8 }}>Discount: -{GBP(discountAmount)} then {GBP(priceAfterDiscount)}</div>}
      </div>
      <div style={{ background: T.surfaceAlt, borderRadius: T.rSm, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: vatEnabled ? 10 : 0 }}>
          <input type="checkbox" id="qf-vat" checked={vatEnabled} onChange={e => onChange("vatEnabled", e.target.checked)} style={{ width: 18, height: 18, accentColor: T.primary }} />
          <label htmlFor="qf-vat" style={{ fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Add VAT (20%)</label>
        </div>
        {vatEnabled && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 8, borderTop: "1px solid " + T.border }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMed }}><span>Subtotal (ex VAT)</span><span style={{ fontWeight: 600 }}>{GBP(priceAfterDiscount)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.warn }}><span>VAT (20%)</span><span style={{ fontWeight: 600 }}>+{GBP(vatAmount)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, color: T.text, borderTop: "1px solid " + T.border, paddingTop: 6, marginTop: 2 }}><span>Total (inc VAT)</span><span>{GBP(totalWithVAT)}</span></div>
          </div>
        )}
      </div>
      <div style={{ background: T.surfaceAlt, borderRadius: T.rSm, padding: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5, marginBottom: 10, display: "block" }}>Deposit %</label>
        <input type="number" value={job.depositPercent || ""} onChange={e => onChange("depositPercent", e.target.value)} placeholder="e.g. 30" style={S.inp} min="0" max="100" />
        {depositPercent > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMed }}><span>Deposit due ({depositPercent}%)</span><span style={{ fontWeight: 700, color: T.accent }}>{GBP(depositAmount)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMed }}><span>Remaining balance</span><span style={{ fontWeight: 600 }}>{GBP(remainingBalance)}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

/* --- Profit Summary Card --- */
function ProfitSummaryCard({ job, expenses }) {
  const r = calcProfitFull(job, expenses);
  if (r.priceAfterDiscount === 0) return null;
  return (
    <div style={{ background: T.surface, borderRadius: T.r, padding: 16, border: "1px solid " + T.border, boxShadow: T.cardShadow }}>
      <span style={{ ...S.lbl, marginBottom: 12 }}>Job Profit Summary</span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Price</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.primary }}>{GBP(r.priceAfterDiscount)}</div>
          {r.discountAmount > 0 && <div style={{ fontSize: 11, color: T.warn }}>-{GBP(r.discountAmount)} discount</div>}
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Materials</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.danger }}>{GBP(r.matCost)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Labour</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.warn }}>{GBP(r.labourCost)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Margin</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: r.marginColor }}>{r.margin}%</div>
        </div>
      </div>
      <div style={{ background: r.profit >= 0 ? "linear-gradient(135deg,#1f9d55,#178a4a)" : "linear-gradient(135deg,#dc2626,#b91c1c)", borderRadius: T.rSm, padding: "14px 16px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, opacity: .75, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Profit</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{GBP(r.profit)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{r.margin}%</div>
          <div style={{ fontSize: 12, opacity: .8, marginTop: 2 }}>{r.marginLabel}</div>
        </div>
      </div>
      {r.vatEnabled && <div style={{ marginTop: 10, padding: "10px 12px", background: T.warnLight, borderRadius: T.rSm, fontSize: 13, color: T.warn, fontWeight: 600 }}>Total inc VAT: {GBP(r.totalWithVAT)}</div>}
      {r.depositPercent > 0 && (
        <div style={{ marginTop: 8, padding: "10px 12px", background: T.accentLight, borderRadius: T.rSm, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: T.accent, fontWeight: 700 }}>Deposit due: {GBP(r.depositAmount)}</span>
          <span style={{ color: T.textMed }}>Balance: {GBP(r.remainingBalance)}</span>
        </div>
      )}
    </div>
  );
}
"""

OLD2 = "/* ═══ INSIGHTS CARD ═════════════════════════════════ */"
if OLD2 in s:
    s = s.replace(OLD2, COMPONENTS + "\n" + OLD2)
    print("OK: QuoteFinancials + ProfitSummaryCard inserted")
else:
    print("FAIL: insights marker not found"); sys.exit(1)

# ─── 3. Add panels to JobDetail after VAT reclaim line ──────────────────
OLD3 = '    {showVat && totVat > 0 && <div style={{ marginTop: 8, padding: "10px 14px", background: T.warnLight, borderRadius: T.rSm }}><span style={{ fontSize: 13, color: T.warn, fontWeight: 700 }}>VAT reclaim: {GBP(totVat)}</span></div>}\n    {/* Pipeline buttons */}'
NEW3 = '    {showVat && totVat > 0 && <div style={{ marginTop: 8, padding: "10px 14px", background: T.warnLight, borderRadius: T.rSm }}><span style={{ fontSize: 13, color: T.warn, fontWeight: 700 }}>VAT reclaim: {GBP(totVat)}</span></div>}\n    <div style={{ marginTop: 16 }}><ProfitSummaryCard job={job} expenses={expenses} /></div>\n    <div style={{ marginTop: 16, marginBottom: 4 }}><span style={{ ...S.lbl }}>Discount / VAT / Deposit</span><QuoteFinancials job={job} onChange={(field, val) => onUpdate({ ...job, [field]: val })} /></div>\n    {/* Pipeline buttons */}'
if OLD3 in s:
    s = s.replace(OLD3, NEW3)
    print("OK: JobDetail panels inserted")
else:
    print("FAIL: JobDetail vat reclaim marker not found"); sys.exit(1)

# ─── 4. Add pendingJob state + update proc in AddJobTab ─────────────────
OLD4 = "  const proc = async raw => { const s = raw || txt; if (!s.trim() || lk.current) return; lk.current = true; setBusy(true); const r = await aiQuote(s, biz); setBusy(false); lk.current = false; if (r) { onGen({ id: mkId(\"J\"), date: td(), quoteStatus: \"draft\", jobStatus: \"quote\", invoiceStatus: \"none\", paymentStatus: \"unpaid\", paymentDate: \"\", paymentMethod: \"\", source: source || \"\", jobNotes: [], photos: [], invoiceId: \"\", phone: r.phone || \"\", email: r.email || \"\", ...r }); setTxt(\"\"); setTmr(0); setSource(\"\"); } else setErr(\"Couldn't generate quote.\"); };"
NEW4 = "  const [pendingJob, setPendingJob] = useState(null);\n  const updatePending = (field, val) => setPendingJob(p => p ? { ...p, [field]: val } : p);\n  const proc = async raw => { const s = raw || txt; if (!s.trim() || lk.current) return; lk.current = true; setBusy(true); const r = await aiQuote(s, biz); setBusy(false); lk.current = false; if (r) { const newJob = { id: mkId(\"J\"), date: td(), quoteStatus: \"draft\", jobStatus: \"quote\", invoiceStatus: \"none\", paymentStatus: \"unpaid\", paymentDate: \"\", paymentMethod: \"\", source: source || \"\", jobNotes: [], photos: [], invoiceId: \"\", phone: r.phone || \"\", email: r.email || \"\", discountType: \"fixed\", discountValue: 0, vatEnabled: false, vatRate: 0.2, depositPercent: 0, labourCost: 0, ...r }; setPendingJob(newJob); setTxt(\"\"); setTmr(0); setSource(\"\"); } else setErr(\"Couldn't generate quote.\"); };"
if OLD4 in s:
    s = s.replace(OLD4, NEW4)
    print("OK: proc updated with pendingJob")
else:
    print("FAIL: proc not found - searching...")
    idx = s.find("const proc = async raw =>")
    print(repr(s[idx:idx+200]))
    sys.exit(1)

# ─── 5. Wrap textarea block + add pending review UI ─────────────────────
# Find the textarea+generate button section — it starts with the maxWidth 500 div
# and ends just before </div>; } of AddJobTab
# We find it by looking for the unique placeholder text pattern
OLD5_SEARCH = '    <div style={{ width: "100%", maxWidth: 500 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><span style={S.lbl}>{manual ? "Job Description" : "Transcript"}'
if OLD5_SEARCH not in s:
    print("FAIL: textarea block not found"); sys.exit(1)

idx_start = s.find(OLD5_SEARCH)
# Find the closing of AddJobTab — the </div>;\n} after this point
idx_end = s.find('\n  </div>;\n}', idx_start)
if idx_end == -1:
    print("FAIL: AddJobTab closing not found"); sys.exit(1)

old_block = s[idx_start:idx_end + len('\n  </div>;\n}')]
new_block = (
    '{!pendingJob && ' + s[idx_start:idx_end] + '}\n'
    '    {pendingJob && (\n'
    '      <div style={{ width: "100%", maxWidth: 500 }}>\n'
    '        <div style={{ background: T.accentLight, borderRadius: T.rSm, padding: "12px 16px", marginBottom: 16, border: "1px solid #BBF7D0" }}>\n'
    '          <div style={{ fontWeight: 700, fontSize: 15 }}>{pendingJob.customer}</div>\n'
    '          <div style={{ fontSize: 13, color: T.textMed, marginTop: 2 }}>{pendingJob.summary}</div>\n'
    '          <div style={{ fontSize: 20, fontWeight: 800, color: T.primary, marginTop: 6 }}>{GBP(pendingJob.total)}</div>\n'
    '        </div>\n'
    '        <span style={{ ...S.lbl, marginBottom: 12 }}>Discount / VAT / Deposit</span>\n'
    '        <QuoteFinancials job={pendingJob} onChange={updatePending} />\n'
    '        <div style={{ marginTop: 16 }}><ProfitSummaryCard job={pendingJob} expenses={[]} /></div>\n'
    '        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>\n'
    '          <button onClick={() => { onGen(pendingJob); setPendingJob(null); }} style={{ ...grn, flex: 2 }}>Save Quote</button>\n'
    '          <button onClick={() => setPendingJob(null)} style={{ ...sec, flex: 1 }}>Discard</button>\n'
    '        </div>\n'
    '      </div>\n'
    '    )}\n'
    '  </div>;\n}'
)
s = s[:idx_start] + new_block + s[idx_end + len('\n  </div>;\n}'):]
print("OK: Add Job review screen inserted")

# ─── 6. Fix moProfit to use calcProfitFull ──────────────────────────────
OLD6 = "  const moProfit = moPaid - moMat;"
NEW6 = "  const moProfit = jobs.filter(j => j.paymentDate?.startsWith(mo)).reduce((sum, j) => { const r = calcProfitFull(j, expenses); return sum + r.profit; }, 0);"
if OLD6 in s:
    s = s.replace(OLD6, NEW6)
    print("OK: moProfit updated")
else:
    print("FAIL: moProfit not found"); sys.exit(1)

open(f, 'w').write(s)
print(f"\nDone: {orig_len} -> {len(s)} chars (+{len(s)-orig_len})")
