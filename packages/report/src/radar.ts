import type { DimensionScore } from "@scorecard/schema";

export interface RadarOptions {
  size?: number;
  /** Inject explicit colors (defaults reference CSS vars for theme-awareness). */
  colors?: {
    series: string;
    seriesFill: string;
    grid: string;
    axis: string;
    label: string;
    valueLabel: string;
  };
}

const DEFAULT_COLORS = {
  series: "var(--series-1)",
  seriesFill: "var(--series-1-fill)",
  grid: "var(--gridline)",
  axis: "var(--baseline)",
  label: "var(--text-secondary)",
  valueLabel: "var(--text-primary)",
};

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const fmt = (n: number) => Math.round(n * 100) / 100;

/**
 * Renders a single-series radar/spider chart as a self-contained inline SVG.
 * One entity (this repo) → one blue polygon, no legend; every vertex carries its
 * numeric score so identity/magnitude never rely on color alone. Colors default
 * to CSS custom properties so the same markup themes for light and dark.
 */
export function renderRadarSvg(
  dimensions: DimensionScore[],
  opts: RadarOptions = {},
): string {
  const size = opts.size ?? 420;
  const colors = opts.colors ?? DEFAULT_COLORS;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32; // leave room for labels
  const n = dimensions.length;
  if (n < 3) {
    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Not enough dimensions to plot"></svg>`;
  }
  const step = 360 / n;
  const startAngle = -90;

  // Concentric grid rings at 20/40/60/80/100.
  const rings = [20, 40, 60, 80, 100]
    .map((pct) => {
      const rr = (r * pct) / 100;
      const pts = dimensions
        .map((_, i) => polar(cx, cy, rr, startAngle + i * step).map(fmt).join(","))
        .join(" ");
      return `<polygon points="${pts}" fill="none" stroke="${colors.grid}" stroke-width="1" />`;
    })
    .join("");

  // Spokes + outer labels.
  const spokes = dimensions
    .map((d, i) => {
      const [x, y] = polar(cx, cy, r, startAngle + i * step);
      const [lx, ly] = polar(cx, cy, r + 22, startAngle + i * step);
      const anchor = Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end";
      const dy = ly < cy - 4 ? "0" : ly > cy + 4 ? "0.8em" : "0.3em";
      return `<line x1="${fmt(cx)}" y1="${fmt(cy)}" x2="${fmt(x)}" y2="${fmt(y)}" stroke="${colors.axis}" stroke-width="1" />
<text x="${fmt(lx)}" y="${fmt(ly)}" dy="${dy}" text-anchor="${anchor}" font-size="12" font-weight="600" fill="${colors.label}">${escapeXml(d.label)}</text>`;
    })
    .join("");

  // Data polygon.
  const dataPts = dimensions
    .map((d, i) => polar(cx, cy, (r * d.score) / 100, startAngle + i * step).map(fmt).join(","))
    .join(" ");
  const vertices = dimensions
    .map((d, i) => {
      const [x, y] = polar(cx, cy, (r * d.score) / 100, startAngle + i * step);
      const [vx, vy] = polar(cx, cy, (r * d.score) / 100 - 14, startAngle + i * step);
      return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="3.5" fill="${colors.series}" stroke="var(--surface-1)" stroke-width="1.5" />
<text x="${fmt(vx)}" y="${fmt(vy)}" text-anchor="middle" dy="0.32em" font-size="11" font-weight="700" fill="${colors.valueLabel}" style="font-variant-numeric:tabular-nums">${d.score}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${size} ${size}" width="100%" role="img" aria-label="Scorecard radar of ${n} dimensions">
<g>${rings}</g>
<g>${spokes}</g>
<polygon points="${dataPts}" fill="${colors.seriesFill}" stroke="${colors.series}" stroke-width="2" stroke-linejoin="round" />
<g>${vertices}</g>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&#39;",
  );
}
