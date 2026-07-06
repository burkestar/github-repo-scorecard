import {
  type CheckResult,
  DIMENSION_META,
  GRADE_COLORS,
  type Scorecard,
} from "@scorecard/schema";
import { renderRadarSvg } from "./radar.js";

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&#39;",
  );
}

const STATUS_ICON: Record<string, string> = {
  pass: "✓",
  partial: "◑",
  fail: "✕",
  not_applicable: "–",
  error: "!",
};

const PRIORITY_LABEL: Record<string, string> = {
  high: "High impact",
  medium: "Medium",
  low: "Low",
};

const STYLE = `
:root {
  --surface-1: #fcfcfb; --page: #f9f9f7;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --muted: #898781;
  --gridline: #e1e0d9; --baseline: #c3c2b7; --border: rgba(11,11,11,0.10);
  --series-1: #2a78d6; --series-1-fill: rgba(42,120,214,0.16);
  --good: #0ca30c; --warning: #fab219; --serious: #ec835a; --critical: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface-1: #1a1a19; --page: #0d0d0d;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --muted: #898781;
    --gridline: #2c2c2a; --baseline: #383835; --border: rgba(255,255,255,0.10);
    --series-1: #3987e5; --series-1-fill: rgba(57,135,229,0.20);
  }
}
:root[data-theme="light"] {
  --surface-1: #fcfcfb; --page: #f9f9f7;
  --text-primary: #0b0b0b; --text-secondary: #52514e;
  --gridline: #e1e0d9; --baseline: #c3c2b7; --border: rgba(11,11,11,0.10);
  --series-1: #2a78d6; --series-1-fill: rgba(42,120,214,0.16);
}
:root[data-theme="dark"] {
  --surface-1: #1a1a19; --page: #0d0d0d;
  --text-primary: #ffffff; --text-secondary: #c3c2b7;
  --gridline: #2c2c2a; --baseline: #383835; --border: rgba(255,255,255,0.10);
  --series-1: #3987e5; --series-1-fill: rgba(57,135,229,0.20);
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--page); color: var(--text-primary);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.5; padding: 24px;
}
.wrap { max-width: 960px; margin: 0 auto; }
.card {
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: 14px; padding: 24px; margin-bottom: 20px;
}
.header { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
.grade {
  width: 92px; height: 92px; border-radius: 20px; display: grid; place-items: center;
  font-size: 52px; font-weight: 800; color: #fff; flex: none;
}
.header h1 { margin: 0 0 4px; font-size: 20px; }
.header a { color: var(--series-1); text-decoration: none; }
.overall { font-size: 15px; color: var(--text-secondary); }
.overall b { color: var(--text-primary); font-size: 17px; }
.grid2 { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(280px, 1fr); gap: 20px; }
@media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 14px; }
.dim { margin-bottom: 14px; }
.dim-top { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px; }
.dim-top .score { font-weight: 700; font-variant-numeric: tabular-nums; }
.bar { height: 8px; background: var(--gridline); border-radius: 4px; overflow: hidden; }
.bar > span { display: block; height: 100%; border-radius: 4px; }
.recs { list-style: none; padding: 0; margin: 0; }
.rec { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border); }
.rec:first-child { border-top: none; }
.chip {
  flex: none; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px;
  height: fit-content; white-space: nowrap;
}
.chip.high { background: rgba(208,59,59,.15); color: var(--critical); }
.chip.medium { background: rgba(250,178,25,.18); color: #9a6b00; }
.chip.low { background: var(--gridline); color: var(--text-secondary); }
@media (prefers-color-scheme: dark) { .chip.medium { color: var(--warning); } }
.rec h3 { margin: 0 0 2px; font-size: 14px; }
.rec p { margin: 0; font-size: 13px; color: var(--text-secondary); }
.rec .impact { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
details.dimgroup { border-top: 1px solid var(--border); }
details.dimgroup > summary { cursor: pointer; padding: 12px 0; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; }
.check { display: flex; gap: 10px; padding: 8px 0 8px 8px; font-size: 13px; border-top: 1px dashed var(--border); }
.stat { flex: none; width: 18px; text-align: center; font-weight: 700; }
.stat.pass { color: var(--good); } .stat.fail { color: var(--critical); }
.stat.partial { color: var(--warning); } .stat.not_applicable, .stat.error { color: var(--muted); }
.check .body { flex: 1; }
.check .ev { color: var(--muted); font-size: 12px; }
.foot { color: var(--muted); font-size: 12px; text-align: center; }
.foot a { color: var(--series-1); }
`;

function dimensionBars(sc: Scorecard): string {
  return sc.dimensions
    .map((d) => {
      const color = GRADE_COLORS[d.grade];
      return `<div class="dim">
  <div class="dim-top"><span>${esc(d.label)}</span><span class="score">${d.score} · ${d.grade}</span></div>
  <div class="bar"><span style="width:${d.score}%;background:${color}"></span></div>
</div>`;
    })
    .join("");
}

function recommendations(sc: Scorecard): string {
  if (sc.recommendations.length === 0)
    return `<p class="overall">No outstanding recommendations — nicely done.</p>`;
  return `<ul class="recs">${sc.recommendations
    .slice(0, 12)
    .map(
      (r) => `<li class="rec">
  <span class="chip ${r.priority}">${PRIORITY_LABEL[r.priority]}</span>
  <div>
    <h3>${esc(r.title)}</h3>
    <p>${esc(r.detail)}${r.docUrl ? ` <a href="${esc(r.docUrl)}" target="_blank" rel="noopener">docs</a>` : ""}</p>
  </div>
  <span class="impact">+${r.impact}</span>
</li>`,
    )
    .join("")}</ul>`;
}

function checkRow(c: CheckResult): string {
  return `<div class="check">
  <span class="stat ${c.status}" title="${c.status}">${STATUS_ICON[c.status] ?? "?"}</span>
  <div class="body">
    <div>${esc(c.name)} <span style="color:var(--muted);font-variant-numeric:tabular-nums">(${c.score})</span></div>
    ${c.evidence.length ? `<div class="ev">${esc(c.evidence.join("; "))}</div>` : ""}
  </div>
</div>`;
}

function detailTable(sc: Scorecard): string {
  const byDim = new Map<string, CheckResult[]>();
  for (const c of sc.checks) {
    const arr = byDim.get(c.dimension) ?? [];
    arr.push(c);
    byDim.set(c.dimension, arr);
  }
  return [...byDim.entries()]
    .map(([dim, checks]) => {
      const meta = DIMENSION_META[dim as keyof typeof DIMENSION_META];
      const dimScore = sc.dimensions.find((d) => d.id === dim);
      return `<details class="dimgroup">
  <summary><span>${esc(meta?.label ?? dim)}</span><span style="color:var(--muted)">${dimScore ? `${dimScore.score} · ${dimScore.grade}` : ""}</span></summary>
  ${checks.map(checkRow).join("")}
</details>`;
    })
    .join("");
}

export interface HtmlOptions {
  /** Emit only the inner content (no <html>/<head>) for embedding. */
  fragment?: boolean;
}

/** Full, self-contained HTML report. Themes for light + dark automatically. */
export function renderReportHtml(sc: Scorecard, opts: HtmlOptions = {}): string {
  const grade = sc.overall.grade;
  const gradeColor = GRADE_COLORS[grade];
  const body = `<div class="wrap">
  <div class="card header">
    <div class="grade" style="background:${gradeColor}">${grade}</div>
    <div>
      <h1><a href="${esc(sc.repo.url)}" target="_blank" rel="noopener">${esc(sc.repo.owner)}/${esc(sc.repo.name)}</a></h1>
      <div class="overall">Overall <b>${sc.overall.score}/100</b> · ${sc.dimensions.length} dimensions${
        sc.sources.openssf.provider === "unavailable"
          ? " · <span title=\"" + esc(sc.sources.openssf.note ?? "") + "\">OpenSSF n/a</span>"
          : ` · OpenSSF via ${esc(sc.sources.openssf.provider)}`
      }</div>
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>Dimensions</h2>
      ${renderRadarSvg(sc.dimensions)}
      <div style="margin-top:18px">${dimensionBars(sc)}</div>
    </div>
    <div class="card">
      <h2>How to improve</h2>
      ${recommendations(sc)}
    </div>
  </div>

  <div class="card">
    <h2>All checks</h2>
    ${detailTable(sc)}
  </div>

  <p class="foot">Generated ${esc(sc.generatedAt)} · ai-harness + <a href="https://github.com/ossf/scorecard" target="_blank" rel="noopener">OpenSSF Scorecard</a></p>
</div>`;

  if (opts.fragment) return `<style>${STYLE}</style>${body}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Scorecard · ${esc(sc.repo.owner)}/${esc(sc.repo.name)}</title>
<style>${STYLE}</style>
</head>
<body>${body}</body>
</html>`;
}
