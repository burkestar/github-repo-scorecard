import { type LetterGrade, type Scorecard } from "@scorecard/schema";
import pc from "picocolors";

const gradeColor = (g: LetterGrade, s: string): string => {
  switch (g) {
    case "A":
      return pc.green(s);
    case "B":
      return pc.greenBright(s);
    case "C":
      return pc.yellow(s);
    case "D":
      return pc.red(s);
    case "F":
      return pc.redBright(s);
  }
};

function bar(score: number, width = 24): string {
  const filled = Math.round((score / 100) * width);
  return "█".repeat(filled) + pc.dim("░".repeat(width - filled));
}

/** Compact, colorized terminal scorecard: grade, per-dimension bars, top fixes. */
export function renderTerminal(sc: Scorecard, opts: { topN?: number } = {}): string {
  const lines: string[] = [];
  const { owner, name } = sc.repo;
  lines.push("");
  lines.push(
    `  ${pc.bold(`${owner}/${name}`)}  ${gradeColor(
      sc.overall.grade,
      pc.bold(`${sc.overall.grade} (${sc.overall.score}/100)`),
    )}`,
  );
  lines.push(pc.dim(`  ${sc.repo.url}`));
  lines.push("");

  const labelWidth = Math.max(...sc.dimensions.map((d) => d.label.length));
  for (const d of sc.dimensions) {
    const label = d.label.padEnd(labelWidth);
    lines.push(
      `  ${label}  ${gradeColor(d.grade, bar(d.score))} ${gradeColor(
        d.grade,
        `${String(d.score).padStart(3)} ${d.grade}`,
      )}`,
    );
  }

  if (sc.sources.openssf.provider === "unavailable") {
    lines.push("");
    lines.push(pc.dim(`  ⚠ OpenSSF Scorecard unavailable (security dimension excluded)`));
  }

  const recs = sc.recommendations.slice(0, opts.topN ?? 5);
  if (recs.length) {
    lines.push("");
    lines.push(pc.bold("  Top recommendations:"));
    for (const r of recs) {
      const tag =
        r.priority === "high" ? pc.red("●") : r.priority === "medium" ? pc.yellow("●") : pc.dim("●");
      lines.push(`  ${tag} ${pc.bold(r.title)} ${pc.dim(`(+${r.impact})`)}`);
      lines.push(`    ${pc.dim(r.detail)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
