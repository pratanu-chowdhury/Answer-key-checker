import React, { useState, useRef, useEffect, useMemo } from "react";
import * as mammothNS from "mammoth";

const mammoth = mammothNS.default || mammothNS;

/* ---- MK palette ---- */
const NAVY = "#03335F";
const NAVY_DEEP = "#022748";
const GREEN = "#128A45";
const AMBER = "#C77D11";
const RED = "#B23A48";
const CREAM = "#FBF6EC";
const INK = "#1b2a36";
const MUTED = "#62748a";
const LINE = "#e4ddcd";

const HEAD = "'Montserrat', system-ui, sans-serif";
const BODY = "'Open Sans', system-ui, sans-serif";

/* ---- file helpers ---- */
function readArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(file);
  });
}
function readBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}
async function fileToBlocks(file, label) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".pdf")) {
    const data = await readBase64(file);
    return [
      { type: "text", text: `\n===== ${label} =====` },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
    ];
  }
  const ab = await readArrayBuffer(file);
  const out = await mammoth.extractRawText({ arrayBuffer: ab });
  return [{ type: "text", text: `\n===== ${label} =====\n${(out.value || "").trim()}` }];
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const half = (n) => Math.round(n * 2) / 2;

/* ---- grading recompute (threshold gating happens here, not in the model) ---- */
function recompute(questions, threshold) {
  const qs = (questions || []).map((q) => {
    const cov = clamp(Number(q.coverage) || 0, 0, 100);
    const max = Number(q.maxMarks) || 0;
    const awarded = cov >= threshold ? half((max * cov) / 100) : 0;
    const verdict = cov < threshold ? "Not awarded" : cov >= 80 ? "Awarded" : "Partial";
    return { number: q.number || "?", maxMarks: max, coverage: cov, comment: q.comment || "", marksAwarded: awarded, verdict };
  });
  const totalMax = qs.reduce((s, q) => s + q.maxMarks, 0);
  const totalAwarded = qs.reduce((s, q) => s + q.marksAwarded, 0);
  const pct = totalMax ? Math.round((totalAwarded / totalMax) * 100) : 0;
  return { qs, totalMax, totalAwarded, pct };
}

const verdictColor = (v) => (v === "Awarded" ? GREEN : v === "Partial" ? AMBER : RED);

export default function App() {
  const [keyFile, setKeyFile] = useState(null);
  const [stuFile, setStuFile] = useState(null);
  const [threshold, setThreshold] = useState(40);
  const [status, setStatus] = useState("idle"); // idle | grading | done | error
  const [stage, setStage] = useState("");
  const [raw, setRaw] = useState(null); // { questions, summary }
  const [error, setError] = useState("");

  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&family=Open+Sans:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
    return () => { try { document.head.removeChild(l); } catch (e) {} };
  }, []);

  const computed = useMemo(() => (raw ? recompute(raw.questions, threshold) : null), [raw, threshold]);

  async function handleGrade() {
    setError("");
    if (!keyFile || !stuFile) {
      setError("Upload both the answer key and the student sheet to grade.");
      return;
    }
    setStatus("grading");
    try {
      setStage("Reading documents…");
      const instruction = {
        type: "text",
        text:
`You are a senior actuarial examiner grading a student's mock paper against the official answer key (examiner solution).

Do this:
1. Identify every question / sub-part in the answer key and its maximum marks. If marks aren't stated, infer a sensible allocation from the paper.
2. For each sub-part, compare the student's answer to the key and estimate a coverage ratio 0-100: the share of the key's required points the student adequately addressed. Be rigorous and fair — do not be generous.
3. Write a brief examiner comment (max 25 words) per sub-part: what was missing or done well.

Do NOT apply any pass threshold or compute final marks yourself — only report maxMarks and coverage. Marks are computed downstream.

Return ONLY a JSON object, no markdown fences, no preamble, exactly this shape:
{"questions":[{"number":"Q1(i)","maxMarks":4,"coverage":70,"comment":"..."}],"summary":"3-4 sentence overall examiner summary naming the biggest improvement priorities."}`,
      };
      const keyBlocks = await fileToBlocks(keyFile, "ANSWER KEY (examiner solution)");
      const stuBlocks = await fileToBlocks(stuFile, "STUDENT ANSWER SHEET");
      const content = [instruction, ...keyBlocks, ...stuBlocks, { type: "text", text: "\nReturn the JSON now." }];

      setStage("Claude is grading the paper…");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          messages: [{ role: "user", content }],
        }),
      });
      const data = await response.json();
      if (data && data.type === "error") throw new Error(data.error?.message || "API error");

      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const s = cleaned.indexOf("{");
      const e = cleaned.lastIndexOf("}");
      if (s === -1 || e === -1) throw new Error("Could not read a result from the response. Try again, or split a very long paper.");
      const parsed = JSON.parse(cleaned.slice(s, e + 1));
      if (!parsed.questions || !parsed.questions.length) throw new Error("No questions were detected. Check that the answer key has clear question structure.");

      setRaw({ questions: parsed.questions, summary: parsed.summary || "" });
      setStatus("done");
      setStage("");
    } catch (err) {
      setError(err.message || "Something went wrong while grading.");
      setStatus("error");
      setStage("");
    }
  }

  function reset() {
    setRaw(null); setKeyFile(null); setStuFile(null);
    setStatus("idle"); setError(""); setStage("");
  }

  function downloadReport() {
    if (!computed) return;
    const rows = computed.qs
      .map(
        (q) => `<tr>
<td class="q">${escapeHtml(q.number)}</td>
<td class="c"><span class="chip" style="background:${verdictColor(q.verdict)}">${q.verdict}</span></td>
<td class="c">${q.coverage}%</td>
<td class="c"><b>${q.marksAwarded}</b> / ${q.maxMarks}</td>
<td>${escapeHtml(q.comment)}</td>
</tr>`
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>AnswerLens Report</title>
<style>
body{font-family:'Open Sans',system-ui,sans-serif;color:${INK};margin:0;background:#fff}
.wrap{max-width:820px;margin:0 auto;padding:40px 28px}
h1{font-family:'Montserrat',sans-serif;color:${NAVY};margin:0 0 2px;font-size:24px}
.sub{color:${MUTED};font-size:13px;margin-bottom:24px}
.score{display:flex;align-items:baseline;gap:14px;border:1px solid ${LINE};border-radius:14px;padding:20px 24px;background:${CREAM}}
.big{font-family:'Montserrat',sans-serif;font-size:40px;font-weight:800;color:${NAVY}}
.pct{font-family:'Montserrat',sans-serif;font-size:18px;color:${GREEN};font-weight:700}
table{width:100%;border-collapse:collapse;margin-top:22px;font-size:13px}
th{font-family:'Montserrat',sans-serif;text-align:left;color:${NAVY};border-bottom:2px solid ${NAVY};padding:8px 8px}
td{border-bottom:1px solid ${LINE};padding:9px 8px;vertical-align:top}
td.c{text-align:center;white-space:nowrap}td.q{font-weight:700;white-space:nowrap}
.chip{color:#fff;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:600}
.summary{margin-top:24px;border-left:4px solid ${GREEN};background:${CREAM};padding:14px 18px;border-radius:0 10px 10px 0;font-size:14px}
.foot{margin-top:30px;color:${MUTED};font-size:11px;border-top:1px solid ${LINE};padding-top:12px}
</style></head><body><div class="wrap">
<h1>AnswerLens — Grading Report</h1>
<div class="sub">Threshold for awarding marks: ${threshold}% coverage · Generated ${new Date().toLocaleString()}</div>
<div class="score"><span class="big">${computed.totalAwarded} / ${computed.totalMax}</span><span class="pct">${computed.pct}%</span></div>
<table><thead><tr><th>Q</th><th style="text-align:center">Verdict</th><th style="text-align:center">Coverage</th><th style="text-align:center">Marks</th><th>Examiner comment</th></tr></thead><tbody>${rows}</tbody></table>
${raw.summary ? `<div class="summary"><b>Examiner summary.</b> ${escapeHtml(raw.summary)}</div>` : ""}
<div class="foot">MK Actuarial · AnswerLens. Coverage is an AI estimate; verify borderline scripts manually.</div>
</div></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "AnswerLens-report.html";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ minHeight: "100%", background: CREAM, fontFamily: BODY, color: INK }}>
      <style>{`
        * { box-sizing: border-box; }
        input[type=range]{ -webkit-appearance:none; appearance:none; height:6px; border-radius:6px; outline:none; }
        input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; appearance:none; width:22px; height:22px; border-radius:50%; background:${NAVY}; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.3); cursor:pointer; }
        input[type=range]::-moz-range-thumb{ width:18px; height:18px; border-radius:50%; background:${NAVY}; border:3px solid #fff; cursor:pointer; }
        .al-btn:focus-visible, .al-drop:focus-visible{ outline:3px solid ${AMBER}; outline-offset:2px; }
        .al-fill{ transition:width .25s ease; }
        @media (prefers-reduced-motion: reduce){ .al-fill{ transition:none; } }
      `}</style>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "34px 20px 64px" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: NAVY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 800, fontSize: 18 }}>A</div>
          <h1 style={{ fontFamily: HEAD, fontSize: 26, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: "-0.5px" }}>AnswerLens</h1>
        </div>
        <p style={{ color: MUTED, margin: "0 0 26px", fontSize: 14 }}>Mock-paper grading for MK Actuarial — powered by Claude.</p>

        {status !== "done" && (
          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: 22 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Dropzone label="Answer key" hint="Examiner solution" file={keyFile} onFile={setKeyFile} />
              <Dropzone label="Student sheet" hint="Script to grade" file={stuFile} onFile={setStuFile} />
            </div>

            <div style={{ marginTop: 24 }}>
              <ThresholdControl threshold={threshold} setThreshold={setThreshold} />
            </div>

            {error && <Banner text={error} />}

            <button
              className="al-btn"
              onClick={handleGrade}
              disabled={status === "grading"}
              style={{
                marginTop: 22, width: "100%", border: "none", borderRadius: 12, padding: "14px 0",
                background: status === "grading" ? MUTED : NAVY, color: "#fff", fontFamily: HEAD,
                fontWeight: 700, fontSize: 15, cursor: status === "grading" ? "default" : "pointer",
              }}
            >
              {status === "grading" ? stage || "Grading…" : "Start grading"}
            </button>
            <p style={{ color: MUTED, fontSize: 12, marginTop: 12, marginBottom: 0, textAlign: "center" }}>
              PDF or DOCX · no API key needed
            </p>
          </div>
        )}

        {status === "done" && computed && (
          <Results
            computed={computed}
            summary={raw.summary}
            threshold={threshold}
            setThreshold={setThreshold}
            onReset={reset}
            onDownload={downloadReport}
          />
        )}
      </div>
    </div>
  );
}

function Dropzone({ label, hint, file, onFile }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const ok = (f) => f && /\.(pdf|docx)$/i.test(f.name);
  return (
    <div
      className="al-drop"
      tabIndex={0}
      role="button"
      onClick={() => inputRef.current && inputRef.current.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (ok(f)) onFile(f); }}
      style={{
        border: `1.5px dashed ${file ? GREEN : over ? NAVY : LINE}`,
        background: file ? "#f3faf5" : over ? "#f5f8fb" : CREAM,
        borderRadius: 12, padding: "18px 14px", cursor: "pointer", textAlign: "center", minHeight: 104,
        display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
      }}
    >
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 13, color: NAVY }}>{label}</div>
      {file ? (
        <div style={{ fontSize: 12.5, color: GREEN, fontWeight: 600, wordBreak: "break-word" }}>✓ {file.name}</div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: INK }}>Click or drop to upload</div>
          <div style={{ fontSize: 11, color: MUTED }}>{hint} · PDF / DOCX</div>
        </>
      )}
      <input ref={inputRef} type="file" accept=".pdf,.docx" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (ok(f)) onFile(f); }} />
    </div>
  );
}

function ThresholdControl({ threshold, setThreshold }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 13, color: NAVY }}>Award threshold</span>
        <span style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 18, color: NAVY }}>{threshold}%</span>
      </div>
      <input type="range" min={0} max={100} step={5} value={threshold}
        onChange={(e) => setThreshold(Number(e.target.value))}
        style={{ width: "100%", background: `linear-gradient(90deg, ${GREEN} ${threshold}%, ${LINE} ${threshold}%)` }} />
      <p style={{ color: MUTED, fontSize: 12, margin: "8px 0 0" }}>
        Minimum coverage of the key needed before a sub-part earns marks.
      </p>
    </div>
  );
}

function Banner({ text }) {
  return (
    <div style={{ marginTop: 16, background: "#fcecec", border: `1px solid ${RED}`, color: RED, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
      {text}
    </div>
  );
}

function Results({ computed, summary, threshold, setThreshold, onReset, onDownload }) {
  return (
    <div>
      {/* score card */}
      <div style={{ background: NAVY, borderRadius: 16, padding: "22px 24px", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8, fontFamily: HEAD, letterSpacing: 0.5, textTransform: "uppercase" }}>Total score</div>
          <div style={{ fontFamily: HEAD, fontSize: 40, fontWeight: 800, lineHeight: 1.05 }}>
            {computed.totalAwarded} <span style={{ opacity: 0.55, fontSize: 26 }}>/ {computed.totalMax}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: HEAD, fontSize: 34, fontWeight: 800, color: "#7ce0a3" }}>{computed.pct}%</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>at {threshold}% threshold</div>
        </div>
      </div>

      {/* live threshold */}
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, padding: "16px 18px", marginTop: 14 }}>
        <ThresholdControl threshold={threshold} setThreshold={setThreshold} />
      </div>

      {/* per question */}
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        {computed.qs.map((q, i) => (
          <div key={i} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 9 }}>
              <span style={{ fontFamily: HEAD, fontWeight: 700, color: NAVY, fontSize: 14 }}>{q.number}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ background: verdictColor(q.verdict), color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600, fontFamily: HEAD }}>{q.verdict}</span>
                <span style={{ fontFamily: HEAD, fontWeight: 800, color: INK, fontSize: 15 }}>{q.marksAwarded}<span style={{ color: MUTED, fontWeight: 600 }}>/{q.maxMarks}</span></span>
              </span>
            </div>
            <CoverageMeter coverage={q.coverage} threshold={threshold} color={verdictColor(q.verdict)} />
            {q.comment && <p style={{ margin: "10px 0 0", fontSize: 13, color: INK, lineHeight: 1.5 }}>{q.comment}</p>}
          </div>
        ))}
      </div>

      {summary && (
        <div style={{ marginTop: 16, background: CREAM, borderLeft: `4px solid ${GREEN}`, borderRadius: "0 10px 10px 0", padding: "14px 18px" }}>
          <div style={{ fontFamily: HEAD, fontWeight: 700, color: NAVY, fontSize: 13, marginBottom: 4 }}>Examiner summary</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: INK }}>{summary}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="al-btn" onClick={onDownload}
          style={{ flex: 1, border: "none", borderRadius: 11, padding: "12px 0", background: GREEN, color: "#fff", fontFamily: HEAD, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          Download HTML report
        </button>
        <button className="al-btn" onClick={onReset}
          style={{ flex: 1, border: `1.5px solid ${NAVY}`, borderRadius: 11, padding: "12px 0", background: "#fff", color: NAVY, fontFamily: HEAD, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          Grade another
        </button>
      </div>
    </div>
  );
}

function CoverageMeter({ coverage, threshold, color }) {
  return (
    <div>
      <div style={{ position: "relative", height: 10, background: "#eef1f4", borderRadius: 6 }}>
        <div className="al-fill" style={{ position: "absolute", inset: 0, width: `${coverage}%`, background: color, borderRadius: 6 }} />
        <div title={`threshold ${threshold}%`} style={{ position: "absolute", top: -3, bottom: -3, left: `${threshold}%`, width: 2, background: NAVY_DEEP, opacity: 0.55 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        <span style={{ fontSize: 11, color: MUTED }}>{coverage}% coverage</span>
        <span style={{ fontSize: 11, color: MUTED }}>threshold {threshold}%</span>
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
