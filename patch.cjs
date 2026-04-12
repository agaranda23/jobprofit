/**
 * JobProfit patch — adds:
 *   1. Monthly Overhead Tracking (state + settings UI)
 *   2. True Profit After Overhead (dashboard hero)
 *   3. Dashboard hierarchy upgrade
 *   4. Job Completion PDF Report (Download Job Report button)
 *
 * Run from your project root:
 *   node patch.cjs
 *
 * This patches public/App.jsx in place.
 * Git commit after verifying build works.
 */

const fs = require("fs");
const path = require("path");

const TARGET = path.join(__dirname, "src", "App.jsx");
let src = fs.readFileSync(TARGET, "utf8");

let changed = 0;
function replace(find, replacement, label) {
  if (!src.includes(find)) {
    console.warn("WARNING - ANCHOR NOT FOUND:", label);
    return;
  }
  src = src.replace(find, replacement);
  changed++;
  console.log("OK", label);
}

// ─── 1. OVERHEAD SEED DATA + CATEGORIES ─────────────────────────────────
replace(
  "const GBP = n =>",
  `const seedOverheads = [
  { id: "OH-0001", name: "Van payment", amount: 450, category: "Vehicle", is_active: true },
  { id: "OH-0002", name: "Insurance", amount: 280, category: "Insurance", is_active: true },
  { id: "OH-0003", name: "Fuel", amount: 320, category: "Fuel", is_active: true },
  { id: "OH-0004", name: "Phone", amount: 45, category: "Phone", is_active: true },
];
const OVERHEAD_CATEGORIES = ["Vehicle","Insurance","Fuel","Accountant","Phone","Subscriptions","Marketing","Tools","Storage","Rent","Utilities","Other"];

const GBP = n =>`,
  "Add seedOverheads + OVERHEAD_CATEGORIES"
);

// ─── 2. generateJobReportPDF function ───────────────────────────────────
replace(
  "function waInvoiceLink(",
  `async function generateJobReportPDF(job, biz, expenses) {
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const w = doc.internal.pageSize.getWidth();
  const jExp = expenses.filter(e => e.jobId === job.id);
  const totMat = jExp.reduce((s, e) => s + e.amount, 0);
  const labourCost = Number(job.labourCost) || 0;
  const profit = (job.total || 0) - totMat - labourCost;
  const margin = job.total > 0 ? Math.round((profit / job.total) * 100) : 0;
  let y = 18;

  // Header
  if (biz.logoUrl) { try { doc.addImage(biz.logoUrl, "JPEG", 14, y, 28, 28); } catch {} }
  doc.setFontSize(22); doc.setFont("helvetica","bold"); doc.setTextColor(30,58,138);
  doc.text("Job Report", w - 14, y + 8, { align: "right" });
  doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.setTextColor(100);
  doc.text(biz.name || "", w - 14, y + 16, { align: "right" });
  if (biz.phone) doc.text(biz.phone, w - 14, y + 22, { align: "right" });
  if (biz.email) doc.text(biz.email, w - 14, y + 28, { align: "right" });
  y = 52;

  // Section 1 - Job Info
  doc.setFillColor(30,58,138); doc.rect(14, y, w - 28, 8, "F");
  doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(255);
  doc.text("JOB INFORMATION", 18, y + 5.5); y += 12;
  const infoRows = [
    ["Job", job.summary ? job.summary.slice(0, 80) : job.id],
    ["Client", job.customer || ""],
    ["Address", job.address || ""],
    ["Date", job.date || ""],
    ["Status", (job.jobStatus || "quote").toUpperCase()],
    ["Payment", (job.paymentStatus || "unpaid").toUpperCase()],
  ];
  doc.setFontSize(10); doc.setFont("helvetica","normal");
  infoRows.forEach(([k, v]) => {
    if (!v) return;
    doc.setFont("helvetica","bold"); doc.setTextColor(100); doc.text(k + ":", 18, y);
    doc.setFont("helvetica","normal"); doc.setTextColor(40);
    const lines = doc.splitTextToSize(v, w - 80);
    doc.text(lines, 60, y);
    y += Math.max(7, lines.length * 5);
  });
  y += 4;

  // Section 2 - Financials
  if (y > 240) { doc.addPage(); y = 20; }
  doc.setFillColor(30,58,138); doc.rect(14, y, w - 28, 8, "F");
  doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(255);
  doc.text("FINANCIAL SUMMARY", 18, y + 5.5); y += 12;
  const finRows = [
    ["Revenue", "GBP_PLACEHOLDER_total"],
    ["Materials", "GBP_PLACEHOLDER_mat"],
    labourCost > 0 ? ["Labour", "GBP_PLACEHOLDER_labour"] : null,
    ["Profit", "GBP_PLACEHOLDER_profit"],
    ["Margin", margin + "%"],
  ].filter(Boolean);
  // We can't call GBP inside the template string easily, so use inline format
  const gbpFmt = n => "\\u00A3" + Number(n).toLocaleString("en-GB", {minimumFractionDigits:2,maximumFractionDigits:2});
  doc.setFontSize(10);
  [
    ["Revenue", gbpFmt(job.total || 0)],
    ["Materials", gbpFmt(totMat)],
    ...(labourCost > 0 ? [["Labour", gbpFmt(labourCost)]] : []),
    ["Profit", gbpFmt(profit)],
    ["Margin", margin + "%"],
  ].forEach(([k, v], i) => {
    if (i % 2 === 0) { doc.setFillColor(248,249,250); doc.rect(14, y-3.5, w-28, 7, "F"); }
    doc.setFont("helvetica","bold"); doc.setTextColor(100); doc.text(k + ":", 18, y);
    doc.setFont("helvetica","normal"); doc.setTextColor(40); doc.text(String(v), 70, y);
    y += 8;
  });
  y += 4;

  // Section 3 - Notes
  const notes = job.jobNotes || [];
  if (notes.length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFillColor(30,58,138); doc.rect(14, y, w - 28, 8, "F");
    doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(255);
    doc.text("WORK NOTES", 18, y + 5.5); y += 12;
    notes.slice(0, 5).forEach(n => {
      doc.setFont("helvetica","bold"); doc.setTextColor(60); doc.setFontSize(10);
      doc.text(n.subject || "Note", 18, y); y += 6;
      doc.setFont("helvetica","normal"); doc.setTextColor(80); doc.setFontSize(9);
      const lines = doc.splitTextToSize(n.body || "", w - 32);
      doc.text(lines, 18, y); y += lines.length * 4.5 + 6;
      if (y > 260) { doc.addPage(); y = 20; }
    });
  }

  // Section 4 - Receipts
  if (jExp.length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFillColor(30,58,138); doc.rect(14, y, w - 28, 8, "F");
    doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(255);
    doc.text("RECEIPTS & MATERIALS", 18, y + 5.5); y += 12;
    doc.setFontSize(10);
    jExp.forEach((e, i) => {
      if (i % 2 === 0) { doc.setFillColor(248,249,250); doc.rect(14, y-3.5, w-28, 7, "F"); }
      doc.setFont("helvetica","bold"); doc.setTextColor(80); doc.text(e.merchant || "Unknown", 18, y);
      doc.setFont("helvetica","normal"); doc.setTextColor(100);
      if (e.desc) { const dl = doc.splitTextToSize(e.desc, 90); doc.text(dl[0], 70, y); }
      doc.text(gbpFmt(e.amount), w - 18, y, { align: "right" });
      y += 8;
      if (y > 260) { doc.addPage(); y = 20; }
    });
    y += 4;
  }

  // Section 5 - Photos
  const photos = (job.photos || []).slice(0, 6);
  if (photos.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }
    doc.setFillColor(30,58,138); doc.rect(14, y, w - 28, 8, "F");
    doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(255);
    doc.text("PHOTOS", 18, y + 5.5); y += 12;
    const cols = 3;
    const imgW = (w - 28 - (cols - 1) * 4) / cols;
    const imgH = imgW * 0.75;
    photos.forEach((p, i) => {
      const col = i % cols; const row = Math.floor(i / cols);
      const px = 14 + col * (imgW + 4); const py = y + row * (imgH + 4);
      try { doc.addImage(p, "JPEG", px, py, imgW, imgH); } catch {}
    });
    y += Math.ceil(photos.length / cols) * (imgH + 4) + 4;
  }

  // Footer
  const fy = doc.internal.pageSize.getHeight() - 12;
  doc.setFontSize(8); doc.setFont("helvetica","normal"); doc.setTextColor(170);
  doc.text(
    (biz.name || "") + "  •  Generated by JobProfit  •  " + new Date().toLocaleDateString("en-GB"),
    w / 2, fy, { align: "center" }
  );

  const safeName = (job.customer || "job").replace(/[^a-z0-9]/gi, "-").toLowerCase();
  doc.save("job-report-" + safeName + "-" + new Date().toISOString().slice(0, 10) + ".pdf");
}

function waInvoiceLink(`,
  "Add generateJobReportPDF"
);

// ─── 3. _JobReportBtn component ─────────────────────────────────────────
replace(
  "/* ═══ JOB DETAIL — Full Pipeline ═════════════════════ */",
  `/* ─── Job Report PDF Button ────────────────────────── */
function _JobReportBtn({ job, biz, expenses, flash }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      await generateJobReportPDF(job, biz, expenses);
      flash("PDF downloaded");
    } catch {
      flash("Could not generate report. Please try again.");
    }
    setBusy(false);
  };
  return (
    <button onClick={download} disabled={busy} style={{ ...sec, width: "100%", opacity: busy ? .5 : 1 }}>
      {busy ? <><Spinner /> Generating report...</> : <>Download Job Report (PDF)</>}
    </button>
  );
}

/* ═══ JOB DETAIL — Full Pipeline ═════════════════════ */`,
  "Add _JobReportBtn component"
);

// ─── 4. PDF button in JobDetail quick actions ────────────────────────────
replace(
  `    {/* Quick actions */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}><button onClick={() => setAddingExp(true)} style={{ ...sec, width: "100%", fontSize: 12, padding: "10px 6px" }}>🧾 Material</button><button onClick={() => photoRef.current?.click()} style={{ ...sec, width: "100%", fontSize: 12, padding: "10px 6px" }}>📷 Photo</button><button onClick={() => { setEd(true); setD({ ...job }); }} style={{ ...sec, width: "100%", fontSize: 12, padding: "10px 6px" }}>✏️ Edit</button><input ref={photoRef} type="file" accept="image/*" capture="environment" multiple onChange={handleJobPhoto} style={{ display: "none" }} /></div>`,
  `    {/* Quick actions */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}><button onClick={() => setAddingExp(true)} style={{ ...sec, width: "100%", fontSize: 12, padding: "10px 6px" }}>🧾 Material</button><button onClick={() => photoRef.current?.click()} style={{ ...sec, width: "100%", fontSize: 12, padding: "10px 6px" }}>📷 Photo</button><button onClick={() => { setEd(true); setD({ ...job }); }} style={{ ...sec, width: "100%", fontSize: 12, padding: "10px 6px" }}>✏️ Edit</button><input ref={photoRef} type="file" accept="image/*" capture="environment" multiple onChange={handleJobPhoto} style={{ display: "none" }} /></div>
    <div style={{ marginBottom: 16 }}><_JobReportBtn job={job} biz={biz} expenses={expenses} flash={flash} /></div>`,
  "Add PDF button in JobDetail"
);

// ─── 5. MonthlyOverheadsSettings component ──────────────────────────────
replace(
  "/* ═══ SETTINGS ═══════════════════════════════════════ */",
  `/* ═══ MONTHLY OVERHEADS SETTINGS ════════════════════ */
function MonthlyOverheadsSettings({ overheads, onUpdate }) {
  const [form, setForm] = useState({ name: "", amount: "", category: "Vehicle" });
  const [editing, setEditing] = useState(null);
  const total = overheads.filter(o => o.is_active).reduce((s, o) => s + Number(o.amount), 0);

  const save = () => {
    if (!form.name || !form.amount) return;
    if (editing) {
      onUpdate(overheads.map(o => o.id === editing ? { ...o, name: form.name, amount: Number(form.amount), category: form.category } : o));
      setEditing(null);
    } else {
      onUpdate([...overheads, { id: mkId("OH"), name: form.name, amount: Number(form.amount), category: form.category, is_active: true }]);
    }
    setForm({ name: "", amount: "", category: "Vehicle" });
  };

  const toggleActive = id => onUpdate(overheads.map(o => o.id === id ? { ...o, is_active: !o.is_active } : o));
  const deleteOH = id => onUpdate(overheads.filter(o => o.id !== id));
  const startEdit = o => { setEditing(o.id); setForm({ name: o.name, amount: String(o.amount), category: o.category }); };

  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, #1E3A8A, #1f9d55)", borderRadius: T.r, padding: "18px 20px", marginBottom: 18, color: "#fff" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", opacity: .75, marginBottom: 4 }}>Monthly Business Costs</div>
        <div style={{ fontSize: 36, fontWeight: 800 }}>{GBP(total)}</div>
        <div style={{ fontSize: 13, opacity: .75, marginTop: 4 }}>{overheads.filter(o => o.is_active).length} active costs per month</div>
      </div>
      <div style={{ background: T.surface, borderRadius: T.r, padding: 18, border: "1px solid " + T.border, boxShadow: T.cardShadow, marginBottom: 18 }}>
        <span style={{ ...S.lbl, marginBottom: 12 }}>{editing ? "Edit Cost" : "Add Monthly Cost"}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Van payment, insurance, fuel..." style={S.inp} />
          <div style={{ display: "flex", gap: 10 }}>
            <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="Monthly amount (£)" style={{ ...S.inp, flex: 1 }} />
            <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={{ ...S.inp, flex: 1, appearance: "auto" }}>
              {OVERHEAD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={save} disabled={!form.name || !form.amount} style={{ ...grn, flex: 2, opacity: (!form.name || !form.amount) ? .5 : 1 }}>{editing ? "Save Changes" : "Add Cost"}</button>
            {editing && <button onClick={() => { setEditing(null); setForm({ name: "", amount: "", category: "Vehicle" }); }} style={{ ...sec, flex: 1 }}>Cancel</button>}
          </div>
        </div>
      </div>
      {overheads.length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, color: T.textMuted, background: T.surfaceAlt, borderRadius: T.r }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>No monthly costs yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add your fixed costs to see true profit</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {overheads.map(o => (
            <div key={o.id} style={{ background: T.surface, borderRadius: T.rSm, padding: "12px 14px", border: "1px solid " + (o.is_active ? T.border : T.borderLight), opacity: o.is_active ? 1 : 0.55, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{o.name}</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>{o.category}</div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 16, color: T.danger, marginRight: 4 }}>{GBP(o.amount)}<span style={{ fontSize: 10, color: T.textMuted, fontWeight: 400 }}>/mo</span></div>
              <button onClick={() => toggleActive(o.id)} style={{ ...S.btn, padding: "5px 10px", fontSize: 11, minHeight: 28, background: o.is_active ? T.accentLight : T.surfaceAlt, color: o.is_active ? T.accent : T.textMuted, border: "none" }}>{o.is_active ? "On" : "Off"}</button>
              <button onClick={() => startEdit(o)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "4px" }}>✏️</button>
              <button onClick={() => deleteOH(o.id)} style={{ ...S.iconBtn, color: T.danger }}><BinIc /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ SETTINGS ═══════════════════════════════════════ */`,
  "Add MonthlyOverheadsSettings component"
);

// ─── 6. SettingsTab signature + overhead section ─────────────────────────
replace(
  "function SettingsTab({ biz, onUpd }) {",
  "function SettingsTab({ biz, onUpd, overheads, onUpdateOverheads }) {",
  "SettingsTab overhead props"
);

replace(
  `    {/* Reminders & Notifications */}`,
  `    {/* Monthly Overheads */}
    <div style={{ marginTop: 24 }}>
      <span style={S.lbl}>Monthly Business Costs</span>
      <p style={{ fontSize: 13, color: T.textMuted, margin: "0 0 14px" }}>Track fixed costs like insurance, fuel and van payments to see your true profit after overhead.</p>
      <MonthlyOverheadsSettings overheads={overheads} onUpdate={onUpdateOverheads} />
    </div>

    {/* Reminders & Notifications */}`,
  "Add overhead section to SettingsTab"
);

// ─── 7. OverviewTab + QuickStats overhead props ──────────────────────────
replace(
  "function OverviewTab({ jobs, expenses, invoices, onGo, biz, showVat }) {",
  "function OverviewTab({ jobs, expenses, invoices, onGo, biz, showVat, overheads }) {",
  "OverviewTab overhead prop"
);

replace(
  "    <QuickStats todayProfit={todayProfit} outstanding={totUnpaid} paidThisMonth={moPaid} profitThisMonth={moProfit} unpaidCount={unpaid.length} onChase={scrollToChase} />",
  "    <QuickStats todayProfit={todayProfit} outstanding={totUnpaid} paidThisMonth={moPaid} profitThisMonth={moProfit} unpaidCount={unpaid.length} onChase={scrollToChase} overheads={overheads} />",
  "Pass overheads to QuickStats"
);

replace(
  "function QuickStats({ todayProfit, outstanding, paidThisMonth, profitThisMonth, unpaidCount, onChase }) {",
  "function QuickStats({ todayProfit, outstanding, paidThisMonth, profitThisMonth, unpaidCount, onChase, overheads }) {",
  "QuickStats overhead prop"
);

// True Profit block inserted before Outstanding button
replace(
  `    {/* Outstanding — Left border accent + pulse */}`,
  `    {/* True Profit After Overhead */}
    {(() => {
      const activeOH = (overheads || []).filter(o => o.is_active);
      const ohTotal = activeOH.reduce((s, o) => s + Number(o.amount), 0);
      const trueProfit = profitThisMonth - ohTotal;
      if (activeOH.length === 0) return (
        <div style={{ background: T.surfaceAlt, border: "1.5px dashed " + T.border, borderRadius: T.r, padding: "12px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: T.textMed }}>Add fixed costs to see true profit</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>Insurance, van, fuel — add in Settings</div>
          </div>
        </div>
      );
      return (
        <div style={{ background: trueProfit >= 0 ? "linear-gradient(135deg, #1E3A8A, #1f9d55)" : "linear-gradient(135deg, #dc2626, #b91c1c)", borderRadius: T.r, padding: "18px 20px 14px", color: "#fff", boxShadow: T.heroShadow, marginBottom: 8, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.06))", pointerEvents: "none" }} />
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", opacity: .8, marginBottom: 4, position: "relative" }}>True Profit This Month</div>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, letterSpacing: -1, position: "relative" }}>{GBP(trueProfit)}</div>
          <div style={{ fontSize: 12, opacity: .7, marginTop: 6, fontWeight: 500, position: "relative" }}>after {GBP(ohTotal)}/mo fixed business costs</div>
        </div>
      );
    })()}
    {/* Outstanding — Left border accent + pulse */}`,
  "Add True Profit After Overhead to QuickStats"
);

// ─── 8. App state — overheads ────────────────────────────────────────────
replace(
  "  const [biz, setBiz] = useState(defBiz);",
  "  const [biz, setBiz] = useState(defBiz);\n  const [overheads, setOverheads] = useState(seedOverheads);",
  "Add overheads state"
);

replace(
  "saveData({ jobs, expenses, invoices, biz });",
  "saveData({ jobs, expenses, invoices, biz, overheads });",
  "Save overheads"
);

replace(
  "      if (localData.biz) setBiz(localData.biz);",
  "      if (localData.biz) setBiz(localData.biz);\n      if (localData.overheads) setOverheads(localData.overheads);",
  "Load overheads from localStorage"
);

replace(
  "      if (saved.biz) setBiz(saved.biz);",
  "      if (saved.biz) setBiz(saved.biz);\n      if (saved.overheads) setOverheads(saved.overheads);",
  "Load overheads from window.storage"
);

replace(
  "  }, [jobs, expenses, invoices, biz, dataLoaded]);",
  "  }, [jobs, expenses, invoices, biz, overheads, dataLoaded]);",
  "Add overheads to auto-save deps"
);

// ─── 9. Pass overheads in render ─────────────────────────────────────────
replace(
  '      {tab === "Overview" && <OverviewTab jobs={jobs} expenses={expenses} invoices={invoices} onGo={goTo} biz={biz} showVat={showVat} />}',
  '      {tab === "Overview" && <OverviewTab jobs={jobs} expenses={expenses} invoices={invoices} onGo={goTo} biz={biz} showVat={showVat} overheads={overheads} />}',
  "Pass overheads to OverviewTab"
);

replace(
  '      {tab === "Settings" && <SettingsTab biz={biz} onUpd={setBiz} />}',
  '      {tab === "Settings" && <SettingsTab biz={biz} onUpd={setBiz} overheads={overheads} onUpdateOverheads={setOverheads} />}',
  "Pass overheads to SettingsTab"
);

// ─── WRITE ────────────────────────────────────────────────────────────────
fs.writeFileSync(TARGET, src, "utf8");
console.log("\nPatch complete —", changed, "changes applied");
console.log("Output:", TARGET);
console.log("\nNext steps:");
console.log("  npm run build");
console.log("  git add public/App.jsx && git commit -m 'feat: overhead tracking, true profit dashboard, job PDF report'");
console.log("  git push");
